// PttChrome v3 — native connection bridge.
//
// The webview runs the unchanged PttChrome terminal UI. Its transport
// (src/js/websocket.js, TauriWebsocket) ferries raw bytes here over IPC, and
// this Rust side maintains the real WebSocket to PTT's gateway. Doing the
// connection natively lets us set the `Origin: https://term.ptt.cc` header that
// PTT's whitelist requires — something a browser page cannot do.
//
// Rust stays a dumb byte pipe: all Telnet/ANSI/Big5 logic remains in JS.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

// tx (writer channel) and tasks (reader+writer handles) move together as one
// connection, so they live under ONE lock — the whole "take over" operation
// (abort old, install new) is then atomic and can't interleave with another
// connect or a send.
struct ConnInner {
    tx: Option<mpsc::UnboundedSender<Message>>,
    tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
}

struct ConnState {
    inner: Mutex<ConnInner>,
    // Id of the connection that owns the pipe right now (monotonic from the
    // frontend). The reader checks it and goes quiet once a newer connection
    // takes over; ws_connect uses it to let the newest request win a race.
    current_id: Arc<AtomicU64>,
}

impl Default for ConnState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(ConnInner {
                tx: None,
                tasks: Vec::new(),
            }),
            current_id: Arc::new(AtomicU64::new(0)),
        }
    }
}

// Recover a poisoned lock rather than panicking (and permanently bricking
// connectivity) if some other code panicked while holding it.
fn lock<'a, T>(m: &'a Mutex<T>) -> std::sync::MutexGuard<'a, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[tauri::command]
async fn ws_connect(
    app: AppHandle,
    state: State<'_, ConnState>,
    url: String,
    origin: String,
    id: u64,
) -> Result<(), String> {
    // Only allow PTT's gateway — stops the bridge being used as a general WS
    // client to arbitrary hosts (SSRF) if the caller is ever compromised.
    let host = extract_host(&url).unwrap_or_default();
    if host != "ws.ptt.cc" && !host.ends_with(".ptt.cc") {
        return Err("refused: only *.ptt.cc is allowed".into());
    }

    let mut request = url
        .into_client_request()
        .map_err(|e| format!("bad url: {e}"))?;
    let origin_value = origin
        .parse()
        .map_err(|_| "invalid origin header".to_string())?;
    request.headers_mut().insert("Origin", origin_value);

    // Connect FIRST. If this fails we return Err with the previous connection (if
    // any) left fully intact — a transient connect error must not kill a live
    // session.
    let (ws_stream, _resp) = connect_async(request)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let (mut write, mut read) = ws_stream.split();

    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    // Clone for the reader task so it can answer server Ping frames with Pong.
    let tx_pong = tx.clone();

    // Install atomically under the single inner lock. connect_async already
    // finished above, so we hold no lock across an await.
    let mut inner = lock(&state.inner);

    // If a newer connect request already won the race, abandon this one — drop
    // write/read here, which closes this socket. (ids are monotonic.)
    if id < state.current_id.load(Ordering::SeqCst) {
        return Ok(());
    }
    state.current_id.store(id, Ordering::SeqCst);

    // Tear the previous connection down.
    for h in inner.tasks.drain(..) {
        h.abort();
    }
    inner.tx = Some(tx);

    let _ = app.emit("ptt://open", serde_json::json!({ "id": id }));

    // Writer task: forward queued messages to PTT.
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if write.send(msg).await.is_err() {
                break;
            }
        }
        let _ = write.close().await;
    });

    // Reader task: forward PTT bytes to the webview.
    let app2 = app.clone();
    let current_id = state.current_id.clone();
    let reader = tauri::async_runtime::spawn(async move {
        while let Some(item) = read.next().await {
            // A newer connection has taken over — stop quietly (no close event).
            if current_id.load(Ordering::SeqCst) != id {
                return;
            }
            match item {
                Ok(Message::Binary(bytes)) => {
                    let _ = app2.emit("ptt://recv", serde_json::json!({ "id": id, "data": bytes }));
                }
                Ok(Message::Text(text)) => {
                    let _ = app2.emit(
                        "ptt://recv",
                        serde_json::json!({ "id": id, "data": text.into_bytes() }),
                    );
                }
                Ok(Message::Ping(payload)) => {
                    // Must answer, else PTT drops the connection. With a split
                    // stream tungstenite's auto-pong won't flush, so do it here.
                    let _ = tx_pong.send(Message::Pong(payload));
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {} // pong/frame: ignore
            }
        }
        // Only report close if we're still the current connection.
        if current_id.load(Ordering::SeqCst) == id {
            let _ = app2.emit("ptt://close", serde_json::json!({ "id": id }));
        }
    });

    inner.tasks.push(writer);
    inner.tasks.push(reader);

    Ok(())
}

#[tauri::command]
fn ws_send(state: State<'_, ConnState>, data: Vec<u8>) -> Result<(), String> {
    // tx is only ever the current connection's (older connects bail before
    // overwriting it), so this always reaches the live socket.
    let guard = lock(&state.inner);
    match guard.tx.as_ref() {
        Some(tx) => tx
            .send(Message::Binary(data))
            .map_err(|e| format!("send failed: {e}")),
        None => Err("not connected".into()),
    }
}

#[tauri::command]
fn ws_disconnect(state: State<'_, ConnState>) {
    let mut inner = lock(&state.inner);
    for h in inner.tasks.drain(..) {
        h.abort();
    }
    inner.tx = None; // dropping the sender closes the connection
}

// Open an external URL in the user's default system browser. The webview's
// window.open / target=_blank don't reach the OS browser, so the frontend routes
// external links here.
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    // Only allow web URLs (case-insensitive scheme; rejects javascript:, file:, …).
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("refused non-http url".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

// --- Image save / share -----------------------------------------------------
// Inline preview images are cross-origin without CORS, so the webview JS cannot
// read their bytes. We download them natively (no CORS limits) instead.

fn filename_from_url(url: &str) -> String {
    let tail = url.rsplit('/').next().unwrap_or("image");
    let name = tail.split(['?', '#']).next().unwrap_or("image");
    let name = name.trim();
    if name.is_empty() {
        "image.jpg".to_string()
    } else if name.contains('.') {
        name.to_string()
    } else {
        format!("{name}.jpg")
    }
}

// --- SSRF guard -------------------------------------------------------------
// Preview/image URLs come from untrusted PTT posts and are fetched by the user's
// machine. Block any URL whose host resolves to a non-public address, so a
// malicious link can't make the client probe loopback / LAN / cloud-metadata.

fn extract_host(url: &str) -> Option<String> {
    let after = url.splitn(2, "://").nth(1)?;
    let authority = after.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority.rsplit('@').next().unwrap_or(authority); // strip userinfo
    if authority.is_empty() {
        return None;
    }
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split(']').next().unwrap_or("").to_string() // IPv6 [::1]:port
    } else {
        authority.split(':').next().unwrap_or(authority).to_string()
    };
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn ip_is_global(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(a) => {
            let o = a.octets();
            !(a.is_loopback()
                || a.is_private()
                || a.is_link_local()
                || a.is_broadcast()
                || a.is_documentation()
                || a.is_unspecified()
                || a.is_multicast()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64/10 CGNAT
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)) // 192.0.0.0/24
        }
        IpAddr::V6(a) => {
            // Canonicalize embedded-IPv4 forms and judge them as IPv4, else they
            // sneak past (e.g. ::ffff:127.0.0.1, 6to4, NAT64 embedding a LAN v4).
            if let Some(v4) = a.to_ipv4_mapped() {
                return ip_is_global(IpAddr::V4(v4));
            }
            let s = a.segments();
            if s[0] == 0x2002 {
                // 6to4 2002::/16 — embedded v4 in segments 1..2.
                let v4 = std::net::Ipv4Addr::new(
                    (s[1] >> 8) as u8, (s[1] & 0xff) as u8,
                    (s[2] >> 8) as u8, (s[2] & 0xff) as u8,
                );
                return ip_is_global(IpAddr::V4(v4));
            }
            if s[0] == 0x0064 && s[1] == 0xff9b {
                // NAT64 64:ff9b::/96 — embedded v4 in the last 32 bits.
                let v4 = std::net::Ipv4Addr::new(
                    (s[6] >> 8) as u8, (s[6] & 0xff) as u8,
                    (s[7] >> 8) as u8, (s[7] & 0xff) as u8,
                );
                return ip_is_global(IpAddr::V4(v4));
            }
            !(a.is_loopback()
                || a.is_unspecified()
                || a.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // ULA fc00::/7
                || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (s[0] == 0x2001 && s[1] == 0x0db8)) // 2001:db8::/32 documentation
        }
    }
}

// True only if the URL is http/https AND its host resolves entirely to public
// addresses. Conservative: unknown / unresolvable hosts are rejected.
fn url_is_public_http(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return false;
    }
    let host = match extract_host(url) {
        Some(h) => h,
        None => return false,
    };
    use std::net::ToSocketAddrs;
    match (host.as_str(), 0u16).to_socket_addrs() {
        Ok(addrs) => {
            let mut any = false;
            for a in addrs {
                any = true;
                if !ip_is_global(a.ip()) {
                    return false;
                }
            }
            any
        }
        Err(_) => false,
    }
}

// GET that re-checks the SSRF guard on EVERY hop. ureq follows redirects
// blindly, so a public URL could 302 into an internal one — we disable ureq's
// own following (redirects(0)) and follow manually, validating each Location.
fn get_guarded(
    agent: &ureq::Agent,
    url: &str,
    max_redirects: u32,
    user_agent: Option<&str>,
) -> Result<ureq::Response, String> {
    let mut current = url.to_string();
    for _ in 0..=max_redirects {
        if !url_is_public_http(&current) {
            return Err("blocked: non-public or non-http host".into());
        }
        let mut req = agent.get(&current);
        if let Some(ua) = user_agent {
            req = req.set("User-Agent", ua);
        }
        let resp = match req.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(code, r)) if code >= 300 && code < 400 => r,
            Err(ureq::Error::Status(code, _)) => return Err(format!("http {code}")),
            Err(e) => return Err(e.to_string()),
        };
        let status = resp.status();
        if status >= 300 && status < 400 {
            match resp.header("location") {
                Some(loc) => {
                    current = resolve_url(&current, loc);
                    continue;
                }
                None => return Ok(resp),
            }
        }
        return Ok(resp);
    }
    Err("too many redirects".into())
}

// Cap downloaded media so a huge/slow URL can't exhaust memory or hang a thread.
const MAX_DOWNLOAD_BYTES: u64 = 40 * 1024 * 1024; // 40 MiB

async fn download_bytes(url: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(10))
            .timeout_read(std::time::Duration::from_secs(30))
            // Overall wall-clock cap so a slow-trickle server can't pin the
            // blocking thread indefinitely (per-read timeout alone resets).
            .timeout(std::time::Duration::from_secs(60))
            .redirects(0) // we follow manually with per-hop SSRF checks
            .build();
        let resp = get_guarded(&agent, &url, 3, None)?;
        let mut buf = Vec::new();
        resp.into_reader()
            .take(MAX_DOWNLOAD_BYTES + 1)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        if buf.len() as u64 > MAX_DOWNLOAD_BYTES {
            return Err("file too large".into());
        }
        Ok::<Vec<u8>, String>(buf)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn unique_path(dir: std::path::PathBuf, name: &str) -> std::path::PathBuf {
    let mut path = dir.join(name);
    if !path.exists() {
        return path;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.to_string(), String::new()),
    };
    let mut i = 1;
    loop {
        path = dir.join(format!("{stem}-{i}{ext}"));
        if !path.exists() {
            return path;
        }
        i += 1;
    }
}

// Download an image and save it to the user's Downloads folder. Returns the path.
#[tauri::command]
async fn save_image(app: AppHandle, url: String) -> Result<String, String> {
    use tauri::Manager;
    let bytes = download_bytes(url.clone()).await?;
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;
    let path = unique_path(dir, &safe_filename(&filename_from_url(&url), "image.jpg"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// --- Credentials: AES-256-GCM encrypted secrets stored in the app data dir ----
// Uses a random key file kept locally (no Keychain, so no permission prompts).
use std::collections::HashMap;
use std::path::PathBuf;

fn secrets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Serialize all read-modify-write access to the key/secrets files so concurrent
// set/get/delete commands (run on a thread pool) can't race and lose data or
// generate two different keys.
static SECRETS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

// Write bytes atomically (temp file + rename) so a crash mid-write can't leave a
// truncated file. On Unix, restrict the file to the owner (0600).
fn write_private_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    {
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().ok();
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn local_key(app: &AppHandle) -> Result<[u8; 32], String> {
    use rand::RngCore;
    let path = secrets_dir(app)?.join("secret.key");
    if let Ok(bytes) = std::fs::read(&path) {
        if bytes.len() == 32 {
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            return Ok(k);
        }
    }
    let mut k = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut k);
    write_private_atomic(&path, &k)?;
    Ok(k)
}

fn read_secrets(app: &AppHandle) -> HashMap<String, Vec<u8>> {
    secrets_dir(app)
        .ok()
        .and_then(|d| std::fs::read(d.join("secrets.json")).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_secrets(app: &AppHandle, map: &HashMap<String, Vec<u8>>) -> Result<(), String> {
    let path = secrets_dir(app)?.join("secrets.json");
    let bytes = serde_json::to_vec(map).map_err(|e| e.to_string())?;
    write_private_atomic(&path, &bytes)
}

fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, AeadCore, KeyInit};
    use aes_gcm::Aes256Gcm;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut rand::rngs::OsRng);
    let ct = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt(key: &[u8; 32], blob: &[u8]) -> Result<String, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    if blob.len() < 12 {
        return Err("bad blob".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&blob[..12]);
    let pt = cipher.decrypt(nonce, &blob[12..]).map_err(|e| e.to_string())?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

// --- iCloud Drive sync (file-based; no entitlement / signing needed) ---------
// We just read/write a JSON in the user's iCloud Drive, which macOS syncs across
// their Macs automatically. Only settings + blacklist are synced (never the
// password). Returns available=false if iCloud Drive isn't set up.

fn icloud_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")?;
    let root = std::path::PathBuf::from(home).join("Library/Mobile Documents/com~apple~CloudDocs");
    if root.is_dir() {
        Some(root.join("MacPTT"))
    } else {
        None
    }
}

#[tauri::command]
fn icloud_status() -> serde_json::Value {
    match icloud_dir() {
        Some(dir) => {
            let content = std::fs::read_to_string(dir.join("sync.json")).ok();
            serde_json::json!({ "available": true, "content": content })
        }
        None => serde_json::json!({ "available": false, "content": null }),
    }
}

#[tauri::command]
fn icloud_write(content: String) -> Result<(), String> {
    let dir = icloud_dir().ok_or_else(|| "iCloud Drive 未啟用".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("sync.json");
    let tmp = dir.join("sync.json.tmp");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

// Holds the update found by check_update so install_update can apply it.
struct PendingUpdate(std::sync::Mutex<Option<tauri_plugin_updater::Update>>);

// Returns the new version string if an update is available (and stashes it for
// install_update), or None if already up to date. Errors (no manifest / offline)
// propagate so the UI can stay quiet on a silent check.
#[tauri::command]
async fn check_update(
    app: AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let version = update.version.clone();
            *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(update);
            Ok(Some(version))
        }
        None => Ok(None),
    }
}

// Downloads + installs the update stashed by check_update, then relaunches.
#[tauri::command]
async fn install_update(
    app: AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or_else(|| "沒有待安裝的更新".to_string())?;
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
fn set_gesture_enabled(enabled: bool) {
    #[cfg(target_os = "macos")]
    macos_gestures::set_enabled(enabled);
    #[cfg(not(target_os = "macos"))]
    let _ = enabled;
}

#[tauri::command]
fn set_password(app: AppHandle, account: String, password: String) -> Result<(), String> {
    let _guard = SECRETS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let key = local_key(&app)?;
    let blob = encrypt(&key, &password)?;
    let mut map = read_secrets(&app);
    map.insert(account, blob);
    write_secrets(&app, &map)
}

#[tauri::command]
fn get_password(app: AppHandle, account: String) -> Result<String, String> {
    let _guard = SECRETS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let map = read_secrets(&app);
    match map.get(&account) {
        Some(blob) => decrypt(&local_key(&app)?, blob),
        None => Ok(String::new()),
    }
}

#[tauri::command]
fn delete_password(app: AppHandle, account: String) -> Result<(), String> {
    let _guard = SECRETS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut map = read_secrets(&app);
    map.remove(&account);
    write_secrets(&app, &map)
}

// Return the system accent color (System Settings ▸ Appearance) as "#rrggbb" so
// the UI can tint itself to match macOS. Falls back to the default system blue.
// Direct read (no main-thread marshalling): reading these immutable NSColor
// objects is fast and safe in practice, and must NOT block the UI thread.
#[cfg(target_os = "macos")]
#[tauri::command]
fn system_accent_color() -> String {
    use objc2_app_kit::{NSColor, NSColorSpace};
    let color = NSColor::controlAccentColor();
    if let Some(c) = color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) {
        let r = (c.redComponent() * 255.0).round() as i64;
        let g = (c.greenComponent() * 255.0).round() as i64;
        let b = (c.blueComponent() * 255.0).round() as i64;
        return format!("#{:02x}{:02x}{:02x}", r, g, b);
    }
    "#0a84ff".into()
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn system_accent_color() -> String {
    "#0a84ff".into()
}

// Reduce a caller-supplied name to a safe single path component (no traversal,
// no separators), so a save can't escape the target directory.
fn safe_filename(name: &str, fallback: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .trim()
        .trim_start_matches('.');
    if base.is_empty() {
        fallback.to_string()
    } else {
        base.to_string()
    }
}

// Save arbitrary text (e.g. exported blacklist) to the Downloads folder.
#[tauri::command]
async fn save_text_file(app: AppHandle, filename: String, content: String) -> Result<String, String> {
    use tauri::Manager;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let path = unique_path(dir, &safe_filename(&filename, "export.txt"));
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// Download an image to a temp file and show the native macOS share sheet
// (AirDrop / Messages / Mail / …) anchored to the app window.
#[tauri::command]
async fn share_image(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    let bytes = download_bytes(url.clone()).await?;
    let path = unique_path(std::env::temp_dir(), &safe_filename(&filename_from_url(&url), "image.jpg"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || unsafe {
                macos_share::show_share_sheet(&path_str, ns_window as *mut std::ffi::c_void);
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&window, path_str);
    }
    Ok(())
}

// Share a web URL (e.g. the article link) through the native share sheet.
#[tauri::command]
async fn share_text(window: tauri::WebviewWindow, text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || unsafe {
                macos_share::show_share_url(&text, ns_window as *mut std::ffi::c_void);
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&window, text);
    }
    Ok(())
}

#[derive(serde::Serialize, Default)]
struct LinkPreview {
    title: String,
    description: String,
    image: String,
    site: String,
}

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

fn domain_of(url: &str) -> String {
    let s = url.splitn(2, "://").nth(1).unwrap_or(url);
    s.split('/').next().unwrap_or("").to_string()
}

fn resolve_url(base: &str, target: &str) -> String {
    if target.starts_with("http") {
        return target.to_string();
    }
    let scheme = base.split("://").next().unwrap_or("https");
    if target.starts_with("//") {
        return format!("{scheme}:{target}");
    }
    if target.starts_with('/') {
        return format!("{scheme}://{}{}", domain_of(base), target);
    }
    target.to_string()
}

fn parse_link_preview(html: &str, base_url: &str) -> LinkPreview {
    use regex::Regex;
    let meta_re = Regex::new(r#"(?is)<meta\b[^>]*>"#).unwrap();
    let get_attr = |tag: &str, attr: &str| -> Option<String> {
        let re = Regex::new(&format!(
            r#"(?is)\b{}\s*=\s*(?:"([^"]*)"|'([^']*)')"#,
            regex::escape(attr)
        ))
        .ok()?;
        let c = re.captures(tag)?;
        c.get(1).or_else(|| c.get(2)).map(|m| m.as_str().to_string())
    };

    let mut p = LinkPreview::default();
    for m in meta_re.find_iter(html) {
        let tag = m.as_str();
        let key = get_attr(tag, "property").or_else(|| get_attr(tag, "name"));
        let content = get_attr(tag, "content");
        if let (Some(k), Some(v)) = (key, content) {
            let v = html_unescape(&v);
            match k.to_lowercase().as_str() {
                "og:title" => {
                    if p.title.is_empty() {
                        p.title = v;
                    }
                }
                "og:description" | "description" => {
                    if p.description.is_empty() {
                        p.description = v;
                    }
                }
                "og:image" | "og:image:url" | "og:image:secure_url" => {
                    if p.image.is_empty() {
                        p.image = v;
                    }
                }
                "og:site_name" => {
                    if p.site.is_empty() {
                        p.site = v;
                    }
                }
                _ => {}
            }
        }
    }
    if p.title.is_empty() {
        if let Some(c) = Regex::new(r#"(?is)<title[^>]*>(.*?)</title>"#)
            .unwrap()
            .captures(html)
        {
            p.title = html_unescape(c.get(1).unwrap().as_str().trim());
        }
    }
    if p.site.is_empty() {
        p.site = domain_of(base_url);
    }
    if !p.image.is_empty() {
        p.image = resolve_url(base_url, &p.image);
    }
    p
}

// Fetch a URL natively and extract its Open Graph / title preview metadata.
#[tauri::command]
async fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(6))
            .timeout_read(std::time::Duration::from_secs(8))
            .redirects(0) // follow manually with per-hop SSRF checks
            .build();
        let resp = get_guarded(
            &agent,
            &url,
            3,
            Some("Mozilla/5.0 (Macintosh) MacPTT/1.0"),
        )?;
        let mut buf = Vec::new();
        resp.into_reader()
            .take(512 * 1024)
            .read_to_end(&mut buf)
            .map_err(|e| e.to_string())?;
        let html = String::from_utf8_lossy(&buf);
        Ok::<LinkPreview, String>(parse_link_preview(&html, &url))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
mod macos_share {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSSharingServicePicker, NSView, NSWindow};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};

    // The share picker + its backing items must outlive the open popover. Keep
    // exactly ONE share's worth alive in a main-thread-only slot; opening a new
    // share releases the previous set (AppKit still retains anything on screen),
    // so this no longer leaks on every share.
    thread_local! {
        static SHARE_KEEPALIVE: std::cell::RefCell<
            Option<(
                Retained<NSSharingServicePicker>,
                Retained<NSArray<NSURL>>,
                Retained<NSURL>,
            )>,
        > = const { std::cell::RefCell::new(None) };
    }

    /// Present the share sheet for a single NSURL (file or web). Main thread only.
    unsafe fn present(url_obj: Retained<NSURL>, ns_window: *mut std::ffi::c_void) {
        if ns_window.is_null() {
            return;
        }
        let _mtm = MainThreadMarker::new_unchecked();
        let window: &NSWindow = &*(ns_window as *const NSWindow);
        let content_view: Retained<NSView> = match window.contentView() {
            Some(v) => v,
            None => return,
        };

        // NSArray<NSURL> reinterpreted as NSArray<AnyObject> (generic is phantom).
        let items: Retained<NSArray<NSURL>> = NSArray::from_slice(&[&*url_obj]);
        let items_any: &NSArray<AnyObject> =
            &*((&*items as *const NSArray<NSURL>) as *const NSArray<AnyObject>);

        let picker =
            NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), items_any);

        // Anchor a 1x1 rect near the centre of the view so the popover is clearly
        // on-screen (full-bounds + MinYEdge can land off-screen below the window).
        let b = content_view.bounds();
        let rect = NSRect::new(
            NSPoint::new(b.size.width / 2.0, b.size.height / 2.0),
            NSSize::new(1.0, 1.0),
        );
        picker.showRelativeToRect_ofView_preferredEdge(rect, &content_view, NSRectEdge::NSMinYEdge);

        // Hold this share's objects alive (releasing the previous share's).
        SHARE_KEEPALIVE.with(|k| {
            *k.borrow_mut() = Some((picker, items, url_obj));
        });
    }

    pub unsafe fn show_share_sheet(path: &str, ns_window: *mut std::ffi::c_void) {
        let file_url = NSURL::fileURLWithPath(&NSString::from_str(path));
        present(file_url, ns_window);
    }

    pub unsafe fn show_share_url(url: &str, ns_window: *mut std::ffi::c_void) {
        if let Some(web_url) = NSURL::URLWithString(&NSString::from_str(url)) {
            present(web_url, ns_window);
        }
    }

    /// Constrain the window to its current aspect ratio: the user can resize
    /// freely but the proportions stay locked. Main thread only.
    pub unsafe fn lock_aspect_ratio(ns_window: *mut std::ffi::c_void) {
        if ns_window.is_null() {
            return;
        }
        let _mtm = MainThreadMarker::new_unchecked();
        let window: &NSWindow = &*(ns_window as *const NSWindow);
        let size = window.frame().size;
        if size.width > 0.0 && size.height > 0.0 {
            window.setAspectRatio(size);
        }
    }
}

// Three-finger vertical trackpad swipe → PageUp / PageDown. The webview can't see
// finger count, so we read raw NSTouch from a local event monitor. (macOS reserves
// 3-finger up/down for Mission Control / App Exposé by default — the user must
// remap those in System Settings ▸ Trackpad for this to reach the app.)
#[cfg(target_os = "macos")]
mod macos_gestures {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventType, NSTouchPhase, NSWindow};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};

    // Opt-in: the "三指上下翻頁" setting toggles this. While false, handle() does
    // nothing — the trackpad behaves completely normally (no cursor pinning).
    static GESTURE_ENABLED: AtomicBool = AtomicBool::new(false);
    pub fn set_enabled(on: bool) {
        GESTURE_ENABLED.store(on, Ordering::Relaxed);
    }

    // --- CoreGraphics cursor control (freeze the system arrow during gestures) ---
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    type CGEventRef = *mut std::ffi::c_void;
    type CGEventSourceRef = *mut std::ffi::c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventCreate(source: CGEventSourceRef) -> CGEventRef;
        fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
        fn CGWarpMouseCursorPosition(new_cursor_position: CGPoint) -> i32;
        fn CGAssociateMouseAndMouseCursorPosition(connected: i32) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    // Current cursor position in CoreGraphics global coords (top-left origin) —
    // exactly what CGWarpMouseCursorPosition expects, so no Y flipping needed.
    unsafe fn current_cursor() -> CGPoint {
        let e = CGEventCreate(std::ptr::null_mut());
        let p = CGEventGetLocation(e);
        if !e.is_null() {
            CFRelease(e as *const std::ffi::c_void);
        }
        p
    }

    struct GState {
        tracking: bool,
        start_y: f64,
        fired: bool,
        // Where the cursor was pinned when the current 2+-finger gesture began.
        // None when no gesture is active.
        pin: Option<(f64, f64)>,
    }
    static GESTURE: Mutex<GState> = Mutex::new(GState {
        tracking: false,
        start_y: 0.0,
        fired: false,
        pin: None,
    });
    // When the cursor was last warped. A gap longer than a couple frames means
    // the previous gesture ended (release frame missed, e.g. focus loss), so the
    // next 2-finger frame must re-capture rather than warp to a stale point.
    static LAST_WARP: Mutex<Option<Instant>> = Mutex::new(None);

    // Recent (time, x, y) cursor samples in CG coords, recorded on plain mouse
    // moves while no gesture is active. Lets a starting gesture warp back to the
    // pre-touch position instead of the spot the first finger already nudged to.
    static CURSOR_HIST: Mutex<Vec<(Instant, f64, f64)>> = Mutex::new(Vec::new());

    const THRESHOLD: f64 = 0.12; // fraction of trackpad height to count as a swipe
    const PRE_NUDGE_MS: u64 = 90; // rewind this far to clear first-finger drift

    // The cursor position from ~PRE_NUDGE_MS ago (newest sample at least that old),
    // i.e. just before the finger landed. Falls back to the oldest sample, then to
    // the live cursor if there is no history at all.
    fn pre_nudge_pos(now: Instant) -> CGPoint {
        let h = CURSOR_HIST.lock().unwrap_or_else(|e| e.into_inner());
        let target = now
            .checked_sub(Duration::from_millis(PRE_NUDGE_MS))
            .unwrap_or(now);
        let mut chosen: Option<(f64, f64)> = None;
        for &(t, x, y) in h.iter() {
            if t <= target {
                chosen = Some((x, y));
            }
        }
        let chosen = chosen.or_else(|| h.first().map(|&(_, x, y)| (x, y)));
        match chosen {
            Some((x, y)) => CGPoint { x, y },
            None => unsafe { current_cursor() },
        }
    }

    fn handle(event: &NSEvent, app: &AppHandle) {
        // Disabled in settings → leave the trackpad entirely alone.
        if !GESTURE_ENABLED.load(Ordering::Relaxed) {
            return;
        }
        let now = Instant::now();
        let mut st = GESTURE.lock().unwrap_or_else(|e| e.into_inner());

        // While no gesture is pinned, keep sampling the cursor so a gesture that
        // starts in a moment can rewind past the first-finger drift.
        if st.pin.is_none() {
            let cur = unsafe { current_cursor() };
            let mut h = CURSOR_HIST.lock().unwrap_or_else(|e| e.into_inner());
            h.push((now, cur.x, cur.y));
            let cutoff = now.checked_sub(Duration::from_millis(400)).unwrap_or(now);
            while h.len() > 1 && h[0].0 < cutoff {
                h.remove(0);
            }
        }

        // Plain mouse moves are only for the sampling above — no touch handling.
        if event.r#type() == NSEventType::MouseMoved {
            return;
        }

        let touches = event.touchesMatchingPhase_inView(NSTouchPhase::Touching, None);
        let count = touches.count();

        // While 2+ fingers are down, keep refreshing a short window in the webview
        // so it (a) ignores click-to-enter (covers the press AND the release click)
        // and (b) freezes the mouse-browsing hover so paging doesn't drag it.
        if count >= 2 {
            let _ = app.emit("gesture://multitouch", ());

            // Freeze the SYSTEM arrow cursor. With "three-finger drag" enabled in
            // macOS, a 3-finger swipe drags the pointer; users only want to page.
            // Pin on the first frame, then warp back every frame. CGWarp also
            // suppresses trackpad-driven movement for ~250ms, so this both pins the
            // cursor AND self-recovers if a gesture-end is missed.
            let mut lw = LAST_WARP.lock().unwrap_or_else(|e| e.into_inner());
            let fresh = match (*lw, st.pin) {
                (Some(t), Some(_)) => now.duration_since(t).as_millis() <= 120,
                _ => false,
            };
            unsafe {
                let p = if fresh {
                    let (x, y) = st.pin.unwrap();
                    CGPoint { x, y }
                } else {
                    // New gesture (or stale pin): pin to where the cursor was just
                    // BEFORE the first finger nudged it, not its drifted spot.
                    let c = pre_nudge_pos(now);
                    st.pin = Some((c.x, c.y));
                    c
                };
                CGWarpMouseCursorPosition(p);
            }
            *lw = Some(now);
        } else if st.pin.is_some() {
            // Fingers lifted: release the cursor and restore immediate tracking.
            st.pin = None;
            unsafe {
                CGAssociateMouseAndMouseCursorPosition(1);
            }
        }

        if count == 3 {
            let arr = touches.allObjects();
            let n = arr.count();
            if n == 0 {
                return;
            }
            let mut sum = 0.0;
            for i in 0..n {
                let t = arr.objectAtIndex(i);
                sum += t.normalizedPosition().y;
            }
            let avg = sum / (n as f64);
            if !st.tracking {
                st.tracking = true;
                st.start_y = avg;
                st.fired = false;
            } else if !st.fired {
                let dy = avg - st.start_y; // normalizedPosition y: 0 bottom .. 1 top
                if dy.abs() > THRESHOLD {
                    st.fired = true;
                    // Reversed to match PTT paging direction (per user): swipe up
                    // = next page (PageDown), swipe down = previous page (PageUp).
                    let ev = if dy > 0.0 {
                        "gesture://pagedown"
                    } else {
                        "gesture://pageup"
                    };
                    let _ = app.emit(ev, ());
                }
            }
        } else if st.tracking {
            st.tracking = false;
        }
    }

    /// Main thread only. ns_window is the NSWindow pointer.
    pub unsafe fn install(app: AppHandle, ns_window: *mut std::ffi::c_void) {
        if ns_window.is_null() {
            return;
        }
        let window: &NSWindow = &*(ns_window as *const NSWindow);
        // The content view must accept touches for the OS to deliver NSTouch data.
        if let Some(view) = window.contentView() {
            view.setAcceptsTouchEvents(true);
        }
        // Generate mouse-moved events so we can sample the pre-gesture cursor.
        window.setAcceptsMouseMovedEvents(true);
        let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            handle(event.as_ref(), &app);
            event.as_ptr()
        });
        let mask = NSEventMask::Gesture
            | NSEventMask::BeginGesture
            | NSEventMask::EndGesture
            | NSEventMask::MouseMoved;
        let token = NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block);
        std::mem::forget(token);
        std::mem::forget(block);
    }
}

// Native macOS application menu: gives the app proper ⌘-shortcuts (Settings ⌘,,
// standard Edit copy/paste/select-all, Quit, Window, About) instead of the bare
// default. Custom items emit events the frontend listens for.
fn build_app_menu<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{
        AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
    };

    let settings = MenuItemBuilder::with_id("settings", "設定…")
        .accelerator("Cmd+,")
        .build(app)?;
    let check_update = MenuItemBuilder::with_id("check_update", "檢查更新…").build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", "重新整理畫面")
        .accelerator("Cmd+R")
        .build(app)?;
    let reconnect = MenuItemBuilder::with_id("reconnect", "重新連線")
        .accelerator("Cmd+Shift+R")
        .build(app)?;
    let find = MenuItemBuilder::with_id("find", "在本頁尋找…")
        .accelerator("Cmd+F")
        .build(app)?;

    let about_meta = AboutMetadata {
        name: Some("MacPTT".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        copyright: Some("© 2026 MacPTT".into()),
        comments: Some("Native macOS PTT BBS client".into()),
        ..Default::default()
    };

    // Explicit text so the item reads "關於 MacPTT" (the default pulls the bundle
    // name, which can be stale in dev builds).
    let about_item = PredefinedMenuItem::about(app, Some("關於 MacPTT"), Some(about_meta))?;
    let app_menu = SubmenuBuilder::new(app, "MacPTT")
        .item(&about_item)
        .item(&check_update)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "編輯")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "檢視")
        .item(&refresh)
        .item(&reconnect)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "視窗")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ConnState::default())
        .manage(PendingUpdate(std::sync::Mutex::new(None)))
        .setup(|app| {
            // Lock the window's aspect ratio (resizable, but keeps proportions).
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(nsw) = window.ns_window() {
                        let ptr = nsw as usize;
                        let app_handle = app.handle().clone();
                        let _ = window.run_on_main_thread(move || unsafe {
                            macos_share::lock_aspect_ratio(ptr as *mut std::ffi::c_void);
                            macos_gestures::install(
                                app_handle,
                                ptr as *mut std::ffi::c_void,
                            );
                        });
                    }
                }
            }
            Ok(())
        })
        .menu(|handle| build_app_menu(handle))
        .on_menu_event(|app, event| {
            // Forward to the webview; the frontend (js/native_menu.js) acts on it.
            match event.id().as_ref() {
                "settings" => {
                    let _ = app.emit("menu://settings", ());
                }
                "refresh" => {
                    let _ = app.emit("menu://refresh", ());
                }
                "reconnect" => {
                    let _ = app.emit("menu://reconnect", ());
                }
                "check_update" => {
                    let _ = app.emit("menu://check-update", ());
                }
                "find" => {
                    let _ = app.emit("menu://find", ());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            ws_connect,
            ws_send,
            ws_disconnect,
            open_external,
            save_image,
            share_image,
            share_text,
            fetch_link_preview,
            save_text_file,
            set_password,
            get_password,
            delete_password,
            system_accent_color,
            icloud_status,
            icloud_write,
            set_gesture_enabled,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::IpAddr;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn ssrf_rejects_non_global_v4() {
        for s in [
            "127.0.0.1",       // loopback
            "10.0.0.1",        // private
            "192.168.1.1",     // private
            "172.16.0.1",      // private
            "169.254.0.1",     // link-local
            "100.64.0.1",      // CGNAT
            "192.0.0.1",       // 192.0.0.0/24
            "0.0.0.0",         // unspecified
            "255.255.255.255", // broadcast
            "224.0.0.1",       // multicast
        ] {
            assert!(!ip_is_global(ip(s)), "{s} should be non-global");
        }
    }

    #[test]
    fn ssrf_accepts_public_v4() {
        for s in ["1.1.1.1", "8.8.8.8", "140.112.172.11"] {
            assert!(ip_is_global(ip(s)), "{s} should be global");
        }
    }

    #[test]
    fn ssrf_rejects_embedded_and_special_v6() {
        for s in [
            "::1",              // loopback
            "::",               // unspecified
            "fe80::1",          // link-local
            "fc00::1",          // ULA
            "fd00::1",          // ULA
            "::ffff:127.0.0.1", // IPv4-mapped loopback
            "::ffff:10.0.0.1",  // IPv4-mapped private
            "2002:7f00:0001::", // 6to4 embedding 127.0.0.1
            "64:ff9b::a00:1",   // NAT64 embedding 10.0.0.1
            "2001:db8::1",      // documentation
            "ff02::1",          // multicast
        ] {
            assert!(!ip_is_global(ip(s)), "{s} should be non-global");
        }
    }

    #[test]
    fn ssrf_accepts_public_v6() {
        assert!(ip_is_global(ip("2606:4700:4700::1111"))); // Cloudflare DNS
    }

    #[test]
    fn extract_host_handles_userinfo_ports_ipv6() {
        assert_eq!(extract_host("https://ws.ptt.cc/bbs").as_deref(), Some("ws.ptt.cc"));
        assert_eq!(extract_host("https://user:pw@evil.com/x").as_deref(), Some("evil.com"));
        assert_eq!(extract_host("http://[::1]:8080/x").as_deref(), Some("::1"));
        assert_eq!(extract_host("https://host:443").as_deref(), Some("host"));
        assert_eq!(extract_host("notaurl"), None);
    }

    #[test]
    fn url_public_http_rejects_bad_scheme_and_loopback() {
        // No network needed: scheme check + loopback resolution only.
        assert!(!url_is_public_http("ftp://example.com"));
        assert!(!url_is_public_http("file:///etc/passwd"));
        assert!(!url_is_public_http("http://127.0.0.1/x"));
        assert!(!url_is_public_http("http://localhost/x"));
    }

    #[test]
    fn aes_roundtrip() {
        let key = [7u8; 32];
        let secret = "p@ssw0rd 測試";
        let blob = encrypt(&key, secret).unwrap();
        assert_ne!(&blob[12..], secret.as_bytes(), "ciphertext must differ from plaintext");
        assert_eq!(decrypt(&key, &blob).unwrap(), secret);
    }

    #[test]
    fn aes_wrong_key_fails() {
        let blob = encrypt(&[1u8; 32], "secret").unwrap();
        assert!(decrypt(&[2u8; 32], &blob).is_err());
    }

    #[test]
    fn aes_nonce_is_random() {
        let key = [3u8; 32];
        assert_ne!(encrypt(&key, "x").unwrap(), encrypt(&key, "x").unwrap());
    }
}

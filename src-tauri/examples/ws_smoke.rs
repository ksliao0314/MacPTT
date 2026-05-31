// Headless smoke test of the native (Rust) connection path used by the Tauri app.
// Proves: native-tls TLS to wss works, PTT accepts Origin https://term.ptt.cc,
// and rejects others — exactly what the in-app ws_connect relies on.
//
//   cargo run --example ws_smoke
use futures_util::StreamExt;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    println!("Testing wss://ws.ptt.cc/bbs from native Rust\n");
    for origin in ["https://term.ptt.cc", "tauri://localhost"] {
        match try_connect(origin).await {
            Ok(n) => println!("• Origin {origin:<28} ACCEPTED, first frame {n} bytes"),
            Err(e) => println!("• Origin {origin:<28} REJECTED/NO-DATA: {e}"),
        }
    }
}

async fn try_connect(origin: &str) -> Result<usize, String> {
    let mut req = "wss://ws.ptt.cc/bbs"
        .into_client_request()
        .map_err(|e| e.to_string())?;
    req.headers_mut()
        .insert("Origin", origin.parse().map_err(|_| "bad origin".to_string())?);
    let (mut ws, _resp) = connect_async(req).await.map_err(|e| e.to_string())?;
    let msg = tokio::time::timeout(std::time::Duration::from_secs(8), ws.next())
        .await
        .map_err(|_| "timeout".to_string())?
        .ok_or_else(|| "closed before data".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(match msg {
        Message::Binary(b) => b.len(),
        Message::Text(t) => t.len(),
        _ => 0,
    })
}

# MacPTT

原生 macOS 的 **PTT BBS** 客戶端。以終端機核心連線 PTT，並在上面疊一層「加值體驗」——圖片 / 連結 / YouTube 內嵌預覽、黑名單作者淡化、原生分享、滑鼠瀏覽、原生選單列等。

> A native macOS client for the PTT BBS — a terminal core over WebSocket, wrapped in a Tauri app with image/link previews, blacklist fading, native share, and macOS-native chrome.

衍生自 [robertabcd/PttChrome](https://github.com/robertabcd/PttChrome)（PTT 官方 `term.ptt.cc` 的網頁終端機引擎，原作 [iamchucky](https://github.com/iamchucky)），以相同的 **GPL-2.0** 授權釋出。

---

## 功能

- **連線 / 登入**：Rust 端 WebSocket 連 `wss://ws.ptt.cc/bbs`，設定 PTT 白名單要求的 `Origin: https://term.ptt.cc`（瀏覽器頁面做不到、原生 app 才能）。自動登入（帳密**本機 AES-256-GCM 加密**、不上傳），偵測密碼錯誤即停止避免被鎖。
- **閱讀加值**：圖片自動內嵌顯示、連結 OG 預覽卡、YouTube 縮圖預覽（點擊以系統瀏覽器開啟）、文章網址分享。
- **黑名單**：作者淡化、右鍵加入 / 移除、匯入匯出、內建「PTT 大秘寶」名單。
- **滑鼠瀏覽**：hover 高亮、邊緣置頂/置底、往右滑返回上一層，並對觸控板做平滑節流。
- **原生分享**：圖片 / 網址走 macOS 分享面板（AirDrop / 訊息 / 郵件…）。
- **macOS 原生**：應用程式選單列（⌘, 設定、⌘R 重整、編輯複製貼上、關於）、記住視窗大小位置、鎖定視窗比例、深色外觀、跟隨系統強調色。
- **iCloud 同步**（可選）：透過 iCloud Drive 在多台 Mac 間同步**設定與黑名單**（密碼不同步）。
- **安全**：啟用 CSP、對連結/圖片預覽做 SSRF 防護（擋內網 / loopback / 雲端 metadata，含 IPv6 與轉址繞過修補）、WebSocket 連線限定 `*.ptt.cc`。

設定有兩個入口：右上角 **⚙ 設定**，或終端畫面**按右鍵 → 設定**。

---

## 安裝

到 [Releases](../../releases) 下載 `MacPTT_x.y.z_aarch64.dmg`（**Apple Silicon**），拖進「應用程式」。

本程式**未經 Apple 簽章 / 公證**，第一次開啟會被 Gatekeeper 擋。請任一方式解除：

- 系統設定 → 隱私權與安全性 → 找到被擋的 MacPTT → **「仍要打開」**，或
- 終端機執行：`xattr -cr "/Applications/MacPTT.app"`

> ⚠️ macOS 15 (Sequoia) 之後，舊的「右鍵→打開」捷徑已移除，請用上面任一方式。

---

## 從原始碼建置

需要 **Node.js**、**Rust**、**Xcode Command Line Tools**。

```bash
# 1. 安裝相依
npm install
cd frontend && npm install && cd ..

# 2. 建置前端（webpack 4 需要 legacy OpenSSL flag）
cd frontend && NODE_OPTIONS=--openssl-legacy-provider npm run build && cd ..

# 3. 組裝前端到 src/（把 CDN 改成本地 vendor）
node scripts/build-frontend.cjs

# 4. 開發 / 打包
npm run tauri dev      # 開發視窗
npm run tauri build    # 產物在 src-tauri/target/release/bundle/
```

改了前端（`frontend/src`）→ 重跑步驟 2–3。改了 Rust（`src-tauri/src`）→ `npm run tauri build` 會自動重編。

---

## 架構

```
WKWebView（前端）                              Rust（src-tauri）
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ PttChrome 終端機核心          │              │ ws_connect / ws_send /        │
│  TermView / ANSI / Telnet …   │   IPC        │ ws_disconnect                 │
│  websocket.js = TauriWebsocket├─────────────▶│ tokio-tungstenite + native-tls│──▶ wss://ws.ptt.cc/bbs
│  收/送 bytes、open/close 事件 │◀── events ───│ Origin: https://term.ptt.cc   │
└──────────────────────────────┘              └──────────────────────────────┘
                                               + 原生分享 / 開外部連結 / 連結預覽 /
                                                 本機加密憑證 / iCloud 同步 / 系統選單
```

Rust 是「位元組水管 + 原生能力」；所有 Telnet / ANSI / Big5 邏輯都在前端 JS。前端對網頁碼的改動都以 `window.__TAURI__` 偵測，**只在 Tauri 內生效**，所以同一份前端碼仍可建成純網頁版。

```
.
├── src-tauri/        Rust 原生層（連線橋接、分享、加密憑證、選單、iCloud…）
├── frontend/         PttChrome 前端 fork（終端機核心 + 加值功能）
├── scripts/          build-frontend.cjs（組裝前端到 src/）、generate_icon.py（產生 App 圖示）
├── src/              組裝後的前端（自動產生，已 gitignore）
├── CHANGELOG.md
└── README.md / LICENSE
```

---

## 授權

本專案以 **GNU General Public License v2.0** 釋出（見 [`LICENSE`](LICENSE)）。因衍生自 GPL-2.0 的 PttChrome，依其 copyleft 條款同樣採 GPL-2.0。

## 致謝

- **[PttChrome](https://github.com/robertabcd/PttChrome)** — 終端機核心基底（robertabcd，原作 iamchucky）· GPL-2.0
- **[Tauri](https://tauri.app)** · Apache-2.0 / MIT
- **React / Bootstrap / jQuery / Hammer.js / recompose / classnames** · MIT
- **tokio / tokio-tungstenite / ureq / regex / serde / aes-gcm / rand / objc2** · MIT、Apache-2.0
- **[PyPtt](https://github.com/PyPtt/PyPtt)** — 終端機操作序列參考
- **PTT 大秘寶**（內建黑名單）— 由 rhino0314 整理維護

---

## 免責聲明

MacPTT 是**非官方**的第三方 PTT 客戶端，與批踢踢實業坊無從屬關係。請遵守 PTT 的使用條款；帳號密碼僅儲存於你的本機（加密），不會上傳到任何伺服器。僅支援 Apple Silicon（arm64）。

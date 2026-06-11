// MacPTT — auto-update flow. Talks to the Rust check_update / install_update
// commands (tauri-plugin-updater) and shows the shared macOS HIG card.
import React from "react";
import ReactDOM from "react-dom";
import { MacAlert, InfoGlyph } from "../components/MacAlert";

export function setupUpdater() {
  if (typeof window === "undefined" || !window.__TAURI__) return;
  const listen = window.__TAURI__.event.listen;
  const invoke = window.__TAURI__.core.invoke;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const close = () => ReactDOM.unmountComponentAtNode(container);
  const show = el => ReactDOM.render(el, container);

  const info = (title, text) =>
    show(
      <MacAlert
        variant="info"
        icon={<InfoGlyph />}
        title={title}
        text={text}
        primaryLabel="好"
        onPrimary={close}
        onClose={close}
      />
    );

  function offerInstall(version) {
    show(
      <MacAlert
        variant="info"
        icon={<InfoGlyph />}
        title={"有新版本 " + version}
        text={"要下載並更新到 " + version + " 嗎？更新後 App 會自動重新啟動。"}
        primaryLabel="更新並重啟"
        onPrimary={() => {
          show(
            <MacAlert
              variant="info"
              icon={<InfoGlyph />}
              title="更新中…"
              text="正在下載並安裝，完成後會自動重新啟動，請稍候。"
            />
          );
          invoke("install_update").catch(e => info("更新失敗", String(e)));
        }}
        onClose={close}
      />
    );
  }

  async function check(manual) {
    try {
      const version = await invoke("check_update");
      if (version) offerInstall(version);
      else if (manual) info("已是最新版本", "你使用的已經是最新版 MacPTT。");
    } catch (e) {
      // Stay silent on the background check (e.g. no manifest yet / offline).
      if (manual) info("檢查更新失敗", String(e));
    }
  }

  // Menu bar: MacPTT → 檢查更新…
  listen("menu://check-update", () => check(true));

  // Quiet check shortly after launch — only surfaces if an update exists.
  setTimeout(() => check(false), 5000);
}

export default setupUpdater;

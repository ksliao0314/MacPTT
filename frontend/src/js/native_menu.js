// MacPTT — bridge the native macOS menu bar to the app.
// Rust (lib.rs) emits these events when the menu items are chosen.

export function setupNativeMenu(app) {
  if (typeof window === 'undefined' || !window.__TAURI__) return;
  var listen = window.__TAURI__.event.listen;

  listen('menu://settings', function() {
    if (app.openSettings) app.openSettings();
  });

  listen('menu://refresh', function() {
    // Ctrl-L tells PTT to redraw the current screen.
    if (app.connectState === 1 && app.conn) app.conn.convSend('\x0c');
  });
}

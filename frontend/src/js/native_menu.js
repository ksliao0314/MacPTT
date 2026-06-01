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

  listen('menu://reconnect', function() {
    // Drop the session and open a fresh one (re-runs auto-login).
    if (app.reconnect) app.reconnect();
  });

  // Three-finger trackpad swipe (detected natively in Rust) → PageUp / PageDown.
  // Gated by the "三指上下翻頁" setting (app.trackpadGestureEnabled). The native
  // side is also gated, but keep a JS guard for the brief startup window.
  function sendKey(seq) {
    if (!app.trackpadGestureEnabled) return;
    if (!app.modalShown && app.connectState === 1 && app.conn) app.conn.send(seq);
  }
  listen('gesture://pageup', function() { sendKey('\x1b[5~'); });
  listen('gesture://pagedown', function() { sendKey('\x1b[6~'); });

  // 2+-finger gesture in progress (refreshed every frame). While this window is
  // live we ignore click-to-enter (incl. the release click) and freeze the
  // mouse-browsing hover, so paging with three fingers neither enters a board/
  // article nor drags the cursor highlight.
  listen('gesture://multitouch', function() {
    if (!app.trackpadGestureEnabled) return;
    var now = Date.now();
    var wasActive = app._gestureUntil && now < app._gestureUntil;
    if (!wasActive && app.beginGestureFreeze) {
      // Leading edge of a new gesture — rewind any cursor drift from the first
      // finger landing before the OS recognised the multi-finger gesture.
      app.beginGestureFreeze(now);
    }
    app._gestureUntil = now + 400;
  });
}

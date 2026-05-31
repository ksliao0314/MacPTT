// PttChrome v3 — open external links in the system browser when running inside
// the Tauri shell. The webview's window.open / <a target="_blank"> don't reach
// the OS browser, so we route http(s) URLs to the Rust `open_external` command.
// No-op in a normal browser / extension (links work natively there).

const IS_TAURI = (typeof window !== 'undefined') && !!window.__TAURI__;

export function setupExternalOpen() {
  if (!IS_TAURI) return;

  var invoke = window.__TAURI__.core.invoke;
  function openExternal(url) {
    invoke('open_external', { url: String(url) }).catch(function(err) {
      console.error('[tauri] open_external failed:', err);
    });
  }
  // External = http(s) AND a different origin than the app itself. This is the
  // key guard: in-app menu/links use <a href="#"> whose resolved .href is the
  // app's own origin (e.g. http://127.0.0.1:1430/#) — those must NOT be opened
  // in the system browser.
  function isExternal(url) {
    if (!/^https?:\/\//i.test(url || '')) return false;
    try {
      return new URL(url).origin !== window.location.origin;
    } catch (e) {
      return false;
    }
  }

  // 1) window.open(url) — used by Google search / quick-search menu / open-url.
  var origOpen = window.open;
  window.open = function(url) {
    if (isExternal(url)) {
      openExternal(url);
      return null;
    }
    return origOpen ? origOpen.apply(window, arguments) : null;
  };

  // 2) Clicks on <a> links in posts (real clicks and the synthetic click that
  //    "open url in new tab" dispatches). Capture phase so we catch it first.
  //    Ignore in-app anchors (href="#" / same-origin) so the context menu and
  //    settings dialog keep working.
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el) return;
    var raw = el.getAttribute('href');
    if (!raw || raw.charAt(0) === '#') return; // in-app / empty anchor
    if (isExternal(el.href)) {
      e.preventDefault();
      e.stopPropagation();
      openExternal(el.href);
    }
  }, true);
}

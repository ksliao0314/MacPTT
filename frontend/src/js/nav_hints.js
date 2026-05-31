// PttChrome v3 — on-screen navigation hints.
//
//   left edge   -> the cursor becomes a "back" arrow (Left / 回上層); no label.
//   top edge    -> ⌃ 置頂 (Home) label
//   bottom edge -> ⌄ 置底 (End) label
//   left side   -> two fixed circular ▲/▼ buttons for PageUp / PageDown.
//
// Gated by pageState: 1=MENU, 2=LIST, 3=READING.

const BACK_CURSOR = 'url(' + require('../cursor/back.png') + ') 0 6, auto';

const KEY = {
  LEFT: '\x1b[D',
  HOME: '\x1b[1~',
  END: '\x1b[4~',
  PGUP: '\x1b[5~',
  PGDN: '\x1b[6~'
};

export function setupNavHints(app) {
  if (typeof document === 'undefined') return;
  if (app._navHintsSetup) return; // never install the listeners/interval twice
  app._navHintsSetup = true;
  var mainDisplay = app.view && app.view.mainDisplay;

  function send(seq) {
    if (app.connectState === 1 && app.conn) {
      app.conn.send(seq);
      if (app.setInputAreaFocus) app.setInputAreaFocus();
    }
  }

  // action may be a key string (sent to PTT) or a function.
  function bindClick(el, action) {
    el.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof action === 'function') action();
      else send(action);
    });
  }

  // --- top / bottom text labels (置頂 / 置底) ---
  function mkLabel(text, seq, pos) {
    var el = document.createElement('div');
    el.textContent = text;
    var s = el.style;
    s.position = 'fixed';
    s.zIndex = '2147483640';
    s.display = 'none';
    s.font = 'bold 15px sans-serif';
    s.color = '#fff';
    s.background = 'rgba(0,0,0,.55)';
    s.border = '1px solid rgba(255,255,255,.45)';
    s.borderRadius = '8px';
    s.padding = '7px 12px';
    s.cursor = 'pointer';
    s.userSelect = 'none';
    s.webkitUserSelect = 'none';
    for (var k in pos) s[k] = pos[k];
    el.addEventListener('mouseover', function() { s.background = 'rgba(0,0,0,.85)'; });
    el.addEventListener('mouseout', function() { s.background = 'rgba(0,0,0,.55)'; });
    bindClick(el, seq);
    document.body.appendChild(el);
    return el;
  }

  var home = mkLabel('⌃ 置頂', KEY.HOME, { left: '50%', top: '10px', transform: 'translateX(-50%)' });
  // Bottom edge "置底": in easy-reading mode the whole article (incl. pushthread)
  // is already loaded, so just scroll the page to the bottom — purely client
  // side, no mode switch / no PTT round-trip (reliable). Elsewhere send End.
  var end = mkLabel('⌄ 置底', function() {
    if (app.buf && app.buf.pageState === 3 && app.view && app.view.useEasyReadingMode) {
      var md = app.view.mainDisplay;
      if (md) md.scrollTop = md.scrollHeight;
    } else {
      send(KEY.END);
    }
    if (app.setInputAreaFocus) app.setInputAreaFocus();
  }, { left: '50%', bottom: '10px', transform: 'translateX(-50%)' });

  // --- fixed circular PageUp / PageDown buttons on the left ---
  function mkCircle(arrow, seq, top) {
    var el = document.createElement('div');
    el.textContent = arrow;
    var s = el.style;
    s.position = 'fixed';
    s.left = '14px';
    s.top = top;
    s.zIndex = '2147483641';
    s.width = '42px';
    s.height = '42px';
    s.boxSizing = 'border-box';
    s.borderRadius = '50%';
    s.display = 'none';
    s.alignItems = 'center';
    s.justifyContent = 'center';
    s.font = '20px sans-serif';
    s.cursor = 'pointer';
    s.userSelect = 'none';
    s.webkitUserSelect = 'none';
    s.transition = 'background .12s, border-color .12s, color .12s, transform .08s';

    // Like the settings button: semi-transparent glyph by default, no circle.
    // The circle (background + border) only appears on hover / press.
    function idle() {
      s.background = 'transparent';
      s.border = '1px solid transparent';
      s.color = 'rgba(255,255,255,.4)';
      s.transform = 'translateY(-50%) scale(1)';
    }
    function hover() {
      s.background = 'rgba(0,0,0,.55)';
      s.border = '1px solid rgba(255,255,255,.55)';
      s.color = '#fff';
      s.transform = 'translateY(-50%) scale(1)';
    }
    function active() {
      s.background = 'rgba(0,0,0,.85)';
      s.border = '1px solid #fff';
      s.color = '#fff';
      s.transform = 'translateY(-50%) scale(.9)';
    }
    idle();
    el.addEventListener('mouseover', hover);
    el.addEventListener('mouseout', idle);
    el.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); active(); });
    el.addEventListener('mouseup', hover);
    el.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); send(seq); });
    document.body.appendChild(el);
    return el;
  }

  var pgup = mkCircle('▲', KEY.PGUP, '44%');
  var pgdn = mkCircle('▼', KEY.PGDN, '56%');

  function show(el, on, disp) { el.style.display = on ? (disp || 'block') : 'none'; }

  // Page buttons show only in the article list (pageState 2, excluding the
  // board-selection lists like 看板列表 / 我的最愛). Not in article reading.
  function updatePageButtons() {
    var on = false;
    if (app.modalShown) {        // hide while Settings (or any modal) is open
      show(pgup, false);
      show(pgdn, false);
      return;
    }
    if (app.buf && app.buf.pageState === 2) {
      var first = app.buf.getRowText(0, 0, app.buf.cols) || '';
      on = first.indexOf('看板列表') < 0 && first.indexOf('我的最愛') < 0;
    }
    show(pgup, on, 'flex');
    show(pgdn, on, 'flex');
  }
  setInterval(updatePageButtons, 250);
  updatePageButtons();

  // Back cursor (follows the pointer in the left zone) + top/bottom labels.
  var inLeftPrev = false;
  function clearBackCursor() {
    if (mainDisplay && inLeftPrev) mainDisplay.style.cursor = '';
    inLeftPrev = false;
  }

  window.addEventListener('mousemove', function(e) {
    if (app.modalShown) {        // no back-cursor / 置頂 / 置底 while a modal is open
      clearBackCursor();
      show(home, false);
      show(end, false);
      return;
    }
    var w = window.innerWidth, h = window.innerHeight;
    var x = e.clientX, y = e.clientY;
    var ps = app.buf ? app.buf.pageState : 0;
    var navState = (ps === 1 || ps === 2 || ps === 3);
    var listOrRead = (ps === 2 || ps === 3);

    var inLeft = navState && x < w * 0.08;
    var midX = x >= w * 0.08 && x <= w * 0.92;
    var inTop = listOrRead && midX && y < h * 0.12;
    var inBottom = listOrRead && midX && y > h * 0.88;

    if (inLeft) {
      if (mainDisplay) mainDisplay.style.cursor = BACK_CURSOR;
      inLeftPrev = true;
    } else {
      clearBackCursor();
    }

    show(home, inTop);
    show(end, inBottom);
  });

  window.addEventListener('mouseout', function(e) {
    if (!e.relatedTarget && !e.toElement) {
      clearBackCursor();
      show(home, false);
      show(end, false);
    }
  });

  // Trackpad two-finger swipe right (browser "back" gesture) -> go up a level
  // (reading -> article list, article list -> board list). Detected via the
  // horizontal wheel delta; one back per swipe.
  var swipeAccum = 0;
  var swipeFired = false;
  var swipeTimer = null;
  window.addEventListener('wheel', function(e) {
    if (app.modalShown) return;  // no back gesture while a modal is open
    // Require a clearly horizontal gesture so a fast diagonal/inertial vertical
    // scroll never trips the back navigation.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.4) return;
    var ps = app.buf ? app.buf.pageState : 0;
    if (ps !== 2 && ps !== 3) return;
    e.preventDefault(); // suppress the webview's own back/rubber-band
    swipeAccum += e.deltaX;
    if (swipeTimer) clearTimeout(swipeTimer);
    swipeTimer = setTimeout(function() { swipeAccum = 0; swipeFired = false; }, 200);
    // Swiping right accumulates negative deltaX (natural scrolling).
    if (!swipeFired && swipeAccum < -120) {
      swipeFired = true;
      send(KEY.LEFT); // up a level
    }
  }, { passive: false });
}

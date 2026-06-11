// MacPTT — ⌘F "find on screen". PTT is a server-rendered terminal, so this
// searches the CURRENT screen buffer (the visible grid), highlights matches with
// an overlay positioned via the terminal's own geometry, and lets you cycle
// matches. It re-searches automatically as you page (the screen updates).
import "./find_bar.css";

export function setupFindBar(app) {
  if (typeof document === "undefined") return;

  const state = { open: false, query: "", matches: [], idx: 0 };

  // --- find bar UI ---
  const bar = document.createElement("div");
  bar.className = "findBar";
  bar.style.display = "none";
  const input = document.createElement("input");
  input.className = "findBar__input";
  input.type = "text";
  input.placeholder = "在本頁尋找";
  input.spellcheck = false;
  const count = document.createElement("span");
  count.className = "findBar__count";
  const prev = mkBtn("‹", "上一個 (⇧⏎)");
  const next = mkBtn("›", "下一個 (⏎)");
  const close = mkBtn("✕", "關閉 (Esc)");
  close.classList.add("findBar__close");
  bar.append(input, count, prev, next, close);
  document.body.appendChild(bar);

  function mkBtn(label, title) {
    const b = document.createElement("button");
    b.className = "findBar__btn";
    b.type = "button";
    b.textContent = label;
    b.title = title;
    return b;
  }

  // --- match overlay (lives in the cursor's coordinate space) ---
  const overlay = document.createElement("div");
  overlay.className = "findOverlay";

  function view() {
    return app.view;
  }
  function mountOverlay() {
    const v = view();
    const anchor = v && v.bbsCursor && v.bbsCursor.parentNode;
    if (anchor && overlay.parentNode !== anchor) anchor.appendChild(overlay);
  }
  function clearOverlay() {
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  }

  // Non-empty cells of a row → {col, ch, w}. Lead-byte (double-width) cells span
  // two columns; the trailing cell is blank and skipped.
  function rowCells(line, cols) {
    const cells = [];
    for (let col = 0; col < cols; col++) {
      const c = line[col];
      if (c && c.ch) cells.push({ col, ch: c.ch, w: c.isLeadByte ? 2 : 1 });
    }
    return cells;
  }

  function runSearch() {
    state.matches = [];
    const q = state.query;
    const buf = app.buf;
    if (q && buf && buf.lines) {
      const ql = q.toLowerCase();
      for (let row = 0; row < buf.rows; row++) {
        const line = buf.lines[row];
        if (!line) continue;
        const cells = rowCells(line, buf.cols);
        const hay = cells.map(c => c.ch).join("").toLowerCase();
        let from = 0;
        let p;
        while ((p = hay.indexOf(ql, from)) !== -1) {
          const start = cells[p];
          const last = cells[p + ql.length - 1];
          if (start && last) {
            state.matches.push({ row, col: start.col, span: last.col + last.w - start.col });
          }
          from = p + ql.length;
        }
      }
    }
    if (state.idx >= state.matches.length) state.idx = 0;
    renderOverlay();
    renderCount();
  }

  function renderOverlay() {
    const v = view();
    clearOverlay();
    if (!v || !state.open) return;
    mountOverlay();
    const sx = v.scaleX || 1;
    const sy = v.scaleY || 1;
    for (let i = 0; i < state.matches.length; i++) {
      const m = state.matches[i];
      const pos = v.convertMN2XYEx(m.col, m.row);
      const box = document.createElement("div");
      box.className = "findHit" + (i === state.idx ? " findHit--cur" : "");
      box.style.left = pos[0] + "px";
      box.style.top = pos[1] + "px";
      box.style.width = m.span * v.chw * sx + "px";
      box.style.height = v.chh * sy + "px";
      overlay.appendChild(box);
    }
  }

  function renderCount() {
    if (!state.query) count.textContent = "";
    else if (!state.matches.length) count.textContent = "無符合";
    else count.textContent = state.idx + 1 + "/" + state.matches.length;
    const none = !state.matches.length;
    prev.disabled = none;
    next.disabled = none;
  }

  function step(delta) {
    if (!state.matches.length) return;
    state.idx = (state.idx + delta + state.matches.length) % state.matches.length;
    renderOverlay();
    renderCount();
  }

  function open() {
    state.open = true;
    bar.style.display = "flex";
    app.modalShown = true; // terminal stops grabbing keys while we type
    input.focus();
    input.select();
    runSearch();
  }

  function closeBar() {
    if (!state.open) return;
    state.open = false;
    bar.style.display = "none";
    clearOverlay();
    app.modalShown = false;
    if (app.setInputAreaFocus) app.setInputAreaFocus();
  }

  input.addEventListener("input", () => {
    state.query = input.value;
    state.idx = 0;
    runSearch();
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeBar();
    } else if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  });
  prev.addEventListener("click", () => {
    step(-1);
    input.focus();
  });
  next.addEventListener("click", () => {
    step(1);
    input.focus();
  });
  close.addEventListener("click", closeBar);

  // Re-search as the screen changes (paging) and reposition on resize.
  if (app.buf && app.buf.addEventListener) {
    app.buf.addEventListener("viewUpdate", () => {
      if (state.open) runSearch();
    });
  }
  window.addEventListener("resize", () => {
    if (state.open) renderOverlay();
  });

  // ⌘F from the native Edit menu.
  if (window.__TAURI__) {
    window.__TAURI__.event.listen("menu://find", open);
  }

  app.openFind = open; // also callable programmatically
}

export default setupFindBar;

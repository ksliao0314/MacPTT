// PttChrome v3 — first-run prompt offering to set up a saved login.
// Shown when there is no saved login. Dismissing it remembers the choice.

const DISMISS_KEY = 'pttchrome.login.askdismiss';

export function maybePromptSavedLogin(app) {
  if (typeof document === 'undefined') return;
  if (window.localStorage.getItem(DISMISS_KEY) === '1') return;

  var overlay = document.createElement('div');
  var os = overlay.style;
  os.position = 'fixed';
  os.inset = '0';
  os.zIndex = '2147483646';
  os.background = 'rgba(0,0,0,.5)';
  os.display = 'flex';
  os.alignItems = 'center';
  os.justifyContent = 'center';

  var panel = document.createElement('div');
  var ps = panel.style;
  ps.background = '#2b2b2b';
  ps.color = '#eee';
  ps.font = '14px sans-serif';
  ps.padding = '20px 22px';
  ps.borderRadius = '10px';
  ps.width = '320px';
  ps.boxShadow = '0 10px 36px rgba(0,0,0,.55)';
  var skipBtnStyle =
    'padding:7px 16px;border-radius:6px;border:1px solid #666;' +
    'background:#3a3a3a;color:#eee;font-size:14px;cursor:pointer;';
  var setBtnStyle =
    'padding:7px 18px;border-radius:6px;border:none;' +
    'background:#0a84ff;color:#fff;font-size:14px;font-weight:bold;cursor:pointer;';
  panel.innerHTML =
    '<div style="font-size:16px;font-weight:bold;margin-bottom:10px">設定自動登入？</div>' +
    '<div style="line-height:1.6;color:#ccc;margin-bottom:18px">' +
    '要不要儲存 PTT 帳號密碼以自動登入？<br>' +
    '帳號與密碼<b>只會加密儲存在這台電腦</b>，不會上傳。' +
    '</div>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end">' +
    '<button id="lp-skip" style="' + skipBtnStyle + '">先略過</button>' +
    '<button id="lp-set" style="' + setBtnStyle + '">設定帳號</button>' +
    '</div>';

  // Don't let keystrokes reach the terminal.
  ['keydown', 'keyup', 'keypress'].forEach(function(t) {
    panel.addEventListener(t, function(e) { e.stopPropagation(); }, true);
  });

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  function onDocKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener('keydown', onDocKey, true);

  function close() {
    document.removeEventListener('keydown', onDocKey, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (app && app.setInputAreaFocus) app.setInputAreaFocus();
  }

  panel.querySelector('#lp-skip').onclick = function() {
    window.localStorage.setItem(DISMISS_KEY, '1');
    close();
  };
  panel.querySelector('#lp-set').onclick = function() {
    close();
    if (app && app.openSettings) app.openSettings('account');
  };
  overlay.onclick = function(e) { if (e.target === overlay) close(); };
}

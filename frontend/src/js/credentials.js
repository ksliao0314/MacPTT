// PttChrome v3 — saved login credentials.
//
// Username + auto-login flag live in localStorage (`pttchrome.login.v3`); the
// password is encrypted on this machine with a local key (AES-256-GCM, via Rust
// set_password), never in plaintext on disk. The password is cached in memory
// after preload() so the auto-login state machine can read it synchronously.

const IS_TAURI = typeof window !== 'undefined' && !!window.__TAURI__;
const KEY = 'pttchrome.login.v3';
const PREF_KEY = 'pttchrome.pref.v1';

function invoke(cmd, args) {
  return window.__TAURI__.core.invoke(cmd, args);
}

function loadMeta() {
  try {
    var v = JSON.parse(window.localStorage.getItem(KEY));
    if (v && typeof v === 'object') return { user: v.user || '', autoLogin: !!v.autoLogin };
  } catch (e) {}
  var migrated = migrate();
  if (migrated) return migrated;
  return { user: '', autoLogin: false };
}

function saveMeta(meta) {
  window.localStorage.setItem(KEY, JSON.stringify({
    user: meta.user || '',
    autoLogin: !!meta.autoLogin
  }));
}

// Migrate from the old plaintext prefs (loginUser/loginPass/autoLogin).
function migrate() {
  try {
    var pref = JSON.parse(window.localStorage.getItem(PREF_KEY));
    var v = pref && pref.values;
    if (v && (v.loginUser || v.loginPass)) {
      var meta = { user: (v.loginUser || '').trim(), autoLogin: !!v.autoLogin };
      saveMeta(meta);
      _cachedPassword = v.loginPass || '';
      if (IS_TAURI && meta.user && v.loginPass) {
        invoke('set_password', { account: meta.user, password: v.loginPass }).catch(function() {});
      }
      // wipe the plaintext copy from prefs
      v.loginUser = '';
      v.loginPass = '';
      v.autoLogin = false;
      window.localStorage.setItem(PREF_KEY, JSON.stringify(pref));
      return meta;
    }
  } catch (e) {}
  return null;
}

var _cachedPassword = '';
// When auto-login sees PTT reject the saved password, we remember that exact
// password as bad so reconnects in this session don't re-submit it (repeated
// failed logins can get the account throttled/locked). Cleared when the user
// saves new credentials.
var _failedPassword = null;

export function getUser() { return (loadMeta().user || '').trim(); }
export function getAutoLogin() { return !!loadMeta().autoLogin; }
export function getPassword() { return _cachedPassword; }
export function hasSavedLogin() { return !!getUser(); }

// Called by auto-login when PTT reports the password is wrong.
export function markAutoLoginFailed() { _failedPassword = _cachedPassword; }
// True when the currently-saved password is one we already know PTT rejects.
export function autoLoginShouldSkip() {
  return _failedPassword !== null && _failedPassword === _cachedPassword;
}

// Load the password from the Keychain into the in-memory cache (call once at
// startup, before connecting).
export function preload() {
  var user = getUser();
  if (!IS_TAURI || !user) {
    _cachedPassword = '';
    return Promise.resolve();
  }
  return invoke('get_password', { account: user })
    .then(function(p) { _cachedPassword = p || ''; })
    .catch(function() { _cachedPassword = ''; });
}

export function saveLogin(user, password, autoLogin) {
  user = (user || '').trim();
  saveMeta({ user: user, autoLogin: !!autoLogin });
  _cachedPassword = password || '';
  _failedPassword = null; // new credentials → allow auto-login to try again
  if (IS_TAURI && user) {
    return invoke('set_password', { account: user, password: password || '' }).catch(function() {});
  }
  return Promise.resolve();
}

export function clearLogin() {
  var user = getUser();
  saveMeta({ user: '', autoLogin: false });
  _cachedPassword = '';
  if (IS_TAURI && user) {
    return invoke('delete_password', { account: user }).catch(function() {});
  }
  return Promise.resolve();
}

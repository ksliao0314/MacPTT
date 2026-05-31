// PttChrome v3 — auto-login.
//
// Reads the saved id/password from the preferences (managed in the native
// Settings page, stored locally). When enabled, it watches the decoded login
// screen and fills in the id and password, then clears the finite set of
// post-login prompts (delete duplicate logins / delete bad-login records /
// press-any-key) so it actually lands on the main menu.
//
// Why clearing those prompts matters: if auto-login fills the password but then
// sits at the "刪除其他重複登入的連線嗎?[Y/n]" prompt, PTT times out and drops the
// connection; the reconnect re-logs-in and gets stuck again — a loop that ends
// only when PTT blocks the account for too many logins.
//
// Safety: it stops as soon as it sees the main menu, and hard-stops after a
// short time / a few actions, so it never injects keystrokes during normal use.

import { b2u } from './string_util';
import {
  getUser,
  getPassword,
  getAutoLogin,
  markAutoLoginFailed,
  autoLoginShouldSkip
} from './credentials';
import { readValuesWithDefault } from '../components/ContextMenu/PrefModal';
import { toast } from './toast';

export function AutoLogin(app) {
  this.app = app;
  this.u = getUser();
  this.p = getPassword();
  // Don't re-submit a password PTT already rejected this session.
  this.enabled =
    getAutoLogin() && !!this.u && !!this.p && !autoLoginShouldSkip();
  this.autoEnterFavorite = readValuesWithDefault().autoEnterFavorite !== false;
  this.state = this.enabled ? 'user' : 'done';
  this.buf = '';
  this.posts = 0;
  this.startTime = Date.now();
}

AutoLogin.prototype.feed = function(data) {
  if (this.state === 'done') return;

  // Keep a rolling window of decoded text to match prompts against.
  this.buf = (this.buf + b2u(data)).slice(-1500);
  var text = this.buf;

  if (this.state === 'user') {
    if (/請輸入代號|guest|註冊|代號/.test(text)) {
      this._send(this.u + '\r');
      this.state = 'pass';
      this.buf = '';
    }
    return;
  }

  if (this.state === 'pass') {
    if (/密碼|[Pp]assword/.test(text)) {
      this._send(this.p + '\r');
      this.state = 'post';
      this.buf = '';
    }
    return;
  }

  // Wrong saved password — PTT rejects it. Stop now and remember it as bad so
  // reconnects this session don't keep re-submitting it (which racks up failed
  // login records and can get the account throttled). User can fix it in
  // Settings ▸ 帳號 (saving clears the bad-password flag).
  if (/密碼不對|密碼錯誤|無此帳號|incorrect/i.test(text)) {
    markAutoLoginFailed();
    this.state = 'done';
    toast('儲存的密碼有誤，自動登入已暫停。請到「設定 → 帳號」更新密碼。', 4000);
    return;
  }

  // state === 'post': clear the post-login prompts to reach the main menu.
  // Handle known prompts first; then end the moment we see the main menu (or a
  // safety cap), so we never touch keystrokes during normal browsing.
  if (/重複登入/.test(text)) {
    // 注意: 您有其它連線已登入此帳號。您想刪除其他重複登入的連線嗎?[Y/n]
    this._send('y\r');
    this.buf = '';
    this.posts++;
    return;
  }
  if (/錯誤(嘗試|登入)/.test(text)) {
    // 您要刪除以上錯誤嘗試的記錄嗎?[Y/n]
    this._send('y\r');
    this.buf = '';
    this.posts++;
    return;
  }
  if (/任意鍵/.test(text)) {
    // 請按任意鍵繼續
    this._send('\r');
    this.buf = '';
    this.posts++;
    return;
  }
  // At the main menu? Check the terminal's top row directly — a full-screen
  // redraw (the main menu has a big banner) can push 主功能表 out of the rolling
  // text window above. The parser has already processed `data` by this point.
  var topRow = '';
  try {
    topRow = this.app.buf.getRowText(0, 0, this.app.buf.cols) || '';
  } catch (e) {}
  if (/主功能表|主選單/.test(topRow) || /主功能表|主選單/.test(text)) {
    // PTT menu items need the letter PLUS Enter (per PyPtt: [main menu, 'F', enter]).
    if (this.autoEnterFavorite) {
      this._send('F\r');
    }
    this.state = 'done';
    return;
  }
  if (Date.now() - this.startTime > 12000 || this.posts >= 6) {
    this.state = 'done';
  }
};

AutoLogin.prototype._send = function(str) {
  if (this.app.connectState === 1 && this.app.conn) {
    this.app.conn.convSend(str);
  }
};

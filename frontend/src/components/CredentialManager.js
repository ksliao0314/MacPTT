// MacPTT — saved login settings (Settings ▸ 帳號 tab).
// Username + auto-login are stored locally; the password is encrypted on this
// machine with a local key (see js/credentials + Rust set_password).
//
// Auto-saves shortly after editing and flushes on close, so pressing the
// dialog's 「完成」 button always persists the account (no need to find the
// separate 儲存 button).

import {
  getUser,
  getPassword,
  getAutoLogin,
  saveLogin,
  clearLogin
} from "../js/credentials";

export class CredentialManager extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      user: getUser(),
      pass: getPassword(),
      autoLogin: getAutoLogin(),
      saved: false
    };
    this._dirty = false;
    this._changedThisSession = false;
  }

  // Persist the current fields (localStorage + encrypted password). No UI feedback.
  commit() {
    saveLogin(this.state.user, this.state.pass, this.state.autoLogin);
    this._dirty = false;
  }

  // Auto-save a short moment after the last edit.
  scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.commit();
    }, 500);
  }

  setField(patch) {
    this.setState(patch);
    this._changedThisSession = true;
    this.scheduleSave();
  }

  onSaveClick() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.commit();
    this.setState({ saved: true });
    if (this._t) clearTimeout(this._t);
    this._t = setTimeout(() => this.setState({ saved: false }), 2200);
  }

  onClear() {
    if (!window.confirm("確定清除已儲存的帳號與密碼？")) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    clearLogin();
    this._dirty = false;
    this.setState({ user: "", pass: "", autoLogin: false, saved: false });
  }

  componentWillUnmount() {
    if (this._t) clearTimeout(this._t);
    if (this._saveTimer) clearTimeout(this._saveTimer);
    // Flush any pending edit on close (e.g. typed account then clicked 完成).
    if (this._dirty) this.commit();
    // If the user just set up an account with auto-login, ask the app to
    // reconnect once Settings closes so the saved credentials log in now
    // (auto-login only runs on a fresh connection).
    if (this._changedThisSession && this.state.autoLogin && this.state.user) {
      window.__macpttWantReconnect = true;
    }
  }

  render() {
    const self = this;
    return (
      <div className="macForm">
        <div className="macFormField">
          <label>帳號</label>
          <input
            className="macInput"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={this.state.user}
            onChange={e => self.setField({ user: e.target.value })}
          />
        </div>

        <div className="macFormField">
          <label>密碼</label>
          <input
            className="macInput"
            type="password"
            autoComplete="off"
            value={this.state.pass}
            onChange={e => self.setField({ pass: e.target.value })}
          />
        </div>

        <div className="macGroup">
          <div className="macRow">
            <div className="macRow__text">
              <div className="macRow__label">連線時自動登入</div>
              <div className="macRow__hint">開啟後，下次連線會自動帶入帳密登入</div>
            </div>
            <span
              className={"macSwitch" + (this.state.autoLogin ? " is-on" : "")}
              role="switch"
              aria-checked={this.state.autoLogin}
              tabIndex={0}
              onClick={() => self.setField({ autoLogin: !self.state.autoLogin })}
              onKeyDown={e => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  self.setField({ autoLogin: !self.state.autoLogin });
                }
              }}
            >
              <span className="macSwitch__knob" />
            </span>
          </div>
        </div>

        <div className="macBtnRow">
          <button
            type="button"
            className="macBtn macBtn--primary"
            onClick={() => self.onSaveClick()}
          >
            {this.state.saved ? "已儲存 ✓" : "儲存"}
          </button>
          <button
            type="button"
            className="macBtn macBtn--danger"
            onClick={() => self.onClear()}
          >
            清除
          </button>
        </div>

        <p className="macHint">
          帳密會自動儲存（也可按「儲存」立即存）。密碼在本機加密、只存這台電腦，不會明文存放或上傳。
          首次設定並開啟自動登入後，關閉設定會<b>自動重新連線並登入</b>；之後也可用選單列「檢視 → 重新連線」（⌘⇧R）。
        </p>
      </div>
    );
  }
}

export default CredentialManager;

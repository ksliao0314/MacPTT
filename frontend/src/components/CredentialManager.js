// PttChrome v3 — saved login settings (Settings ▸ 帳號 tab).
// Username + auto-login are stored locally; the password is encrypted on this
// machine with a local key (see js/credentials + Rust set_password). macOS look.

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
  }
  onSave() {
    saveLogin(this.state.user, this.state.pass, this.state.autoLogin);
    this.setState({ saved: true });
    if (this._t) clearTimeout(this._t);
    this._t = setTimeout(() => this.setState({ saved: false }), 2200);
  }
  onClear() {
    if (!window.confirm("確定清除已儲存的帳號與密碼？")) return;
    clearLogin();
    this.setState({ user: "", pass: "", autoLogin: false, saved: false });
  }
  componentWillUnmount() {
    if (this._t) clearTimeout(this._t);
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
            onChange={e => self.setState({ user: e.target.value })}
          />
        </div>

        <div className="macFormField">
          <label>密碼</label>
          <input
            className="macInput"
            type="password"
            autoComplete="off"
            value={this.state.pass}
            onChange={e => self.setState({ pass: e.target.value })}
          />
        </div>

        <div className="macGroup">
          <div className="macRow">
            <div className="macRow__text">
              <div className="macRow__label">連線時自動登入</div>
              <div className="macRow__hint">開啟後啟動即自動帶入帳密登入</div>
            </div>
            <span
              className={
                "macSwitch" + (this.state.autoLogin ? " is-on" : "")
              }
              role="switch"
              aria-checked={this.state.autoLogin}
              tabIndex={0}
              onClick={() => self.setState({ autoLogin: !self.state.autoLogin })}
              onKeyDown={e => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  self.setState({ autoLogin: !self.state.autoLogin });
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
            onClick={() => self.onSave()}
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
          密碼會在本機加密後儲存（只在這台電腦），不會以明文存放、也不會上傳。
        </p>
      </div>
    );
  }
}

export default CredentialManager;

// PttChrome v3 — blacklist management UI (Settings ▸ 黑名單 tab).
// Count + last-updated, the 20 most recently added (each removable), a search
// box (matches removable), single add, and import / export. macOS look.

import {
  getCount,
  getUpdated,
  getRecent,
  search,
  add,
  remove,
  exportText,
  parseBlacklistText
} from "../js/blacklist";

const IS_TAURI = typeof window !== "undefined" && !!window.__TAURI__;
const PTT_BLACKLIST_URL = require("../data/ptt_blacklist.txt");

function fmtDate(ms) {
  if (!ms) return "—";
  try {
    var d = new Date(ms);
    var p = function(n) { return (n < 10 ? "0" : "") + n; };
    return (
      d.getFullYear() +
      "-" + p(d.getMonth() + 1) +
      "-" + p(d.getDate()) +
      " " + p(d.getHours()) +
      ":" + p(d.getMinutes())
    );
  } catch (e) {
    return "—";
  }
}

export class BlacklistManager extends React.Component {
  constructor(props) {
    super(props);
    this.state = { tick: 0, addVal: "", query: "" };
  }
  refresh() {
    this.setState({ tick: this.state.tick + 1 });
  }
  onAdd() {
    var n = add(this.state.addVal);
    this.setState({ addVal: "" });
    this.refresh();
    if (!n) window.alert("沒有新增（空白或已存在）");
  }
  onRemove(id) {
    remove(id);
    this.refresh();
  }
  onImportBundled() {
    var self = this;
    fetch(PTT_BLACKLIST_URL)
      .then(function(r) { return r.text(); })
      .then(function(text) {
        var n = add(parseBlacklistText(text));
        self.refresh();
        window.alert("已匯入 PTT 大秘寶：" + n + " 筆");
      })
      .catch(function() { window.alert("匯入失敗"); });
  }
  onImportFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    var self = this;
    reader.onload = function() {
      var n = add(parseBlacklistText(reader.result));
      self.refresh();
      window.alert("已匯入 " + n + " 筆（重複的會略過）");
    };
    reader.readAsText(f);
    e.target.value = "";
  }
  onExport() {
    var text = exportText();
    if (!text) {
      window.alert("黑名單是空的");
      return;
    }
    if (IS_TAURI) {
      window.__TAURI__.core
        .invoke("save_text_file", { filename: "blacklist.txt", content: text })
        .then(function(p) { window.alert("已匯出到：" + p); })
        .catch(function() { window.alert("匯出失敗"); });
    } else {
      var blob = new Blob([text], { type: "text/plain" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "blacklist.txt";
      a.click();
    }
  }

  renderList(ids, emptyText) {
    var self = this;
    if (!ids.length) {
      return <div className="macList__empty">{emptyText}</div>;
    }
    return ids.map(function(id) {
      return (
        <div key={id} className="macList__row">
          <span className="mono">{id}</span>
          <button
            type="button"
            className="macChipBtn"
            onClick={function() { self.onRemove(id); }}
          >
            移除
          </button>
        </div>
      );
    });
  }

  render() {
    var self = this;
    var count = getCount();
    var updated = getUpdated();
    var query = this.state.query.trim();
    var results = query ? search(query) : null;

    return (
      <div className="macForm">
        <div className="macStatus">
          共 <b>{count}</b> 筆 · 最後更新 {fmtDate(updated)}
        </div>

        {count === 0 && (
          <div className="macFormField">
            <button
              type="button"
              className="macBtn macBtn--primary"
              onClick={function() { self.onImportBundled(); }}
            >
              匯入 PTT 大秘寶（內建名單）
            </button>
            <div className="macHint">「PTT 大秘寶」由 rhino0314 維護整理。</div>
          </div>
        )}

        <div className="macFormField">
          <label>新增帳號</label>
          <div className="macBtnRow">
            <input
              className="macInput"
              type="text"
              placeholder="輸入帳號"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={this.state.addVal}
              onChange={function(e) { self.setState({ addVal: e.target.value }); }}
              onKeyDown={function(e) { if (e.key === "Enter") self.onAdd(); }}
            />
            <button
              type="button"
              className="macBtn"
              onClick={function() { self.onAdd(); }}
            >
              新增
            </button>
          </div>
        </div>

        <div className="macBtnRow">
          <label className="macBtn macBtn--sm" style={{ marginBottom: 0 }}>
            匯入檔案
            <input
              type="file"
              accept=".txt,text/plain"
              style={{ display: "none" }}
              onChange={function(e) { self.onImportFile(e); }}
            />
          </label>
          <button
            type="button"
            className="macBtn macBtn--sm"
            onClick={function() { self.onExport(); }}
          >
            匯出檔案
          </button>
        </div>

        <div className="macFormField">
          <label>搜尋黑名單</label>
          <input
            className="macInput"
            type="text"
            placeholder="輸入關鍵字（找到可移除）"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={this.state.query}
            onChange={function(e) { self.setState({ query: e.target.value }); }}
          />
        </div>

        <div className="macList">
          <div className="macList__header">
            {results !== null
              ? "搜尋結果：" + results.length + " 筆"
              : "最近加入的 20 筆"}
          </div>
          <div className="macList__scroll">
            {results !== null
              ? this.renderList(results, "找不到吻合的帳號")
              : this.renderList(getRecent(20), "黑名單是空的")}
          </div>
        </div>

        <p className="macHint">
          黑名單只存在本機（此 App）。在文章列表或推文中，可右鍵將作者加入黑名單。
        </p>
      </div>
    );
  }
}

export default BlacklistManager;

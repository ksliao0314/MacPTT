import cx from "classnames";
import React from "react";
import { compose, withStateHandlers } from "recompose";
import { Modal } from "react-bootstrap";
import { i18n } from "../../js/i18n";
import { BlacklistManager } from "../BlacklistManager";
import { CredentialManager } from "../CredentialManager";
import "./PrefModal.css";

const DEFAULT_PREFS = {
  // general
  enablePicPreview: true,
  enableNotifications: true,
  autoEnterFavorite: true, // 登入後自動進入「我的最愛」
  enableEasyReading: true, // "自動開圖" — on by default
  trackpadSmoothScroll: true,
  trackpadScrollSpeed: 2,
  trackpadGesture: false, // three-finger swipe = page up/down (opt-in)
  endTurnsOnLiveUpdate: true,
  copyOnSelect: false,
  antiIdleTime: 180,
  lineWrap: 78,
  icloudSync: false, // sync settings + blacklist via iCloud Drive

  // mouse browsing
  useMouseBrowsing: true,
  mouseBrowsingHighlight: true, // drives the hover indicator (no UI toggle)
  mouseBrowsingHighlightColor: 2,
  mouseLeftFunction: 0,
  mouseMiddleFunction: 0,
  mouseWheelFunction1: 1,
  mouseWheelFunction2: 2,
  mouseWheelFunction3: 3,

  // displays
  fontFitWindowWidth: false,
  fontFace: "MingLiu,SymMingLiu,monospace",
  fontSize: 20,
  termSize: { cols: 80, rows: 24 },
  termSizeMode: "fixed-term-size",
  bbsMargin: 0
};

const PREF_STORAGE_KEY = "pttchrome.pref.v1";

// Coerce to a positive integer, else fall back to the default. Guards against
// corrupt stored prefs (null/NaN/0) — e.g. a termSize of {cols:null} would make
// the terminal 0 columns wide and render nothing (an all-black window).
const posInt = (x, d) => {
  const n = parseInt(x, 10);
  return isFinite(n) && n > 0 ? n : d;
};
const intOr = (x, d) => {
  const n = parseInt(x, 10);
  return isFinite(n) ? n : d;
};

const sanitizeValues = values => {
  const v = { ...DEFAULT_PREFS, ...values };
  const ts = v.termSize && typeof v.termSize === "object" ? v.termSize : {};
  v.termSize = {
    cols: posInt(ts.cols, DEFAULT_PREFS.termSize.cols),
    rows: posInt(ts.rows, DEFAULT_PREFS.termSize.rows)
  };
  v.fontSize = posInt(v.fontSize, DEFAULT_PREFS.fontSize);
  v.lineWrap = posInt(v.lineWrap, DEFAULT_PREFS.lineWrap);
  v.antiIdleTime = posInt(v.antiIdleTime, DEFAULT_PREFS.antiIdleTime);
  v.trackpadScrollSpeed = posInt(
    v.trackpadScrollSpeed,
    DEFAULT_PREFS.trackpadScrollSpeed
  );
  v.bbsMargin = intOr(v.bbsMargin, DEFAULT_PREFS.bbsMargin); // 0 is valid
  if (
    v.termSizeMode !== "fixed-term-size" &&
    v.termSizeMode !== "fixed-font-size"
  ) {
    v.termSizeMode = DEFAULT_PREFS.termSizeMode;
  }
  return v;
};

export const readValuesWithDefault = () => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREF_STORAGE_KEY));
    return sanitizeValues(stored && stored.values);
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
};

const writeValues = values => {
  try {
    window.localStorage.setItem(
      PREF_STORAGE_KEY,
      JSON.stringify({ values })
    );
  } catch (e) {}
  // Mirror to iCloud (no-op unless sync is enabled). Called via a global to
  // avoid an import cycle with js/icloud_sync.
  if (typeof window !== "undefined" && window.__macpttIcloudPush) {
    window.__macpttIcloudPush();
  }
  return values;
};

const changeNestedValue = (obj, key, newValue) => {
  let i = key.indexOf(".");
  if (i > 0) {
    let parentKey = key.substring(0, i);
    let subKey = key.substring(i + 1);
    return {
      ...obj,
      [parentKey]: changeNestedValue(obj[parentKey], subKey, newValue)
    };
  }
  return { ...obj, [key]: newValue };
};

/* ---------------------------------------------------------------- *
 * macOS-style building blocks (HIG: grouped inset lists, switches,  *
 * pop-up buttons, text fields). All controls emit the same         *
 * { target:{ name, value|checked } } shape the handlers expect.     *
 * ---------------------------------------------------------------- */

const Switch = ({ name, checked, onChange }) => (
  <span
    className={cx("macSwitch", { "is-on": !!checked })}
    role="switch"
    aria-checked={!!checked}
    tabIndex={0}
    onClick={() => onChange({ target: { name, checked: !checked } })}
    onKeyDown={e => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onChange({ target: { name, checked: !checked } });
      }
    }}
  >
    <span className="macSwitch__knob" />
  </span>
);

const Section = ({ title, footnote, children }) => (
  <div className="macSection">
    {title && <div className="macSection__title">{title}</div>}
    <div className="macGroup">{children}</div>
    {footnote && <div className="macSection__footnote">{footnote}</div>}
  </div>
);

const ToggleRow = ({ label, hint, name, checked, onChange }) => (
  <div className="macRow">
    <div className="macRow__text">
      <div className="macRow__label">{label}</div>
      {hint && <div className="macRow__hint">{hint}</div>}
    </div>
    <Switch name={name} checked={checked} onChange={onChange} />
  </div>
);

const SelectRow = ({ label, name, value, onChange, options }) => (
  <div className="macRow">
    <div className="macRow__label">{label}</div>
    <div className="macSelectWrap">
      <select className="macSelect" name={name} value={value} onChange={onChange}>
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  </div>
);

const FieldRow = ({ label, name, value, onChange, type, min, max }) => (
  <div className="macRow">
    <div className="macRow__label">{label}</div>
    <input
      className="macField"
      type={type || "number"}
      name={name}
      value={value}
      min={min}
      max={max}
      onChange={onChange}
    />
  </div>
);

const SliderRow = ({ label, name, value, min, max, onChange }) => (
  <div className="macRow">
    <div className="macRow__label">{label}</div>
    <div className="macSliderWrap">
      <input
        className="macSlider"
        type="range"
        name={name}
        min={min}
        max={max}
        value={value}
        onChange={onChange}
      />
      <span className="macSliderVal">{value}</span>
    </div>
  </div>
);

const fnOptions = keys => keys.map((k, i) => ({ value: i, label: i18n(k) }));

/* Sidebar glyphs (16×16, stroke = currentColor). */
const PersonGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="8" cy="5" r="2.6" />
    <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" strokeLinecap="round" />
  </svg>
);
const GearGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const NoSignGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <circle cx="8" cy="8" r="6" />
    <path d="M3.8 3.8l8.4 8.4" strokeLinecap="round" />
  </svg>
);

const InfoGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16.5v-5" />
    <circle cx="12" cy="8" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

// --- About / licenses / changelog -----------------------------------------
const APP_VERSION = "1.2.0";

function openExternal(url) {
  if (typeof window !== "undefined" && window.__TAURI__) {
    window.__TAURI__.core.invoke("open_external", { url }).catch(function() {});
  } else if (typeof window !== "undefined") {
    window.open(url, "_blank");
  }
}

// Open-source components MacPTT builds on, with their licenses.
const CREDITS = [
  { name: "PttChrome", by: "robertabcd（原作 iamchucky）", license: "GPL-2.0", url: "https://github.com/robertabcd/PttChrome" },
  { name: "Tauri", by: "Tauri Programme", license: "Apache-2.0 / MIT", url: "https://tauri.app" },
  { name: "React / React-DOM", by: "Meta", license: "MIT", url: "https://react.dev" },
  { name: "Bootstrap / react-bootstrap", by: "", license: "MIT", url: "https://react-bootstrap.netlify.app" },
  { name: "jQuery", by: "", license: "MIT", url: "https://jquery.com" },
  { name: "Hammer.js", by: "", license: "MIT", url: "https://hammerjs.github.io" },
  { name: "recompose / classnames", by: "", license: "MIT", url: "" },
  { name: "tokio / tokio-tungstenite / futures", by: "", license: "MIT", url: "https://tokio.rs" },
  { name: "ureq / regex / serde", by: "", license: "Apache-2.0 / MIT", url: "" },
  { name: "aes-gcm / rand（RustCrypto）", by: "", license: "Apache-2.0 / MIT", url: "https://github.com/RustCrypto" },
  { name: "objc2（objc2-app-kit / -foundation）", by: "", license: "MIT / Apache-2.0", url: "https://github.com/madsmtm/objc2" }
];

const CHANGELOG = [
  {
    v: "1.2.0",
    date: "2026-06-11",
    items: [
      "新增自動更新：選單列「MacPTT → 檢查更新…」，有新版可一鍵下載更新並重啟（啟動後也會靜默檢查）",
      "新增「在本頁尋找」（⌘F）：搜尋目前畫面、高亮符合處、⏎／⇧⏎ 切換上下個，翻頁自動重搜",
      "效能：終端機改為只重繪有變動的列，捲動與狀態列時鐘跳動更省資源",
      "工程：一鍵建置（npm run build）、版本號統一、修正分享面板記憶體洩漏、新增資安單元測試"
    ]
  },
  {
    v: "1.1.1",
    date: "2026-06-01",
    items: [
      "新增觸控板三指上下翻頁（設定 → 一般 → 觸控板，預設關閉）；翻頁時自動鎖定系統指標與高亮，不誤入文章",
      "帳號分頁改為自動儲存；首次設定並開啟自動登入後，關閉設定會自動重新連線並登入",
      "選單列新增「檢視 → 重新連線」（⌘⇧R）",
      "斷線／開發者模式／貼上提示改用 macOS 原生風格卡片，移除最後的舊版警示樣式"
    ]
  },
  {
    v: "1.1.0",
    date: "2026-05-31",
    items: [
      "新增 iCloud 同步：透過 iCloud Drive 在多台 Mac 間同步設定與黑名單（密碼不同步）",
      "黑名單採累加合併、不會弄丟任何一台的新增；其他設定以最後修改者為準",
      "進一步修正滑鼠瀏覽偶發卡死（殘留的文字選取也會凍結瀏覽 → 改以即時按鍵狀態判定）"
    ]
  },
  {
    v: "1.0.2",
    date: "2026-05-31",
    items: [
      "資安強化：啟用 CSP、SSRF 防護（含 IPv6 mapped / 轉址繞過修補）、WebSocket 連線限定 *.ptt.cc",
      "新增「關於」頁；YouTube 連結偵測誤判修正；若干小修"
    ]
  },
  {
    v: "1.0.1",
    date: "2026-05-31",
    items: [
      "修正滑鼠瀏覽偶爾完全卡住（漏接 mouseup → 移動滑鼠即自我修復）",
      "自動開圖（內嵌圖片）更可靠、新增 YouTube 縮圖預覽",
      "在推文將作者加入黑名單可即時淡化；返回不再閃黑、強調光條穩定"
    ]
  },
  {
    v: "1.0.0",
    date: "2026-05-31",
    items: [
      "首個原生 macOS 版本：Tauri + Rust WebSocket 連線 PTT（term.ptt.cc Origin）",
      "自動登入（本機 AES 加密、不上傳）、黑名單、圖片 / 連結預覽、原生分享、原生選單列、記住視窗、鎖定比例"
    ]
  }
];

const Credit = ({ name, by, license, url }) => (
  <div
    className={"macRow" + (url ? " macRow--link" : "")}
    onClick={url ? function() { openExternal(url); } : undefined}
  >
    <div className="macRow__text">
      <div className="macRow__label">{name}</div>
      {by ? <div className="macRow__hint">{by}</div> : null}
    </div>
    <span className="macLicenseTag">{license}</span>
  </div>
);

const AboutPane = () => (
  <React.Fragment>
    <div className="macAboutHead">
      <div className="macAboutName">MacPTT</div>
      <div className="macAboutVer">版本 {APP_VERSION}</div>
      <div className="macAboutDesc">原生 macOS 的 PTT BBS 客戶端</div>
    </div>

    <Section title="授權">
      <div className="macRow">
        <div className="macRow__text">
          <div className="macRow__label">本專案採 GNU GPL v2.0 授權</div>
          <div className="macRow__hint">
            衍生自 PttChrome（GPL-2.0），依其 copyleft 條款，本專案同樣以
            GPL-2.0 開放原始碼釋出。
          </div>
        </div>
      </div>
      <div
        className="macRow macRow--link"
        onClick={function() {
          openExternal("https://www.gnu.org/licenses/old-licenses/gpl-2.0.html");
        }}
      >
        <div className="macRow__label">閱讀 GPL-2.0 全文</div>
        <span className="macLinkArrow">↗</span>
      </div>
    </Section>

    <Section title="使用的開源專案" footnote="點項目可在瀏覽器開啟專案頁。">
      {CREDITS.map(function(c) {
        return <Credit key={c.name} {...c} />;
      })}
    </Section>

    <Section title="資料來源">
      <div className="macRow">
        <div className="macRow__text">
          <div className="macRow__label">PTT 大秘寶（內建黑名單）</div>
          <div className="macRow__hint">由 rhino0314 整理維護。</div>
        </div>
      </div>
    </Section>

    <Section title="版本日誌">
      {CHANGELOG.map(function(c) {
        return (
          <div className="macRow macRow--stacked" key={c.v}>
            <div className="macRow__label">
              {c.v} <span className="macChangelogDate">· {c.date}</span>
            </div>
            <ul className="macChangelog">
              {c.items.map(function(it, i) {
                return <li key={i}>{it}</li>;
              })}
            </ul>
          </div>
        );
      })}
    </Section>
  </React.Fragment>
);

// Labels are literal strings (not i18n) so they resolve at module-eval time —
// i18n() isn't initialised yet when this array is first built.
const TABS = [
  { key: "account", label: "帳號", glyph: PersonGlyph },
  { key: "general", label: "一般", glyph: GearGlyph },
  { key: "blacklist", label: "黑名單", glyph: NoSignGlyph },
  { key: "about", label: "關於", glyph: InfoGlyph }
];

const enhance = compose(
  withStateHandlers(
    () => ({
      navActiveKey: "account",
      values: readValuesWithDefault()
    }),
    {
      onCloseClick: ({ values }, { onSave }) => () =>
        onSave(writeValues(values)),

      onResetClick: (state, { onReset }) => () =>
        onReset(writeValues({ ...DEFAULT_PREFS })),

      onNavSelect: () => activeKey => ({ navActiveKey: activeKey }),

      onCheckboxChange: ({ values }) => ({ target: { name, checked } }) => ({
        values: changeNestedValue(values, name, !!checked)
      }),

      onNumberInputChange: ({ values }) => ({ target: { name, value } }) => {
        const n = parseInt(value, 10);
        // Ignore empty/invalid input instead of persisting NaN (which becomes
        // null in JSON and corrupts the field / term size on reload).
        if (isNaN(n)) return {};
        return { values: changeNestedValue(values, name, n) };
      },

      onTextInputChange: ({ values }) => ({ target: { name, value } }) => ({
        values: changeNestedValue(values, name, value)
      })
    }
  )
);

const GeneralPane = ({
  values,
  onCheckboxChange,
  onNumberInputChange,
  onTextInputChange
}) => (
  <React.Fragment>
    <Section title="一般">
      <ToggleRow
        label="自動開圖"
        hint="文章中的圖片連結自動內嵌顯示"
        name="enablePicPreview"
        checked={values.enablePicPreview}
        onChange={onCheckboxChange}
      />
      <ToggleRow
        label="登入後自動進入「我的最愛」"
        name="autoEnterFavorite"
        checked={values.autoEnterFavorite}
        onChange={onCheckboxChange}
      />
      <ToggleRow
        label={i18n("options_endTurnsOnLiveUpdate")}
        name="endTurnsOnLiveUpdate"
        checked={values.endTurnsOnLiveUpdate}
        onChange={onCheckboxChange}
      />
      <SelectRow
        label={i18n("options_antiIdleTime")}
        name="antiIdleTime"
        value={
          [180, 240, 300].indexOf(values.antiIdleTime) >= 0
            ? values.antiIdleTime
            : 180
        }
        onChange={onNumberInputChange}
        options={[
          { value: 180, label: "180 秒" },
          { value: 240, label: "240 秒" },
          { value: 300, label: "300 秒" }
        ]}
      />
      <FieldRow
        label={i18n("options_lineWrap")}
        name="lineWrap"
        value={values.lineWrap}
        onChange={onNumberInputChange}
      />
    </Section>

    <Section title={i18n("options_appearance")}>
      <div className="macRow macRow--stacked">
        <div className="macRow__label">{i18n("options_fontFace")}</div>
        <input
          className="macField macField--wide"
          type="text"
          name="fontFace"
          value={values.fontFace}
          onChange={onTextInputChange}
        />
      </div>
      <FieldRow
        label={i18n("options_bbsMargin")}
        name="bbsMargin"
        value={values.bbsMargin}
        onChange={onNumberInputChange}
      />
      <SelectRow
        label={i18n("options_termSize")}
        name="termSizeMode"
        value={values.termSizeMode}
        onChange={onTextInputChange}
        options={[
          { value: "fixed-term-size", label: i18n("options_fixedTermSize") },
          { value: "fixed-font-size", label: i18n("options_fixedFontSize") }
        ]}
      />
      {values.termSizeMode === "fixed-term-size" && (
        <React.Fragment>
          <FieldRow
            label={i18n("options_cols")}
            name="termSize.cols"
            value={values.termSize.cols}
            onChange={onNumberInputChange}
          />
          <FieldRow
            label={i18n("options_rows")}
            name="termSize.rows"
            value={values.termSize.rows}
            onChange={onNumberInputChange}
          />
          <ToggleRow
            label={i18n("options_fontFitWindowWidth")}
            name="fontFitWindowWidth"
            checked={values.fontFitWindowWidth}
            onChange={onCheckboxChange}
          />
        </React.Fragment>
      )}
      {values.termSizeMode === "fixed-font-size" && (
        <FieldRow
          label={i18n("options_fontSize")}
          name="fontSize"
          value={values.fontSize}
          onChange={onNumberInputChange}
        />
      )}
    </Section>

    <Section title={i18n("options_mouseBrowsing")}>
      <ToggleRow
        label={i18n("options_useMouseBrowsing")}
        name="useMouseBrowsing"
        checked={values.useMouseBrowsing}
        onChange={onCheckboxChange}
      />
      <SelectRow
        label={i18n("options_mouseLeftFunction")}
        name="mouseLeftFunction"
        value={values.mouseLeftFunction}
        onChange={onNumberInputChange}
        options={fnOptions([
          "options_none",
          "options_enterKey",
          "options_rightKey"
        ])}
      />
      <SelectRow
        label={i18n("options_mouseMiddleFunction")}
        name="mouseMiddleFunction"
        value={values.mouseMiddleFunction}
        onChange={onNumberInputChange}
        options={fnOptions([
          "options_none",
          "options_enterKey",
          "options_leftKey",
          "options_doPaste"
        ])}
      />
      <SelectRow
        label={i18n("options_mouseWheelFunction1")}
        name="mouseWheelFunction1"
        value={values.mouseWheelFunction1}
        onChange={onNumberInputChange}
        options={fnOptions([
          "options_none",
          "options_upDown",
          "options_pageUpDown",
          "options_threadLastNext"
        ])}
      />
      <SelectRow
        label={i18n("options_mouseWheelFunction2")}
        name="mouseWheelFunction2"
        value={values.mouseWheelFunction2}
        onChange={onNumberInputChange}
        options={fnOptions([
          "options_none",
          "options_upDown",
          "options_pageUpDown",
          "options_threadLastNext"
        ])}
      />
      <SelectRow
        label={i18n("options_mouseWheelFunction3")}
        name="mouseWheelFunction3"
        value={values.mouseWheelFunction3}
        onChange={onNumberInputChange}
        options={fnOptions([
          "options_none",
          "options_upDown",
          "options_pageUpDown",
          "options_threadLastNext"
        ])}
      />
    </Section>

    <Section
      title="雲端"
      footnote="透過 iCloud Drive 在你的 Mac 之間同步。黑名單採累加（不會弄丟任何一台新增的）、其他設定以最後修改者為準。密碼不會同步。需先在系統開啟 iCloud Drive。"
    >
      <ToggleRow
        label="用 iCloud 同步設定與黑名單"
        name="icloudSync"
        checked={values.icloudSync}
        onChange={onCheckboxChange}
      />
    </Section>

    <Section
      title="觸控板"
      footnote={
        values.trackpadGesture
          ? "⚠️ 三指翻頁已開啟。為免與系統手勢衝突，請到「系統設定 → 觸控式軌跡板 → 更多手勢」把三指的「Mission Control／App Exposé」關閉或改為四指。翻頁時 App 會自動把指標鎖在原地，三指設為「拖移」也不受影響。"
          : undefined
      }
    >
      <ToggleRow
        label="平滑觸控板捲動"
        hint="避免捲太快、誤跳上下篇"
        name="trackpadSmoothScroll"
        checked={values.trackpadSmoothScroll}
        onChange={onCheckboxChange}
      />
      <SliderRow
        label="捲動速度"
        name="trackpadScrollSpeed"
        min={1}
        max={5}
        value={values.trackpadScrollSpeed}
        onChange={onNumberInputChange}
      />
      <ToggleRow
        label="三指上下翻頁"
        hint="三指向上＝下一頁、向下＝上一頁；翻頁時自動鎖定指標與高亮"
        name="trackpadGesture"
        checked={values.trackpadGesture}
        onChange={onCheckboxChange}
      />
    </Section>
  </React.Fragment>
);

export const PrefModal = ({
  show,
  onCloseClick,
  onResetClick,
  navActiveKey,
  onNavSelect,
  values,
  onCheckboxChange,
  onNumberInputChange,
  onTextInputChange
}) => {
  const active = TABS.find(t => t.key === navActiveKey) || TABS[0];
  return (
    <Modal show={show} onHide={onCloseClick} className="PrefModal">
      <Modal.Body>
        <div className="macSheet">
          <aside className="macSheet__sidebar">
            <div className="macSheet__brand">{i18n("menu_settings")}</div>
            <nav className="macSheet__nav">
              {TABS.map(t => {
                const Glyph = t.glyph;
                return (
                  <button
                    key={t.key}
                    type="button"
                    className={cx("macNavItem", {
                      "is-active": navActiveKey === t.key
                    })}
                    onClick={() => onNavSelect(t.key)}
                  >
                    <span className="macNavItem__icon">
                      <Glyph />
                    </span>
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </nav>
            <button
              type="button"
              className="macTextBtn macSheet__reset"
              onClick={onResetClick}
            >
              {i18n("options_reset")}
            </button>
          </aside>

          <section className="macSheet__main">
            <header className="macSheet__toolbar">
              <span className="macSheet__toolbarTitle">{active.label}</span>
              <button
                type="button"
                className="macBtn macBtn--primary"
                onClick={onCloseClick}
              >
                完成
              </button>
            </header>
            <div className="macSheet__content">
              {navActiveKey === "account" && (
                <div className="macPane">
                  <CredentialManager />
                </div>
              )}
              {navActiveKey === "blacklist" && (
                <div className="macPane">
                  <BlacklistManager />
                </div>
              )}
              {navActiveKey === "general" && (
                <GeneralPane
                  values={values}
                  onCheckboxChange={onCheckboxChange}
                  onNumberInputChange={onNumberInputChange}
                  onTextInputChange={onTextInputChange}
                />
              )}
              {navActiveKey === "about" && (
                <div className="macPane">
                  <AboutPane />
                </div>
              )}
            </div>
          </section>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default enhance(PrefModal);

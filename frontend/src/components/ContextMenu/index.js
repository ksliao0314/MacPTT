import $ from "jquery";
import cx from "classnames";
import React from "react";
import { compose, withStateHandlers, withProps, lifecycle } from "recompose";
import { MenuItem } from "react-bootstrap";
import { i18n } from "../../js/i18n";
import DropdownMenu from "./DropdownMenu";
import InputHelperModal from "./InputHelperModal";
import LiveHelperModal from "./LiveHelperModal";
import PrefModal from "./PrefModal";
import { add as blAdd, remove as blRemove } from "../../js/blacklist";

function noop() {}

const EVENT_KEY_BY_HOT_KEY = {
  ["C".charCodeAt(0)]: "copy",
  ["E".charCodeAt(0)]: "copyLinkUrl",
  ["P".charCodeAt(0)]: "paste",
  ["S".charCodeAt(0)]: "searchGoogle",
  ["T".charCodeAt(0)]: "openUrlNewTab"
};

const menuHandlerByEventKey = {
  copy: (pttchrome, { selectedText }) => pttchrome.doCopy(selectedText),
  copyAnsi: pttchrome => pttchrome.doCopyAnsi(),
  paste: pttchrome => pttchrome.doPaste(),
  searchGoogle: (pttchrome, { selectedText }) =>
    pttchrome.doSearchGoogle(selectedText),
  openUrlNewTab: (pttchrome, { aElement }) =>
    pttchrome.doOpenUrlNewTab(aElement),
  copyLinkUrl: (pttchrome, { contextOnUrl }) => pttchrome.doCopy(contextOnUrl),
  selectAll: pttchrome => pttchrome.doSelectAll(),
  mouseBrowsing: pttchrome => pttchrome.switchMouseBrowsing(),
  addBlacklistUser: (pttchrome, { contextUserId }) => {
    blAdd(contextUserId);
    // Apply the fade immediately at the DOM level (every matching row already
    // carries the `blu_<id>` class) so it shows the instant you blacklist —
    // the React re-render below keeps it consistent for future updates.
    fadeBlacklistRows(contextUserId, true);
    pttchrome.view.redraw(true);
    pttchrome.setInputAreaFocus();
  },
  removeBlacklistUser: (pttchrome, { contextUserId }) => {
    blRemove(contextUserId);
    fadeBlacklistRows(contextUserId, false);
    pttchrome.view.redraw(true);
    pttchrome.setInputAreaFocus();
  }
};

// Immediately fade (or un-fade) every on-screen row authored by `userId` by
// toggling opacity on its `blu_<userId>` element. userId is already the lower-
// cased word-char id used in the class, so it's a safe selector.
function fadeBlacklistRows(userId, faded) {
  if (!userId) return;
  try {
    var els = document.querySelectorAll(".blu_" + userId);
    for (var i = 0; i < els.length; i++) {
      els[i].style.opacity = faded ? "0.2" : "";
    }
  } catch (e) {}
}

// Read the author id from the `blu_<userid>` class of the row under the cursor.
function userIdAtTarget(target) {
  var node = target;
  while (node && node.nodeType === 1) {
    var cn = node.className;
    if (cn && typeof cn === "string") {
      var m = cn.match(/\bblu_(\w+)/);
      if (m) return m[1];
    }
    node = node.parentElement;
  }
  return null;
}

const onPrefSaveImpl = (pttchrome, values) => {
  pttchrome.onValuesPrefChange(values);
  pttchrome.modalShown = false;
  pttchrome.setInputAreaFocus();
  pttchrome.switchToEasyReadingMode(pttchrome.view.useEasyReadingMode);

  // PrefModal unmounts on the next render (showsSettings:false), and its
  // CredentialManager raises this flag when a first-time auto-login setup was
  // saved. Check it after that unmount so the saved account logs in now.
  setTimeout(function() {
    if (window.__macpttWantReconnect) {
      window.__macpttWantReconnect = false;
      if (pttchrome.connectState === 1 && pttchrome.reconnect) pttchrome.reconnect();
    }
  }, 0);

  return {
    showsSettings: false
  };
};

const initialState = {
  // --- Menu state ---
  open: false,
  pageX: 0,
  pageY: 0,
  contextOnUrl: "",
  aElement: undefined,
  selectedText: "",
  urlEnabled: false,
  normalEnabled: false,
  selEnabled: false,
  contextUserId: null,
  // --- Modal state ---
  showsInputHelper: false,
  showsLiveArticleHelper: false,
  showsSettings: false,
  // --- LiveHelper state ---
  liveHelperEnabled: false,
  liveHelperSec: 1
};

const enhance = compose(
  withStateHandlers(initialState, {
    onContextMenu: (state, { pttchrome }) => event => {
      event.stopPropagation();
      event.preventDefault();
      const { CmdHandler } = pttchrome;
      const doDOMMouseScroll =
        CmdHandler.getAttribute("doDOMMouseScroll") === "1";
      if (doDOMMouseScroll) {
        CmdHandler.setAttribute("doDOMMouseScroll", "0");
        return;
      }
      pttchrome.contextMenuShown = true;
      // just in case the selection get de-selected
      if (window.getSelection().isCollapsed) {
        pttchrome.lastSelection = null;
      } else {
        pttchrome.lastSelection = pttchrome.view.getSelectionColRow();
      }

      const target = $(event.target);
      let contextOnUrl = "";
      let aElement;
      if (target.is("a")) {
        contextOnUrl = target.attr("href");
        aElement = target[0];
      } else if (target.parent().is("a")) {
        contextOnUrl = target.parent().attr("href");
        aElement = target[0].parentNode;
      }

      // replace the &nbsp;
      const selectedText = window
        .getSelection()
        .toString()
        .replace(/\u00a0/g, " ");
      const urlEnabled = !!contextOnUrl;
      // Only treat it as a real selection if the user had already selected text
      // before right-clicking. The webview may auto-select the word under the
      // cursor on right-click; ignore (and clear) that.
      const hasRealSelection =
        pttchrome.rightClickHadSelection && !window.getSelection().isCollapsed;
      if (!hasRealSelection && !window.getSelection().isCollapsed) {
        window.getSelection().removeAllRanges();
      }
      const normalEnabled = !urlEnabled && !hasRealSelection;
      const selEnabled = !normalEnabled;

      // Author id of the row under the cursor (for the blacklist menu items).
      const contextUserId = userIdAtTarget(event.target);

      return {
        // Open when the user has a selection (copy items) OR is on an author id
        // (blacklist items). Otherwise stay closed (no empty menu).
        open: hasRealSelection || !!contextUserId,
        pageX: event.pageX,
        pageY: event.pageY,
        contextOnUrl,
        aElement,
        selectedText,
        urlEnabled,
        normalEnabled,
        selEnabled,
        contextUserId
      };
    },

    onHide: (state, { pttchrome }) => () => {
      if (state.open) {
        pttchrome.contextMenuShown = false;
        return initialState;
      }
    },

    onMenuSelect: (state, { pttchrome }) => (eventKey, event) => {
      menuHandlerByEventKey[eventKey](pttchrome, state);
      event.stopPropagation();
      pttchrome.contextMenuShown = false;
      return initialState;
    },

    onInputHelperClick: (state, { pttchrome }) => event => {
      event.stopPropagation();
      pttchrome.contextMenuShown = false;
      return {
        ...initialState,
        showsInputHelper: true
      };
    },

    onLiveArticleHelperClick: (state, { pttchrome }) => event => {
      event.stopPropagation();
      pttchrome.contextMenuShown = false;
      return {
        ...initialState,
        showsLiveArticleHelper: true
      };
    },

    onSettingsClick: (state, { pttchrome }) => event => {
      event.stopPropagation();
      pttchrome.contextMenuShown = false;
      pttchrome.onDisableLiveHelperModalState();
      pttchrome.modalShown = true;
      return {
        ...initialState,
        showsSettings: true
      };
    },

    onQuickSearchSelect: (state, { pttchrome, selectedText }) => (
      eventKey,
      event
    ) => {
      const url = eventKey.replace("%s", selectedText);
      window.open(url);
      event.stopPropagation();
      pttchrome.contextMenuShown = false;
      return initialState;
    },

    onInputHelperHide: (state, { pttchrome }) => () => {
      return {
        showsInputHelper: false
      };
    },
    onInputHelperReset: (state, { pttchrome }) => () => {
      pttchrome.conn.send("\x15[m");
    },
    onInputHelperCmdSend: (state, { pttchrome }) => cmd => {
      if (!window.getSelection().isCollapsed && pttchrome.buf.pageState == 6) {
        // something selected
        var sel = pttchrome.view.getSelectionColRow();
        var y = pttchrome.buf.cur_y;
        var selCmd = "";
        // move cursor to end and send reset code
        selCmd += "\x1b[H";
        if (y > sel.end.row) {
          selCmd += "\x1b[A".repeat(y - sel.end.row);
        } else if (y < sel.end.row) {
          selCmd += "\x1b[B".repeat(sel.end.row - y);
        }
        var repeats = pttchrome.buf.getRowText(sel.end.row, 0, sel.end.col)
          .length;
        selCmd += "\x1b[C".repeat(repeats) + "\x15[m";

        // move cursor to start and send color code
        y = sel.end.row;
        selCmd += "\x1b[H";
        if (y > sel.start.row) {
          selCmd += "\x1b[A".repeat(y - sel.start.row);
        } else if (y < sel.start.row) {
          selCmd += "\x1b[B".repeat(sel.start.row - y);
        }
        repeats = pttchrome.buf.getRowText(sel.start.row, 0, sel.start.col)
          .length;
        selCmd += "\x1b[C".repeat(repeats);
        cmd = selCmd + cmd;
      }
      pttchrome.conn.send(cmd);
    },
    onInputHelperConvSend: (state, { pttchrome }) => value => {
      pttchrome.conn.convSend(value);
    },

    onLiveHelperHide: (state, { pttchrome }) => nextState => {
      pttchrome.setAutoPushthreadUpdate(-1);
      return {
        showsLiveArticleHelper: false,
        liveHelperEnabled: false
      };
    },
    onLiveHelperChange: (state, { pttchrome }) => nextState => {
      if (nextState.enabled) {
        // cancel easy reading mode first
        pttchrome.view.useEasyReadingMode = false;
        pttchrome.switchToEasyReadingMode();
        pttchrome.setAutoPushthreadUpdate(nextState.sec);
      } else {
        pttchrome.setAutoPushthreadUpdate(-1);
      }
      return {
        liveHelperEnabled: nextState.enabled,
        liveHelperSec: nextState.sec
      };
    },

    onPrefSave: (state, { pttchrome }) => values => {
      return onPrefSaveImpl(pttchrome, values);
    },
    onPrefReset: (state, { pttchrome }) => values => {
      pttchrome.view.redraw(true);
      return onPrefSaveImpl(pttchrome, values);
    }
  }),
  withProps(({ pttchrome, liveHelperEnabled, liveHelperSec, onLiveHelperChange }) => {
    var sec = liveHelperSec || 5;
    // Toggle live pushthread update on/off (used by the End key AND the mouse
    // button below). Works from off->on too (previously it was a no-op when off).
    pttchrome.onToggleLiveHelperModalState = () => {
      onLiveHelperChange({ enabled: !liveHelperEnabled, sec: sec });
    };
    pttchrome.onDisableLiveHelperModalState = liveHelperEnabled
      ? () => onLiveHelperChange({ enabled: false, sec: sec })
      : noop;
    // Exposed so a floating button can show / drive the live-update state.
    pttchrome._liveHelperEnabled = liveHelperEnabled;
  }),
  lifecycle({
    componentDidMount() {
      this.contextMenuHandler = event => {
        this.props.onContextMenu(event);
      };
      document
        .getElementById("BBSWindow")
        .addEventListener("contextmenu", this.contextMenuHandler, true);

      this.clickHandler = () => {
        this.props.onHide();
      };
      window.addEventListener("click", this.clickHandler, false);

      this.touchStartHandler = event => {
        if (event.target.getAttribute("role") === "menuitem") {
          return;
        }
        this.props.onHide();
      };
      window.addEventListener("touchstart", this.touchStartHandler, false);

      this.hotKeyUpHandler = event => {
        if (!this.props.open) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.altKey || event.ctrlKey || event.shiftKey) {
          return;
        }
        const eventKey = EVENT_KEY_BY_HOT_KEY[event.keyCode];
        if (eventKey) {
          this.props.onMenuSelect(eventKey, event);
        }
      };
      window.addEventListener("keyup", this.hotKeyUpHandler, false);
    },
    componentWillUnmount() {
      window.removeEventListener("keyup", this.hotKeyUpHandler, false);
      window.removeEventListener("touchstart", this.touchStartHandler, false);
      window.removeEventListener("click", this.clickHandler, false);
      // Must match how it was added (element, "contextmenu", capture=true);
      // the old code removed the wrong object/event/capture and left it leaked.
      const bbsWin = document.getElementById("BBSWindow");
      if (bbsWin) {
        bbsWin.removeEventListener(
          "contextmenu",
          this.contextMenuHandler,
          true
        );
      }
    }
  })
);

export const ContextMenu = ({
  pttchrome,
  //
  pageX,
  pageY,
  open,
  urlEnabled,
  normalEnabled,
  selEnabled,
  selectedText,
  contextUserId,
  onMenuSelect,
  onInputHelperClick,
  onLiveArticleHelperClick,
  onSettingsClick,
  onQuickSearchSelect,
  //
  showsInputHelper,
  showsLiveArticleHelper,
  showsSettings,
  //
  liveHelperEnabled,
  liveHelperSec,
  onInputHelperHide,
  onInputHelperReset,
  onInputHelperCmdSend,
  onInputHelperConvSend,
  onLiveHelperHide,
  onLiveHelperChange,
  onPrefSave,
  onPrefReset
}) => (
  <React.Fragment>
    <div
      className={cx({
        open
      })}
    >
      <DropdownMenu
        pageX={pageX}
        pageY={pageY}
        urlEnabled={urlEnabled}
        normalEnabled={normalEnabled}
        selEnabled={selEnabled}
        mouseBrowsingEnabled={pttchrome.buf.useMouseBrowsing}
        selectedText={selectedText}
        contextUserId={contextUserId}
        onMenuSelect={onMenuSelect}
        onInputHelperClick={onInputHelperClick}
        onLiveArticleHelperClick={onLiveArticleHelperClick}
        onSettingsClick={onSettingsClick}
        onQuickSearchSelect={onQuickSearchSelect}
      />
    </div>
    <InputHelperModal
      show={showsInputHelper}
      onHide={onInputHelperHide}
      onReset={onInputHelperReset}
      onCmdSend={onInputHelperCmdSend}
      onConvSend={onInputHelperConvSend}
    />
    <LiveHelperModal
      show={showsLiveArticleHelper}
      onHide={onLiveHelperHide}
      enabled={liveHelperEnabled}
      sec={liveHelperSec}
      onChange={onLiveHelperChange}
    />
    <PrefModal show={showsSettings} onSave={onPrefSave} onReset={onPrefReset} />
  </React.Fragment>
);

export default enhance(ContextMenu);

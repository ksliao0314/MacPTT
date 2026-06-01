// Main Program
import BaseModal from 'react-overlays/lib/Modal';
import { Fade, Modal } from "react-bootstrap";
import { AnsiParser } from './ansi_parser';
import { TermView } from './term_view';
import { TermBuf } from './term_buf';
import { TelnetConnection } from './telnet';
import { Websocket } from './websocket';
import { EasyReading } from './easy_reading';
import { TouchController } from './touch_controller';
import { i18n } from './i18n';
import { unescapeStr, b2u, parseWaterball } from './string_util';
import { setTimer } from './util';
import { AutoLogin } from './autologin';
import { isBlacklisted } from './blacklist';
import PasteShortcutAlert from '../components/PasteShortcutAlert';
import ConnectionAlert from '../components/ConnectionAlert';
import ContextMenu from '../components/ContextMenu';

function noop() {}

// Anti-idle keepalive. The old value was ESC ESC (\x1b\x1b), but ESC is PTT's
// "離開 / 上一層" (back/cancel) key — firing it while idle could pop you out of an
// article, a menu, or a [Y/n] prompt / editor. Down+Up arrows are a net-zero
// cursor move that is inert in every PTT screen yet still resets PTT's idle
// timer (this is how PCMan keeps alive).
const ANTI_IDLE_STR = '\x1b[B\x1b[A';

export const App = function() {

  this.CmdHandler = document.getElementById('cmdHandler');
  this.CmdHandler.setAttribute('useMouseBrowsing', '1');
  this.CmdHandler.setAttribute('doDOMMouseScroll','0');
  this.CmdHandler.setAttribute('SkipMouseClick','0');

  this.view = new TermView();
  this.buf = new TermBuf(80, 24);
  this.buf.setView(this.view);
  //this.buf.severNotifyStr=this.getLM('messageNotify');
  //this.buf.PTTZSTR1=this.getLM('PTTZArea1');
  //this.buf.PTTZSTR2=this.getLM('PTTZArea2');
  this.view.setBuf(this.buf);
  this.view.setCore(this);
  this.parser = new AnsiParser(this.buf);
  this.easyReading = new EasyReading(this, this.view, this.buf);

  //new pref - start
  this.antiIdleTime = 0;
  this.idleTime = 0;
  //new pref - end

  // for picPreview
  this.curX = 0;
  this.curY = 0;

  this.inputArea = document.getElementById('t');
  this.BBSWin = document.getElementById('BBSWindow');

  // horizontally center bbs window
  this.BBSWin.setAttribute("align", "center");
  this.view.mainDisplay.style.transformOrigin = 'center';

  this.mouseLeftButtonDown = false;
  this.mouseRightButtonDown = false;

  this.inputAreaFocusTimer = null;
  this.modalShown = false;

  this.lastSelection = null;

  this.waterball = { userId: '', message: '' };
  this.appFocused = true;

  this.endTurnsOnLiveUpdate = false;
  this.copyOnSelect = false;
  var version = window.navigator.userAgent.match(/Chrom(e|ium)\/(\d+)\./);
  if (version && version.length > 2) {
    this.chromeVersion = parseInt(version[2], 10);
  }

  var self = this;

  window.addEventListener('click', function(e) {
    self.mouse_click(e);
  }, false);

  window.addEventListener('mousedown', function(e) {
    self.mouse_down(e);
  }, false);

  $(window).mousedown(function(e) {
    var ret = self.middleMouse_down(e);
    if (ret === false) {
      return false;
    }
  });

  window.addEventListener('mouseup', function(e) {
    self.mouse_up(e);
  }, false);

  document.addEventListener('mousemove', function(e) {
    self.mouse_move(e);
  }, false);

  document.addEventListener('mouseover', function(e) {
    self.mouse_over(e);
  }, false);

  if ('onwheel' in window) {
    window.addEventListener('wheel', function(e) {
      self.mouse_scroll(e);
    }, true);
  } else {
    window.addEventListener('mousewheel', function(e) {
      self.mouse_scroll(e);
    }, true);
  }

  window.addEventListener('focus', function(e) {
    self.appFocused = true;
    if (self.view.titleTimer) {
      self.view.titleTimer.cancel();
      self.view.titleTimer = null;
      document.title = self.connectedUrl.site;
      self.view.notif.close();
    }
  }, false);

  window.addEventListener('blur', function(e) {
    self.appFocused = false;
  }, false);

  this.strToCopy = null;
  document.addEventListener('copy', function(e) {
    self.onDOMCopy(e);
  });
  this.inputArea.addEventListener('paste', function(e) {
    self.onDOMPaste(e);
  });

  this.view.innerBounds = this.getWindowInnerBounds();
  this.view.firstGridOffset = this.getFirstGridOffsets();
  window.onresize = function() {
    self.onWindowResize();
  };

  window.addEventListener('beforeunload', (e) => {
    if (this.conn && this.conn.isConnected && this.buf.pageState != 0) {
      e.returnValue = 'You are currently connected. Are you sure?';
      return e.returnValue;
    }
  });

  this.dblclickTimer=null;
  this.mbTimer=null;
  this.timerEverySec=null;
  this.pushthreadAutoUpdateCount = 0;
  this.maxPushthreadAutoUpdateCount = -1;
  this.liveUpdateOn = false;
  this.onWindowResize();
  this.setupContextMenus();
  this.contextMenuShown = false;

  // init touch only if chrome is higher than version 36
  if (this.chromeVersion && this.chromeVersion >= 37) {
    this.touch = new TouchController(this);
  }
};

App.prototype.isConnected = function() {
  return this.connectState == 1 && !!this.conn;
};

App.prototype.connect = function(url) {
  // Throttle: keep consecutive connect attempts at least 3s apart so a flaky
  // link (or a fast Enter on the reconnect prompt) can't hammer PTT and trip its
  // connection limit.
  var now = Date.now();
  var since = now - (this._lastConnectAt || 0);
  var MIN_INTERVAL = 3000;
  if (since < MIN_INTERVAL) {
    var self = this;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(function() {
      self._reconnectTimer = null;
      self.connect(url);
    }, MIN_INTERVAL - since);
    return;
  }
  this._lastConnectAt = now;
  // A real connect cancels any still-pending scheduled retry, otherwise that
  // stale timer would fire later and open a SECOND connection.
  if (this._reconnectTimer) {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  this.connectState = 0;
  console.log('connect: ' + url);

  var parsed = this._parseURLSimple(url);
  if (parsed.protocol == 'wsstelnet') {
    this._setupWebsocketConn('wss://' + parsed.hostname + parsed.path);
  } else if (parsed.protocol == 'wstelnet') {
    this._setupWebsocketConn('ws://' + parsed.hostname + parsed.path);
  } else {
    console.log('unsupport connect url protocol: ' + parsed.protocol);
    return;
  }

  this.connectedUrl = {
    url: url,
    site: parsed.hostname,
    port: parsed.port,
    easyReadingSupported: true
  };
};

// Deliberately drop the current session and open a fresh one. The new
// connection re-runs auto-login with the saved credentials, so this is how a
// first-time account setup logs in without restarting the app.
// We do NOT call conn.close() (that would pop the reconnect prompt) — opening a
// new connection makes the Rust side abort the previous one by id takeover.
App.prototype.reconnect = function() {
  var url = (this.connectedUrl && this.connectedUrl.url);
  if (!url) return;
  if (this.timerEverySec) {
    this.timerEverySec.cancel();
    this.timerEverySec = null;
  }
  this.cancelMbTimer();
  // Bypass the 3s throttle for an explicit, user-intended reconnect.
  this._lastConnectAt = 0;
  if (this._reconnectTimer) {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }
  this.connect(url);
};

App.prototype._parseURLSimple = function(url) {
  var protocol = url.split(/:\/\//, 2);
  if (protocol.length != 2)
    return null;
  var hostname = protocol[1].split(/\//, 2);
  var hostport = hostname[0].split(/:/);
  if (hostport > 2)
    return null;
  var port = hostport.length > 1 ? parseInt(hostport[1]) : {
    'wstelnet': 80,
    'wsstelnet': 443,
    'telnet': 23,
    'ssh': 22
  }[protocol[0]];
  return {
    protocol: protocol[0],
    hostname: hostname[0],
    host: hostport[0],
    port: port,
    path: '/' + (hostname.length > 1 ? hostname[1] : '')
  };
};

App.prototype._setupWebsocketConn = function(url) {
  var wsConn = new Websocket(url);
  this._attachConn(new TelnetConnection(wsConn));
};

App.prototype._attachConn = function(conn) {
  var self = this;
  this.conn = conn;
  this.conn.addEventListener('open', this.onConnect.bind(this));
  this.conn.addEventListener('close', this.onClose.bind(this));
  this.conn.addEventListener('data', function(e) {
    self.onData(e.detail.data);
  });
  this.conn.addEventListener('doNaws', function(e) {
    conn.sendWillNaws();
    conn.sendNaws(self.buf.cols, self.buf.rows);
  });
};

App.prototype.onConnect = function() {
  this.conn.isConnected = true;
  this.view.setConn(this.conn);
  console.info("pttchrome onConnect");
  this.connectState = 1;
  this.updateTabIcon('connect');
  this.idleTime = 0;
  this.autoLogin = new AutoLogin(this);
  var self = this;
  this.timerEverySec = setTimer(true, function() {
    self.antiIdle();
    self.view.onBlink();
    self.incrementCountToUpdatePushthread();
  }, 1000);
};

App.prototype.onData = function(data) {
  this.parser.feed(data);

  if (this.autoLogin) {
    this.autoLogin.feed(data);
  }

  if (!this.appFocused && this.view.enableNotifications) {
    // parse received data for waterball
    var wb = parseWaterball(b2u(data));
    if (wb) {
      if ('userId' in wb) {
        this.waterball.userId = wb.userId;
      }
      if ('message' in wb) {
        this.waterball.message = wb.message;
      }
      if (!isBlacklisted(this.waterball.userId)) {
        this.view.showWaterballNotification();
      }
    }
  }
};

App.prototype.onClose = function() {
  console.info("pttchrome onClose");
  if (this.timerEverySec) {
    this.timerEverySec.cancel();
  }
  this.conn.isConnected = false;

  this.cancelMbTimer();

  this.connectState = 2;
  this.idleTime = 0;

  const onDismiss = () => {
    ReactDOM.unmountComponentAtNode(container);
    this.connect(this.connectedUrl.url);
  }
  // ✕ closes the prompt WITHOUT reconnecting — the user can reconnect later via
  // the menu bar (檢視 → 重新連線, ⌘⇧R).
  const onClose = () => {
    ReactDOM.unmountComponentAtNode(container);
  }
  const container = document.getElementById('reactAlert');
  ReactDOM.render(
    <ConnectionAlert onDismiss={onDismiss} onClose={onClose} />,
    container
  );
  this.updateTabIcon('disconnect');
};

App.prototype.sendData = function(str) {
  if (this.connectState == 1)
    this.conn.convSend(str);
};

App.prototype.cancelMbTimer = function() {
  if (this.mbTimer) {
    this.mbTimer.cancel();
    this.mbTimer = null;
  }
};

App.prototype.setMbTimer = function() {
  this.cancelMbTimer();
  var _this = this;
  this.mbTimer = setTimer(false, function() {
    _this.mbTimer.cancel();
    _this.mbTimer = null;
    _this.CmdHandler.setAttribute('SkipMouseClick', '0');
  }, 100);
};

App.prototype.cancelDblclickTimer = function() {
  if (this.dblclickTimer) {
    this.dblclickTimer.cancel();
    this.dblclickTimer = null;
  }
};

App.prototype.setDblclickTimer = function() {
  this.cancelDblclickTimer();
  var _this = this;
  this.dblclickTimer = setTimer(false, function() {
    _this.dblclickTimer.cancel();
    _this.dblclickTimer = null;
  }, 350);
};

App.prototype.setInputAreaFocus = function() {
  if (this.modalShown || (this.touch && this.touch.touchStarted))
    return;
  //this.DocInputArea.disabled="";
  this.inputArea.focus();
};

// FIXME: Injected when enabled. See: src/components/ContextMenu/index.js
App.prototype.onToggleLiveHelperModalState = noop;
// FIXME: Injected when enabled. See: src/components/ContextMenu/index.js
App.prototype.onDisableLiveHelperModalState = noop;

App.prototype.switchToEasyReadingMode = function(doSwitch) {
  this.easyReading.leaveCurrentPost();
  if (doSwitch) {
    this.onDisableLiveHelperModalState();
    // clear the deep cloned copy of lines
    this.buf.pageLines = [];
    if (this.buf.pageState == 3) this.view.conn.send('\x1b[D\x1b[C'); //this.view.conn.send('qr');
  } else {
    this.view.mainContainer.style.paddingBottom = '';
    this.view.lastRowIndex = 22;
    this.view.lastRowDiv.style.display = '';
    this.view.replyRowDiv.style.display = '';
    // clear the deep cloned copy of lines
    this.buf.pageLines = [];
  }
  // request the full screen
  this.view.conn.send(unescapeStr('^L'));
};

App.prototype.doCopy = function(str) {
  if (str.indexOf('\x1b') < 0) {
    str = str.replace(/\r\n/g, '\r');
    str = str.replace(/\n/g, '\r');
    str = str.replace(/ +\r/g, '\r');
  }
  this.strToCopy = str;
  document.execCommand('copy');
};

App.prototype.doCopyAnsi = function() {
  if (!this.lastSelection)
    return;

  var selection = this.lastSelection;
  var pageLines = null;
  if (this.view.useEasyReadingMode && this.buf.pageState == 3) {
    pageLines = this.buf.pageLines;
  }

  var ansiText = '';
  if (selection.start.row == selection.end.row) {
    ansiText += this.buf.getText(selection.start.row, selection.start.col, selection.end.col, true, true, false, pageLines);
  } else {
    for (var i = selection.start.row; i <= selection.end.row; ++i) {
      var scol = 0;
      var ecol = this.buf.cols-1;
      if (i == selection.start.row) {
        scol = selection.start.col;
      } else if (i == selection.end.row) {
        ecol = selection.end.col;
      }
      ansiText += this.buf.getText(i, scol, ecol, true, true, false, pageLines);
      if (i != selection.end.row ) {
        ansiText += '\r';
      }
    }
  }

  this.doCopy(ansiText);
};

App.prototype.onDOMCopy = function(e) {
  if (this.strToCopy) {
    e.clipboardData.setData('text', this.strToCopy);
    e.preventDefault();
    console.log('copied: ', this.strToCopy);
    this.strToCopy = null;
  }
};

App.prototype.doPaste = function() {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(
      (text) => this.onPasteDone(text),
      () => this.showPasteUnimplemented());
  } else {
    this.showPasteUnimplemented();
  }
};

App.prototype.showPasteUnimplemented = function() {
  const container = document.getElementById('reactAlert')
  const onDismiss = () => {
    ReactDOM.unmountComponentAtNode(container)
    this.modalShown = false;
  }
  ReactDOM.render(
    <BaseModal
      show
      onExited={onDismiss}
      backdropClassName="modal-backdrop"
      containerClassName="modal-open"
      transition={Fade}
      dialogTransitionTimeout={Modal.TRANSITION_DURATION}
      backdropTransitionTimeout={Modal.BACKDROP_TRANSITION_DURATION}
    >
      <PasteShortcutAlert onDismiss={onDismiss} />
    </BaseModal>,
    container
  )
  this.modalShown = true;
};

App.prototype.onPasteDone = function(content) {
  //this.conn.convSend(content);
  this.view.onTextInput(content, true);
};

App.prototype.onDOMPaste = function(e) {
  let str = e.clipboardData.getData('text');
  if (str) {
    e.preventDefault();
    this.onPasteDone(str);
  }
};

App.prototype.onSymFont = function(content) {
  console.log("using " + (content ? "extension" : "system") + " font");
  var font_src = content ? 'src: url('+content.data+');' : '';
  var css = '@font-face { font-family: MingLiUNoGlyph; '+font_src+' }';
  var style = document.createElement('style');
  style.type = 'text/css';
  style.innerHTML = css;
  document.getElementsByTagName('head')[0].appendChild(style);
};

App.prototype.doSelectAll = function() {
  window.getSelection().selectAllChildren(this.view.mainDisplay);
};

App.prototype.doSearchGoogle = function(searchTerm) {
  window.open('http://google.com/search?q='+searchTerm);
};

App.prototype.doOpenUrlNewTab = function(a) {
  var e = document.createEvent('MouseEvents');
  e.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, true, false, false, false, 0, null);
  a.dispatchEvent(e);
};

App.prototype.incrementCountToUpdatePushthread = function(interval) {
  if (this.maxPushthreadAutoUpdateCount == -1) {
    this.pushthreadAutoUpdateCount = 0;
    return;
  }

  if (++this.pushthreadAutoUpdateCount >= this.maxPushthreadAutoUpdateCount) {
    this.pushthreadAutoUpdateCount = 0;
    if (this.buf.pageState == 3) {
      //this.view.conn.send('qrG');
      this.view.conn.send('\x1b[D\x1b[C\x1b[4~');
    } else {
      // User left the article — stop auto update.
      this.liveUpdateOn = false;
      this.setAutoPushthreadUpdate(-1);
    }
  }
};
App.prototype.setAutoPushthreadUpdate = function(seconds) {
  this.maxPushthreadAutoUpdateCount = seconds;
};

App.prototype.isLiveUpdateOn = function() {
  return this.maxPushthreadAutoUpdateCount > 0;
};

// Enable live pushthread update (no off switch — it stops automatically when the
// user leaves the article; see incrementCountToUpdatePushthread). Behaves like
// End: leaves easy-reading, jumps to the bottom, and auto-refreshes.
// `liveUpdateOn` keeps easy-reading from re-enabling itself when the refresh
// re-enters the article (see easy_reading).
App.prototype.toggleLiveUpdate = function() {
  this.liveUpdateOn = true;
  this.view.useEasyReadingMode = false;
  // Properly tear down the easy-reading view + redraw in normal mode, otherwise
  // the screen / mouse-browsing ends up in a broken half-state. The liveUpdateOn
  // flag keeps easy-reading from re-enabling itself on the refresh re-entry.
  this.switchToEasyReadingMode();
  this.setAutoPushthreadUpdate(5);
  if (this.connectState == 1 && this.conn) {
    this.conn.send('\x1b[4~'); // 置底 (go to bottom -> pushthread area)
  }
  if (this.setInputAreaFocus) this.setInputAreaFocus();
};

App.prototype.onWindowResize = function() {
  this.view.innerBounds = this.getWindowInnerBounds();

  if (this.resizeTimeout) {
    clearTimeout(this.resizeTimeout);
  }
  if (this.resizer) {
    this.resizeTimeout = setTimeout(() => {
      this.resizeTimeout = null;
      if (this.resizer) {
        this.resizer();
      }
    }, 500);
  } else {
    this.view.fontResize();
  }
};

App.prototype.setTermSize = function(cols, rows) {
  if (this.buf.cols == cols && this.buf.rows == rows) {
    return;
  }

  this.buf.resize(cols, rows);
  if (this.conn) {
    this.conn.sendNaws(cols, rows);
  }
};

App.prototype.switchMouseBrowsing = function() {
  if (this.CmdHandler.getAttribute('useMouseBrowsing')=='1') {
    this.CmdHandler.setAttribute('useMouseBrowsing', '0');
    this.buf.useMouseBrowsing=false;
  } else {
    this.CmdHandler.setAttribute('useMouseBrowsing', '1');
    this.buf.useMouseBrowsing=true;
  }

  if (!this.buf.useMouseBrowsing) {
    this.buf.BBSWin.style.cursor = 'auto';
    this.buf.clearHighlight();
    this.buf.mouseCursor=0;
    this.buf.nowHighlight=-1;
    this.buf.tempMouseCol=0;
    this.buf.tempMouseRow=0;
  } else {
    this.buf.resetMousePos();
    this.view.redraw(true);
    this.view.updateCursorPos();
  }
};

App.prototype.antiIdle = function() {
  if (this.antiIdleTime && this.idleTime > this.antiIdleTime) {
    if (this.connectState == 1) {
      this.conn.send(ANTI_IDLE_STR);
      this.idleTime = 0;
    }
  } else {
    if (this.connectState == 1)
      this.idleTime += 1000;
  }
};

App.prototype.updateTabIcon = function(aStatus) {
  var icon = require('../icon/logo.png');
  switch (aStatus) {
    case 'connect':
      icon = require('../icon/logo_connect.png');
      this.setInputAreaFocus();
      break;
    case 'disconnect':
      icon = require('../icon/logo_disconnect.png');
      break;
    default:
      break;
  }

  var link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "icon");
    link.setAttribute("href", icon);
    document.head.appendChild(link);
  } else {
    link.setAttribute("href", icon);
  }
};

// use this method to get better window size in case of page zoom != 100%
App.prototype.getWindowInnerBounds = function() {
  var width = document.documentElement.clientWidth - this.view.bbsViewMargin * 2;
  var height = document.documentElement.clientHeight - this.view.bbsViewMargin * 2;
  var bounds = {
    width: width,
    height: height
  };
  return bounds;
};

App.prototype.getFirstGridOffsets = function() {
  var container = $(".main")[0];
  return {
    top: container.offsetTop,
    left: container.offsetLeft
  };
};

App.prototype.clientToPos = function(cX, cY) {
  var x;
  var y;
  var w = this.view.innerBounds.width;
  var h = this.view.innerBounds.height;
  if (this.view.scaleX != 1 || this.view.scaleY != 1) {
    x = cX - ((w - (this.view.chw * this.buf.cols) * this.view.scaleX) / 2);
    y = cY - ((h - (this.view.chh * this.buf.rows) * this.view.scaleY) / 2);
  } else {
    x = cX - parseFloat(this.view.firstGridOffset.left);
    y = cY - parseFloat(this.view.firstGridOffset.top);
  }
  var col = Math.floor(x / (this.view.chw * this.view.scaleX));
  var row = Math.floor(y / (this.view.chh * this.view.scaleY));

  if (row < 0)
    row = 0;
  else if (row >= this.buf.rows-1)
    row = this.buf.rows-1;

  if (col < 0)
    col = 0;
  else if (col >= this.buf.cols-1)
    col = this.buf.cols-1;

  return {col: col, row: row};
};

App.prototype.onMouse_click = function (e) {
  var cX = e.clientX, cY = e.clientY;
  if (!this.conn || !this.conn.isConnected)
    return;

  // disable auto update pushthread if any command is issued;
  this.onDisableLiveHelperModalState();

  // TODO make a responder stack.
  this.easyReading._onMouseClick(e);
  if (e.defaultPrevented)
    return;

  // TODO Move this to mouse browsing module.
  switch (this.buf.mouseCursor) {
    case 1:
      this.conn.send('\x1b[D');  //Arrow Left
      break;
    case 2:
      this.conn.send('\x1b[5~'); //Page Up
      break;
    case 3:
      this.conn.send('\x1b[6~'); //Page Down
      break;
    case 4:
      this.conn.send('\x1b[1~'); //Home
      break;
    case 5:
      this.conn.send('\x1b[4~'); //End
      break;
    case 6:
      if (this.buf.nowHighlight != -1) {
        var sendstr = '';
        if (this.buf.cur_y > this.buf.nowHighlight) {
          var count = this.buf.cur_y - this.buf.nowHighlight;
          for (var i = 0; i < count; ++i)
            sendstr += '\x1b[A'; //Arrow Up
        } else if (this.buf.cur_y < this.buf.nowHighlight) {
          var count = this.buf.nowHighlight - this.buf.cur_y;
          for (var i = 0; i < count; ++i)
            sendstr += '\x1b[B'; //Arrow Down
        }
        sendstr += '\r';
        this.conn.send(sendstr);
      }
      break;
    case 7:
      var pos = this.clientToPos(cX, cY);
      var sendstr = '';
      if (this.buf.cur_y > pos.row) {
        var count = this.buf.cur_y - pos.row;
        for (var i = 0; i < count; ++i)
          sendstr += '\x1b[A'; //Arrow Up
      } else if (this.buf.cur_y < pos.row) {
        var count = pos.row - this.buf.cur_y;
        for (var i = 0; i < count; ++i)
          sendstr += '\x1b[B'; //Arrow Down
      }
      sendstr += '\r';
      this.conn.send(sendstr);
      break;
    case 0:
      this.conn.send('\x1b[D'); //Arrow Left
      break;
    case 8:
      this.conn.send('['); //Previous post with the same title
      break;
    case 9:
      this.conn.send(']'); //Next post with the same title
      break;
    case 10:
      this.conn.send('='); //First post with the same title
      break;
    case 12:
      this.conn.send('\x1b[D\r\x1b[4~'); //Refresh post / pushed texts
      break;
    case 13:
      this.conn.send('\x1b[D\r\x1b[4~[]'); //Last post with the same title (LIST)
      break;
    case 14:
      this.conn.send('\x1b[D\x1b[4~[]\r'); //Last post with the same title (READING)
      break;
    default:
      //do nothing
      break;
  }
};

App.prototype.onMouse_move = function(cX, cY) {
  var pos = this.clientToPos(cX, cY);
  this.buf.onMouse_move(pos.col, pos.row, false);
};

// Re-derive the mouse-browsing hover highlight from the last known mouse
// position. Used after a screen update so a transient pageState flip (which
// clears the highlight) doesn't leave the bar gone until the next mouse move.
App.prototype.refreshMouseHighlight = function() {
  if (!this.buf.useMouseBrowsing || this.modalShown) return;
  if (typeof this.curX !== 'number' || typeof this.curY !== 'number') return;
  if (this.mouseLeftButtonDown) return;
  if (!window.getSelection().isCollapsed) return;
  this.onMouse_move(this.curX, this.curY);
};

App.prototype.resetMouseCursor = function(cX, cY) {
  this.buf.BBSWin.style.cursor = 'auto';
  this.buf.mouseCursor = 11;
};

// Ring buffer of recent (time, x, y) cursor samples (~600ms), recorded on plain
// mouse moves. Used to rewind past gesture-start drift (see beginGestureFreeze).
App.prototype._recordCursor = function(t, x, y) {
  if (!this._curHist) this._curHist = [];
  this._curHist.push({ t: t, x: x, y: y });
  var cut = t - 600;
  while (this._curHist.length > 1 && this._curHist[0].t < cut) {
    this._curHist.shift();
  }
};

// Called the instant a multi-finger gesture is first detected. The first finger
// of a 2/3-finger swipe usually lands and slides a few px before the OS reports
// the gesture, dragging the hover highlight with it. Rewind the remembered
// position (and the highlight) to a sample from just BEFORE that drift, so once
// the freeze (mouse_* guards) takes over, the cursor sits exactly where it was.
App.prototype.beginGestureFreeze = function(now) {
  if (!this._curHist || !this._curHist.length) return;
  var target = now - 200; // ~200ms back clears typical finger-landing drift
  var pick = this._curHist[0];
  for (var i = this._curHist.length - 1; i >= 0; i--) {
    if (this._curHist[i].t <= target) { pick = this._curHist[i]; break; }
  }
  this.curX = pick.x;
  this.curY = pick.y;
  if (this.buf && this.buf.useMouseBrowsing && !this.modalShown &&
      window.getSelection().isCollapsed && !this.mouseLeftButtonDown) {
    this.onMouse_move(pick.x, pick.y);
  }
};

App.prototype.onValuesPrefChange = function(values) {
  for (var name in values) {
    this.onPrefChange(name, values[name]);
  }

  // These prefs have to be processed as a whole.
  try {
    this.resizer = null;

    switch (values.termSizeMode) {
      case 'fixed-term-size':
        this.view.fontFitWindowWidth = values.fontFitWindowWidth;

        let size = values.termSize;
        this.setTermSize(size.cols, size.rows);
        this.view.fontResize();
        this.view.redraw(true);
        break;

      case 'fixed-font-size':
        this.view.fontFitWindowWidth = false;

        let fontSize = values.fontSize;
        this.resizer = () => {
          let size = this.view.calcTermSizeFromFont(fontSize);
          this.setTermSize(size.cols, size.rows);
          this.view.fixedResize(fontSize);
          this.view.redraw(true);
        };
        // Immediately recalc once.
        this.resizer();
        break;
    }

    if (this.view.fontFitWindowWidth) {
      $('.main').addClass('trans-fix');
    } else {
      $('.main').removeClass('trans-fix');
    }
  } catch (e) {}
};

App.prototype.onPrefChange = function(name, value) {
  try {
    switch (name) {
    case 'useMouseBrowsing':
      var useMouseBrowsing = value;
      this.CmdHandler.setAttribute('useMouseBrowsing', useMouseBrowsing?'1':'0');
      this.buf.useMouseBrowsing = useMouseBrowsing;

      if (!this.buf.useMouseBrowsing) {
        this.buf.BBSWin.style.cursor = 'auto';
        this.buf.clearHighlight();
        this.buf.mouseCursor = 0;
        this.buf.nowHighlight = -1;
        this.buf.tempMouseCol = 0;
        this.buf.tempMouseRow = 0;
      }
      this.buf.resetMousePos();
      this.view.redraw(true);
      this.view.updateCursorPos();
      break;
    case 'mouseBrowsingHighlight':
      this.buf.highlightCursor = value;
      this.view.redraw(true);
      this.view.updateCursorPos();
      break;
    case 'mouseBrowsingHighlightColor':
      this.view.highlightBG = value;
      this.view.redraw(true);
      this.view.updateCursorPos();
      break;
    case 'mouseLeftFunction':
      this.view.leftButtonFunction = value;
      if (typeof(this.view.leftButtonFunction) == 'boolean') {
        this.view.leftButtonFunction = this.view.leftButtonFunction ? 1:0;
      }
      break;
    case 'mouseMiddleFunction':
      this.view.middleButtonFunction = value;
      break;
    case 'mouseWheelFunction1':
      this.view.mouseWheelFunction1 = value;
      break;
    case 'mouseWheelFunction2':
      this.view.mouseWheelFunction2 = value;
      break;
    case 'mouseWheelFunction3':
      this.view.mouseWheelFunction3 = value;
      break;
    case 'copyOnSelect':
      this.copyOnSelect = value;
      break;
    case 'endTurnsOnLiveUpdate':
      this.endTurnsOnLiveUpdate = value;
      break;
    case 'enablePicPreview':
      // TODO: move this to ImagePreview.
      this.view.enablePicPreview = value;
      break;
    case 'enableNotifications':
      this.view.enableNotifications = value;
      break;
    case 'trackpadSmoothScroll':
      this.view.trackpadSmoothScroll = value;
      break;
    case 'trackpadScrollSpeed':
      this.view.trackpadScrollSpeed = value;
      break;
    case 'trackpadGesture':
      // JS gate for the gesture event listeners (native_menu.js).
      this.trackpadGestureEnabled = !!value;
      // Native gate: stops the Rust monitor from pinning the cursor / emitting
      // paging events when off, so the trackpad behaves completely normally.
      try {
        if (window.__TAURI__ && window.__TAURI__.core) {
          window.__TAURI__.core.invoke('set_gesture_enabled', { enabled: !!value });
        }
      } catch (e) {}
      break;
    case 'enableEasyReading':
      // DO NOT set this.view.useEasyReadingMode here. Easy-reading renders the
      // article into #mainContainer, which only exists after a normal screen has
      // rendered (and you've entered an article). Forcing useEasyReadingMode=true
      // at startup diverts the very first redraw into populateEasyReadingPage
      // before #mainContainer exists → throws → the whole terminal stays blank
      // (all-black window). The mode is entered through its own path when reading
      // an article; leave the flag alone here.
      break;
    case 'antiIdleTime':
      // Clamp to the allowed range 180..300s (covers legacy stored values like 0).
      var antiIdleSec = Math.min(300, Math.max(180, parseInt(value, 10) || 180));
      this.antiIdleTime = antiIdleSec * 1000;
      break;
    case 'dbcsDetect':
      this.view.dbcsDetect = value;
      break;
    case 'lineWrap':
      this.conn.lineWrap = value;
      break;
    case 'fontFace':
      var fontFace = value;
      if (!fontFace) 
        fontFace='monospace';
      this.view.setFontFace(fontFace);
      break;
    case 'bbsMargin':
      var margin = value;
      this.view.bbsViewMargin = margin;
      this.onWindowResize();
      break;
    default:
      break;
    }
  } catch(e) {
    // eats all errors
    return;
  }
};

App.prototype.checkClass = function(cn) {
  return (  cn.indexOf("closeSI") >= 0  || cn.indexOf("EPbtn") >= 0 || 
      cn.indexOf("closePP") >= 0 || cn.indexOf("picturePreview") >= 0 || 
      cn.indexOf("drag") >= 0    || cn.indexOf("floatWindowClientArea") >= 0 || 
      cn.indexOf("WinBtn") >= 0  || cn.indexOf("sBtn") >= 0 || 
      cn.indexOf("nonspan") >= 0 || cn.indexOf("nomouse_command") >= 0);
};

App.prototype.mouse_click = function(e) {
  if (this.modalShown)
    return;
  // During a trackpad multi-finger gesture (incl. the release click) → don't let
  // the incidental click enter a board/article.
  if (this._gestureUntil && Date.now() < this._gestureUntil) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  var skipMouseClick = (this.CmdHandler.getAttribute('SkipMouseClick') == '1');
  this.CmdHandler.setAttribute('SkipMouseClick','0');

  if (e.button == 2) { //right button
  } else if (e.button === 0) { //left button
    if ($(e.target).is('a') || $(e.target).parent().is('a')) {
      return;
    }
    if (window.getSelection().isCollapsed) { //no anything be select
      if (this.buf.useMouseBrowsing) {
        var doMouseCommand = true;
        if (e.target.className)
          if (this.checkClass(e.target.className))
            doMouseCommand = false;
        if (e.target.tagName)
          if(e.target.tagName.indexOf("menuitem") >= 0 )
            doMouseCommand = false;
        if (skipMouseClick) {
          doMouseCommand = false;
          var pos = this.clientToPos(e.clientX, e.clientY);
          this.buf.onMouse_move(pos.col, pos.row, true);
        }
        if (doMouseCommand) {
          this.onMouse_click(e);
          this.setDblclickTimer();
          e.preventDefault();
          this.setInputAreaFocus();
        }
      } else if (this.view.leftButtonFunction) {
        if (this.view.leftButtonFunction == 1) {
          this.setBBSCmd('doEnter', this.CmdHandler);
          e.preventDefault();
          this.setInputAreaFocus();
        } else if (this.view.leftButtonFunction == 2) {
          this.setBBSCmd('doRight', this.CmdHandler);
          e.preventDefault();
          this.setInputAreaFocus();
        }
      }
    }
  } else if (e.button == 1) { //middle button
  } else {
  }
};

App.prototype.middleMouse_down = function(e) {
  // moved to here because middle click works better with jquery
  if (e.button == 1) {
    if ($(e.target).is('a') || $(e.target).parent().is('a')) {
      return;
    }
    if (this.view.middleButtonFunction == 1) {
      this.conn.send('\r');
      return false;
    } else if (this.view.middleButtonFunction == 2) {
      this.conn.send('\x1b[D');
      return false;
    } else if (this.view.middleButtonFunction == 3) {
      this.doPaste();
      return false;
    }
  }
};

App.prototype.mouse_down = function(e) {
  if (this.modalShown)
    return;
  // Swallow button events synthesised during a trackpad multi-finger gesture
  // (e.g. three-finger drag) so paging never starts a click/drag-select.
  if (this._gestureUntil && Date.now() < this._gestureUntil)
    return;
  //0=left button, 1=middle button, 2=right button
  if (e.button === 0) {
    if (this.buf.useMouseBrowsing) {
      if (this.dblclickTimer) { //skip
        e.preventDefault();
        e.stopPropagation();
        e.cancelBubble = true;
      }
      this.setDblclickTimer();
    }
    this.mouseLeftButtonDown = true;
    //this.setInputAreaFocus();
    if (!(window.getSelection().isCollapsed))
      this.CmdHandler.setAttribute('SkipMouseClick','1');

    var onbbsarea = true;
    if (e.target.className)
      if (this.checkClass(e.target.className))
        onbbsarea = false;
    if (e.target.tagName)
      if (e.target.tagName.indexOf("menuitem") >= 0 )
        onbbsarea = false;
  } else if(e.button == 2) {
    this.mouseRightButtonDown = true;
    // Remember whether the user already had a real selection BEFORE the
    // right-click, so the context menu can ignore the word the webview may
    // auto-select on right-click.
    this.rightClickHadSelection = !window.getSelection().isCollapsed;
  }
};

App.prototype.mouse_up = function(e) {
  if (this.modalShown)
    return;
  // During a multi-finger gesture, the button-release would otherwise call
  // onMouse_move() below and snap the hover highlight to the release point —
  // freeze it (the user is only paging).
  if (this._gestureUntil && Date.now() < this._gestureUntil)
    return;
  //0=left button, 1=middle button, 2=right button
  if (e.button === 0) {
    this.setMbTimer();
    this.mouseLeftButtonDown = false;
  } else if (e.button == 2) {
    this.mouseRightButtonDown = false;
  }

  if (e.button === 0 || e.button == 2) { //left or right button
    if (window.getSelection().isCollapsed) { //no anything be select
      if (this.buf.useMouseBrowsing)
        this.onMouse_move(e.clientX, e.clientY);

      this.setInputAreaFocus();
      if (e.button === 0) {
        var preventDefault = true;
        if (e.target.className)
          if (this.checkClass(e.target.className))
            preventDefault = false;
        if (e.target.tagName)
          if (e.target.tagName.indexOf("menuitem") >= 0 )
            preventDefault = false;
        if (preventDefault)
          e.preventDefault();
      }
    } else { //something has be select
      if (this.copyOnSelect) {
        this.doCopy(window.getSelection().toString().replace(/\u00a0/g, " "));
      }
    }
  } else {
    this.setInputAreaFocus();
    e.preventDefault();
  }
  var _this = this;
  this.inputAreaFocusTimer = setTimer(false, function() {
    clearTimeout(_this.inputAreaFocusTimer);
    _this.inputAreaFocusTimer = null;
    if (window.getSelection().isCollapsed)
      _this.setInputAreaFocus();
  }, 10);
};

App.prototype.mouse_move = function(e) {
  // While a modal (e.g. Settings) is open, don't let the mouse-browsing hover
  // indicator keep tracking/moving behind it — clear it and bail.
  if (this.modalShown) {
    if (this.view) this.view.setHighlightedRow(-1);
    return;
  }
  // During a trackpad multi-finger gesture (paging), keep the hover highlight and
  // remembered position exactly where they are — the user only wants to page, not
  // move the cursor (same as the two-finger back gesture).
  var _nowMM = Date.now();
  if (this._gestureUntil && _nowMM < this._gestureUntil) {
    return;
  }
  // Keep a short trail of recent cursor positions. When a multi-finger gesture
  // is detected a moment from now, beginGestureFreeze() rewinds to one of these
  // samples to undo the drift caused by the first finger landing slightly before
  // the OS recognises the 2/3-finger gesture (the residual "cursor moved" jump).
  this._recordCursor(_nowMM, e.clientX, e.clientY);
  // Self-heal a stuck button flag: if no mouse button is actually pressed now
  // (e.buttons === 0), a mouseup was missed — released outside the window, focus
  // stolen by a share sheet / external link, a modal opened mid-press, etc.
  // Without this, mouseLeftButtonDown stays true and mouse-browsing freezes (the
  // hover stops moving) until you click — which would navigate — or use the
  // keyboard. e.buttons is the live pressed-button bitmask.
  if (e.buttons === 0 && (this.mouseLeftButtonDown || this.mouseRightButtonDown)) {
    this.mouseLeftButtonDown = false;
    this.mouseRightButtonDown = false;
    this.CmdHandler.setAttribute('SkipMouseClick', '0');
  }
  this.curX = e.clientX;
  this.curY = e.clientY;
  if (this.buf.useMouseBrowsing) {
    // Decide hover from the LIVE button state (e.buttons bitmask: 1=left, 2=right),
    // NOT from the mouseLeftButtonDown flag or a leftover text selection — either
    // of those can get "stuck" and freeze mouse browsing (the recurring failure).
    // We only defer to a selection while a button is actually held down (an active
    // drag-select); the moment no button is pressed, hover-browsing resumes even
    // if some stray selection is still on screen.
    if ((e.buttons & 3) === 0) {
      this.onMouse_move(e.clientX, e.clientY);
    } else if (!window.getSelection().isCollapsed) {
      this.resetMouseCursor();
    }
  }

};

App.prototype.mouse_over = function(e) {
  if (this.modalShown)
    return;
  // Don't update the remembered cursor position during a gesture, so a later
  // redraw won't reposition the hover highlight to where the fingers drifted.
  if (this._gestureUntil && Date.now() < this._gestureUntil)
    return;

  this.curX = e.clientX;
  this.curY = e.clientY;

  if(window.getSelection().isCollapsed && !this.mouseLeftButtonDown)
    this.setInputAreaFocus();
};

App.prototype.mouse_scroll = function(e) {
  if (this.modalShown) 
    return;
  // if in easyreading, use it like webpage
  if (this.view.useEasyReadingMode && this.buf.pageState == 3) {
    return;
  }

  // Ignore horizontal swipes here — they are handled as the back gesture.
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    return;
  }

  // Trackpad / precise scrolling (pixel deltas, deltaMode 0) fires a flood of
  // momentum events; throttle to a controlled rate so it doesn't scroll too fast.
  // Real mouse wheels (line/page deltas) are left untouched: one step per notch.
  if (this.view.trackpadSmoothScroll && e.deltaMode === 0 &&
      !this.mouseRightButtonDown && !this.mouseLeftButtonDown) {
    var _now = Date.now();
    var _ad = Math.abs(e.deltaY);

    // Track the current gesture (a run of events <160ms apart). A new flick
    // resets the peak magnitude and the per-gesture step count.
    if (!this._gestureLast || (_now - this._gestureLast) > 160) {
      this._gesturePeak = 0;
      this._gestureSteps = 0;
    }
    this._gestureLast = _now;
    if (_ad > this._gesturePeak) this._gesturePeak = _ad;

    // Boundary cooldown: after a few real steps, drop the decaying momentum tail
    // (delta fallen below 35% of the gesture's peak). The inertia after you lift
    // your fingers no longer carries past the top/bottom into the prev/next
    // article — while deliberate (steady-delta) scrolling is unaffected.
    if (this._gestureSteps >= 3 && _ad < this._gesturePeak * 0.35) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    var _intervals = { 1: 100, 2: 70, 3: 50, 4: 35, 5: 25 };
    var _minMs = _intervals[this.view.trackpadScrollSpeed] || 70;
    if (this._lastTrackpadMs && (_now - this._lastTrackpadMs) < _minMs) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    this._lastTrackpadMs = _now;
    this._gestureSteps++;
  }

  // scroll = up/down
  // hold right mouse key + scroll = page up/down
  // hold left mouse key + scroll = thread prev/next
  var mouseWheelActionsUp = [ 'none', 'doArrowUp', 'doPageUp', 'previousThread' ];
  var mouseWheelActionsDown = [ 'none', 'doArrowDown', 'doPageDown', 'nextThread' ];

  if (e.deltaY < 0 || e.wheelDelta > 0) { // scrolling up
    if (this.mouseRightButtonDown) {
      var action = mouseWheelActionsUp[this.view.mouseWheelFunction2];
      this.setBBSCmd(action);
    } else if (this.mouseLeftButtonDown) {
      var action = mouseWheelActionsUp[this.view.mouseWheelFunction3];
      this.setBBSCmd(action);
    } else {
      var action = mouseWheelActionsUp[this.view.mouseWheelFunction1];
      this.setBBSCmd(action);
    }
  } else { // scrolling down
    if (this.mouseRightButtonDown) {
      var action = mouseWheelActionsDown[this.view.mouseWheelFunction2];
      this.setBBSCmd(action);
    } else if (this.mouseLeftButtonDown) {
      var action = mouseWheelActionsDown[this.view.mouseWheelFunction3];
      this.setBBSCmd(action);
    } else {
      var action = mouseWheelActionsDown[this.view.mouseWheelFunction1];
      this.setBBSCmd(action);
    }
  }
  

  e.stopPropagation();
  e.preventDefault();

  if (this.mouseRightButtonDown) //prevent context menu popup
    this.CmdHandler.setAttribute('doDOMMouseScroll','1');
  if (this.mouseLeftButtonDown) {
    if (this.buf.useMouseBrowsing) {
      this.CmdHandler.setAttribute('SkipMouseClick','1');
    }
  }
};

App.prototype.setBBSCmd = function setBBSCmd(cmd) {
  switch (cmd) {
    case "doArrowUp":
      if (this.view.useEasyReadingMode && this.buf.startedEasyReading) {
        if (this.view.mainDisplay.scrollTop === 0) {
          this.easyReading.leaveCurrentPost();
          this.conn.send('\x1b[D\x1b[A\x1b[C');
        } else {
          this.view.mainDisplay.scrollTop -= this.view.chh;
        }
      } else {
        this.conn.send('\x1b[A');
      }
      break;
    case "doArrowDown":
      if (this.view.useEasyReadingMode && this.buf.startedEasyReading) {
        if (this.view.mainDisplay.scrollTop >= this.view.mainContainer.clientHeight - this.view.chh * this.buf.rows) {
          this.easyReading.leaveCurrentPost();
          this.conn.send('\x1b[B');
        } else {
          this.view.mainDisplay.scrollTop += this.view.chh;
        }
      } else {
        this.conn.send('\x1b[B');
      }
      break;
    case "doPageUp":
      if (this.view.useEasyReadingMode && this.buf.startedEasyReading) {
        this.view.mainDisplay.scrollTop -= this.view.chh * this.easyReading._turnPageLines;
      } else {
        this.conn.send('\x1b[5~');
      }
      break;
    case "doPageDown":
      if (this.view.useEasyReadingMode && this.buf.startedEasyReading) {
        this.view.mainDisplay.scrollTop += this.view.chh * this.easyReading._turnPageLines;
      } else {
        this.conn.send('\x1b[6~');
      }
      break;
    case "previousThread":
      if (this.view.useEasyReadingMode && this.buf.startedEasyReading) {
        this.easyReading.leaveCurrentPost();
        this.conn.send('[');
      } else if (this.buf.pageState==2 || this.buf.pageState==3 || this.buf.pageState==4) {
        this.conn.send('[');
      }
      break;
    case "nextThread":
      if (this.view.useEasyReadingMode && this.buf.startedEasyReading) {
        this.easyReading.leaveCurrentPost();
        this.conn.send(']');
      } else if (this.buf.pageState==2 || this.buf.pageState==3 || this.buf.pageState==4) {
        this.conn.send(']');
      }
      break;
    case "doEnter":
      if (this.view.useEasyReadingMode && this.buf.startedEasyReading) {
        if (this.view.mainDisplay.scrollTop >= this.view.mainContainer.clientHeight - this.view.chh * this.buf.rows) {
          this.easyReading.leaveCurrentPost();
          this.conn.send('\r');
        } else {
          this.view.mainDisplay.scrollTop += this.view.chh;
        }
      } else {
        this.conn.send('\r');
      }
      break;
    case "doRight":
      if (this.view.useEasyReadingMode && this.buf.startedEasyReading) {
        if (this.view.mainDisplay.scrollTop >= this.view.mainContainer.clientHeight - this.view.chh * this.buf.rows) {
          this.easyReading.leaveCurrentPost();
          this.conn.send('\x1b[C');
        } else {
          this.view.mainDisplay.scrollTop += this.view.chh * this.easyReading._turnPageLines;
        }
      } else {
        this.conn.send('\x1b[C');
      }
      break;
    default:
      break;
  }
}

App.prototype.setupContextMenus = function() {
  ReactDOM.render(
    <ContextMenu
      pttchrome={this}
    />,
    document.getElementById('cmenuReact')
  );
};

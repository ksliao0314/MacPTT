import { Event } from './event';

// PttChrome v3:
// In a normal browser / extension, connect directly with the native WebSocket.
// Inside the Tauri native shell (window.__TAURI__ present), route the byte stream
// through Rust over IPC instead — that lets the native side set the Origin header
// (https://term.ptt.cc) that PTT's gateway whitelist requires, which a browser
// page cannot do. Either way this class exposes the SAME interface to the rest of
// the app (open/data/error/close events + send/close), so telnet.js etc. are
// unchanged.

const IS_TAURI = (typeof window !== 'undefined') && !!window.__TAURI__;

// Origin accepted by PTT's ws.ptt.cc whitelist (verified: others get HTTP 403).
const PTT_ORIGIN = 'https://term.ptt.cc';

// Per-connection id. Tauri events are global broadcasts, so each connection
// tags/filters its events by id — otherwise a closing old connection's
// 'ptt://close' would fire a newer connection's handler and cause a reconnect
// loop (e.g. during reconnect / Cmd+R reload).
var __tauriConnSeq = 0;

export function Websocket(url) {
  return IS_TAURI ? new TauriWebsocket(url) : new BrowserWebsocket(url);
}

// ---------------------------------------------------------------------------
// Browser / extension transport (original behaviour).
// ---------------------------------------------------------------------------
function BrowserWebsocket(url) {
  this._conn = new WebSocket(url);
  this._conn.binaryType = 'arraybuffer';
  this._conn.addEventListener('open', this._onOpen.bind(this));
  this._conn.addEventListener('message', this._onMessage.bind(this));
  this._conn.addEventListener('error', this._onError.bind(this));
  this._conn.addEventListener('close', this._onClose.bind(this));
}

Event.mixin(BrowserWebsocket.prototype);

BrowserWebsocket.prototype._onOpen = function(e) {
  this.dispatchEvent(new CustomEvent('open'));
};

BrowserWebsocket.prototype._onMessage = function(e) {
  var data = new Uint8Array(e.data);
  this.dispatchEvent(new CustomEvent('data', {
    detail: {
      data: String.fromCharCode.apply(String, data)
    }
  }));
};

BrowserWebsocket.prototype._onError = function(e) {
  this.dispatchEvent(new CustomEvent('error'));
};

BrowserWebsocket.prototype._onClose = function(e) {
  this.dispatchEvent(new CustomEvent('close'));
};

BrowserWebsocket.prototype.send = function(str) {
  // ptt responds slowly after a large paste, so split it up.
  var chunk = 1000;
  for (var i = 0; i < str.length; i += chunk) {
    var chunkStr = str.substring(i, i + chunk);
    var byteArray = new Uint8Array(chunkStr.split('').map(function(x) { return x.charCodeAt(0); }));
    this._conn.send(byteArray.buffer);
  }
};

BrowserWebsocket.prototype.close = function() {
  this._conn.close();
};

// ---------------------------------------------------------------------------
// Tauri transport: bytes are ferried to/from a Rust WebSocket client over IPC.
// ---------------------------------------------------------------------------
function TauriWebsocket(url) {
  this._closed = false;
  this._unlisten = [];
  this._id = ++__tauriConnSeq;
  var event = window.__TAURI__.event;
  this._invoke = window.__TAURI__.core.invoke;
  var self = this;

  // Only react to events tagged with this connection's id.
  function mine(e) { return !!(e && e.payload && e.payload.id === self._id); }

  // Register listeners BEFORE asking Rust to connect, so no event is missed.
  Promise.all([
    event.listen('ptt://recv', function(e) { if (mine(e)) self._onRecv(e.payload.data); }),
    event.listen('ptt://open', function(e) { if (mine(e)) self.dispatchEvent(new CustomEvent('open')); }),
    event.listen('ptt://close', function(e) { if (mine(e)) self._onClose(); }),
    event.listen('ptt://error', function(e) { if (mine(e)) self._onError(e.payload && e.payload.data); })
  ]).then(function(unlisteners) {
    self._unlisten = unlisteners;
    return self._invoke('ws_connect', { url: url, origin: PTT_ORIGIN, id: self._id });
  }).catch(function(err) {
    console.error('[tauri] ws_connect failed:', err);
    self._onError(String(err));
  });
}

Event.mixin(TauriWebsocket.prototype);

TauriWebsocket.prototype._onRecv = function(payload) {
  // payload is a byte array (number[]) emitted from Rust.
  var str;
  if (typeof payload === 'string') {
    str = payload;
  } else {
    // Convert in chunks to avoid String.fromCharCode argument-count limits.
    str = '';
    var CH = 8192;
    for (var i = 0; i < payload.length; i += CH) {
      str += String.fromCharCode.apply(String, payload.slice(i, i + CH));
    }
  }
  this.dispatchEvent(new CustomEvent('data', { detail: { data: str } }));
};

TauriWebsocket.prototype._onError = function(detail) {
  this.dispatchEvent(new CustomEvent('error', { detail: { data: detail } }));
};

TauriWebsocket.prototype._onClose = function() {
  if (this._closed) return;
  this._closed = true;
  for (var i = 0; i < this._unlisten.length; i++) {
    try { this._unlisten[i](); } catch (e) {}
  }
  this.dispatchEvent(new CustomEvent('close'));
};

TauriWebsocket.prototype.send = function(str) {
  if (this._closed) return;
  var bytes = new Array(str.length);
  for (var i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  this._invoke('ws_send', { data: bytes }).catch(function(err) {
    console.error('[tauri] ws_send failed:', err);
  });
};

TauriWebsocket.prototype.close = function() {
  if (this._closed) return;
  this._invoke('ws_disconnect').catch(function() {});
  // Match BrowserWebsocket: a manual close also unregisters listeners and fires
  // 'close'. _onClose is idempotent and removes the 4 Tauri event listeners
  // (otherwise they'd leak on every manual close).
  this._onClose();
};

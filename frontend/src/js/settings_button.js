// PttChrome v3 — floating gear button that opens the NATIVE settings dialog
// (the same PrefModal reachable from the right-click menu). Mounting PrefModal
// and setting app.modalShown=true hands keyboard focus to the modal, so its
// inputs work correctly (unlike the old standalone panel).

import React from 'react';
import ReactDOM from 'react-dom';
import PrefModal from '../components/ContextMenu/PrefModal';

export function setupSettingsButton(app) {
  var container = document.createElement('div');
  document.body.appendChild(container);

  var btn = document.createElement('button');
  btn.textContent = '⚙ 設定';
  btn.title = '設定（帳號 / 自動登入 / 黑名單 / 偏好）';
  var s = btn.style;
  s.position = 'fixed'; s.top = '6px'; s.right = '8px'; s.zIndex = '2147483646';
  s.font = '12px sans-serif'; s.padding = '3px 8px'; s.cursor = 'pointer';
  s.background = 'rgba(40,40,40,.78)'; s.color = '#eee';
  s.border = '1px solid #666'; s.borderRadius = '5px'; s.opacity = '0.55';
  btn.onmouseenter = function() { s.opacity = '1'; };
  btn.onmouseleave = function() { s.opacity = '0.55'; };
  document.body.appendChild(btn);

  // Mirrors onPrefSaveImpl in components/ContextMenu/index.js.
  function applyAndClose(values) {
    app.onValuesPrefChange(values);
    app.modalShown = false;
    app.setInputAreaFocus();
    app.switchToEasyReadingMode(app.view.useEasyReadingMode);
    // Unmounting runs CredentialManager.componentWillUnmount, which flushes the
    // account and (for a first-time auto-login setup) raises this flag.
    ReactDOM.unmountComponentAtNode(container);
    if (window.__macpttWantReconnect) {
      window.__macpttWantReconnect = false;
      if (app.connectState === 1 && app.reconnect) app.reconnect();
    }
  }

  function openSettings() {
    app.modalShown = true; // terminal stops grabbing keys while the modal is open
    ReactDOM.render(
      React.createElement(PrefModal, {
        show: true,
        onSave: applyAndClose,
        onReset: applyAndClose,
      }),
      container
    );
  }

  btn.onclick = openSettings;
  // Let other code (e.g. the first-run prompt) open Settings.
  app.openSettings = openSettings;
}

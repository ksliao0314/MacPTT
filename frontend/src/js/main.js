import { App } from './pttchrome';
import { setupI18n } from './i18n';
import { getQueryVariable } from './util';
import { readValuesWithDefault } from '../components/ContextMenu/PrefModal';
import { setupExternalOpen } from './external_open';
import { setupSettingsButton } from './settings_button';
import { setupNavHints } from './nav_hints';
import { setupNativeMenu } from './native_menu';
import { setupUpdater } from './updater';
import { setupFindBar } from './find_bar';
import { preload as preloadCredentials, hasSavedLogin } from './credentials';
import { maybePromptSavedLogin } from './login_prompt';
import { setupIcloudSync, pull as icloudPull } from './icloud_sync';

// Tint the UI (--mac-accent, used by the menu / settings / context menu) to the
// system accent color chosen in System Settings ▸ Appearance.
function syncSystemAccent() {
  if (typeof window === 'undefined' || !window.__TAURI__) return;
  window.__TAURI__.core.invoke('system_accent_color')
    .then(function(hex) {
      if (hex) document.documentElement.style.setProperty('--mac-accent', hex);
    })
    .catch(function() {});
}

function startApp() {
  setupI18n();
  setupExternalOpen();
  syncSystemAccent();
  // Re-read on focus so changing the system accent updates the UI live (without
  // needing a native NSColor observer).
  if (typeof window !== 'undefined' && window.__TAURI__) {
    window.addEventListener('focus', syncSystemAccent);
  }

  const app = new App();

  (process.env.DEVELOPER_MODE ? import('../components/DeveloperModeAlert')
    .then(({DeveloperModeAlert}) => new Promise((resolve, reject) => {
      const container = document.getElementById('reactAlert')
      const onDismiss = () => {
        ReactDOM.unmountComponentAtNode(container)
        resolve()
      }
      ReactDOM.render(
        <DeveloperModeAlert onDismiss={onDismiss} />,
        container
      )
    })) : Promise.resolve()
  ).then(() => {
    // Load the saved (locally-encrypted) password before connecting (auto-login).
    return preloadCredentials();
  }).then(() => {
    // Pull synced settings/blacklist from iCloud into localStorage BEFORE we read
    // prefs below (no-op unless the user enabled sync). Don't block startup if it
    // errors / is slow.
    return icloudPull(false).catch(() => {});
  }).then(() => {
    // connect.
    app.connect(
      process.env.ALLOW_SITE_IN_QUERY && getQueryVariable('site')
      || process.env.DEFAULT_SITE);
    // TODO: Call onSymFont for font data when it's implemented.
    console.log("load pref from storage");
    app.onValuesPrefChange(readValuesWithDefault());
    app.setInputAreaFocus();
    setupSettingsButton(app);
    setupNavHints(app);
    setupNativeMenu(app);
    setupUpdater();
    setupFindBar(app);
    setupIcloudSync(app);
    $('#BBSWindow').show();
    //$('#sideMenus').show();
    app.onWindowResize();
    // First run / no saved login: offer to set it up.
    if (!hasSavedLogin()) {
      maybePromptSavedLogin(app);
    }
  }).catch((e) => {
    console.error('startApp failed:', e);
  })
}

function loadTable(url) {
  return fetch(url).then(response => {
    if (!response.ok)
      throw new Error('loadTable failed: ' + response.statusText + ': ' + url);
    return response.arrayBuffer();
  });
}

function loadResources() {
  Promise.all([
    loadTable(require('../conv/b2u_table.bin')),
    loadTable(require('../conv/u2b_table.bin'))
  ]).then(function(binData) {
    window.lib = window.lib || {};
    window.lib.b2uArray = new Uint8Array(binData[0]);
    window.lib.u2bArray = new Uint8Array(binData[1]);
    $(document).ready(startApp);
  }, function(e) {
    console.log('loadResources failed: ' + e);
  });
}

loadResources();

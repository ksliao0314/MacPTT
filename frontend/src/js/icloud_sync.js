// MacPTT — iCloud Drive sync for settings + blacklist (NOT the password).
//
// Stores a single JSON in the user's iCloud Drive (handled natively in Rust,
// see icloud_status / icloud_write). macOS syncs that file across the user's
// Macs. Model:
//   - push: write the full local bundle (prefs + blacklist) with updated=now,
//           but first UNION in the cloud's blacklist so a push never drops
//           entries the other machine added.
//   - pull: if the cloud copy is newer, replace prefs (last-write-wins) and
//           UNION the blacklist (never lose a local add).
// Blacklist is therefore additive across machines (removals don't propagate);
// prefs are last-write-wins. Good enough for single-user, low-frequency data.

import { readValuesWithDefault } from '../components/ContextMenu/PrefModal';

const IS_TAURI = (typeof window !== 'undefined') && !!window.__TAURI__;
const PREF_KEY = 'pttchrome.pref.v1';
const BL_KEY = 'pttchrome.blacklist.v2';
const LASTPULL_KEY = 'pttchrome.icloud.lastpull';

function invoke(cmd, args) { return window.__TAURI__.core.invoke(cmd, args); }
function ls(key) { try { return JSON.parse(window.localStorage.getItem(key)); } catch (e) { return null; } }

export function isSyncEnabled() {
  var p = ls(PREF_KEY);
  return !!(p && p.values && p.values.icloudSync);
}

var _app = null;
var _pushTimer = null;

export function setupIcloudSync(app) {
  _app = app;
  // Let the (import-free) localStorage writers trigger a debounced push.
  window.__macpttIcloudPush = schedulePush;
  // Re-pull when the app regains focus, to pick up changes from another Mac.
  if (IS_TAURI) {
    window.addEventListener('focus', function() { pull(true); });
  }
}

function schedulePush() {
  if (!IS_TAURI || !isSyncEnabled()) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(pushNow, 1200);
}

// Merge a list of ids into the local blacklist (union, case-insensitive).
function unionLocalBlacklist(ids) {
  if (!ids || !ids.length) return;
  var local = ls(BL_KEY) || { ids: [], updated: 0 };
  var seen = {};
  var merged = [];
  (local.ids || []).concat(ids).forEach(function(id) {
    var k = String(id).toLowerCase();
    if (id && !seen[k]) { seen[k] = 1; merged.push(id); }
  });
  if (merged.length !== (local.ids || []).length) {
    window.localStorage.setItem(BL_KEY, JSON.stringify({ ids: merged, updated: Date.now() }));
  }
}

export function pushNow() {
  if (!IS_TAURI || !isSyncEnabled()) return Promise.resolve();
  // Fold the cloud's blacklist into local first so we never overwrite away an
  // entry another machine added.
  return invoke('icloud_status').then(function(st) {
    if (st && st.available && st.content) {
      try {
        var remote = JSON.parse(st.content);
        if (remote && remote.blacklist && remote.blacklist.ids) {
          unionLocalBlacklist(remote.blacklist.ids);
        }
      } catch (e) {}
    }
    var bundle = { v: 1, prefs: ls(PREF_KEY), blacklist: ls(BL_KEY), updated: Date.now() };
    return invoke('icloud_write', { content: JSON.stringify(bundle) }).then(function() {
      window.localStorage.setItem(LASTPULL_KEY, String(bundle.updated));
    });
  }).catch(function() {});
}

// Pull the cloud copy; if newer, apply it. liveApply re-applies to a running app.
export function pull(liveApply) {
  if (!IS_TAURI || !isSyncEnabled()) return Promise.resolve(false);
  return invoke('icloud_status').then(function(st) {
    if (!st || !st.available || !st.content) return false;
    var remote;
    try { remote = JSON.parse(st.content); } catch (e) { return false; }
    if (!remote || !remote.updated) return false;
    var lastpull = parseInt(window.localStorage.getItem(LASTPULL_KEY) || '0', 10);
    if (remote.updated <= lastpull) {
      // Even if not "newer", union the blacklist so adds from elsewhere arrive.
      if (remote.blacklist && remote.blacklist.ids) unionLocalBlacklist(remote.blacklist.ids);
      return false;
    }

    var changed = false;
    if (remote.prefs && remote.prefs.values) {
      // Don't let a remote copy flip THIS machine's sync toggle off.
      remote.prefs.values.icloudSync = isSyncEnabled();
      window.localStorage.setItem(PREF_KEY, JSON.stringify(remote.prefs));
      changed = true;
    }
    if (remote.blacklist && remote.blacklist.ids) {
      unionLocalBlacklist(remote.blacklist.ids);
      changed = true;
    }
    window.localStorage.setItem(LASTPULL_KEY, String(remote.updated));
    if (changed && liveApply && _app) applyLive();
    return changed;
  }).catch(function() { return false; });
}

function applyLive() {
  try {
    if (_app.onValuesPrefChange) _app.onValuesPrefChange(readValuesWithDefault());
    if (_app.connectState === 1 && _app.view && _app.view.redraw) _app.view.redraw(true);
  } catch (e) {}
}

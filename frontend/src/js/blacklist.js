// PttChrome v3 — blacklist store.
//
// Stored locally as { ids: [...insertion order...], updated: <ms> } under
// `pttchrome.blacklist.v2`. IDs are kept in the order they were added (newest
// last) so the UI can show the most-recently-added entries. Matching is
// case-insensitive.

const KEY = "pttchrome.blacklist.v2";
const OLD_PREF_KEY = "pttchrome.pref.v1";

export function parseBlacklistText(text) {
  return String(text || "")
    .split(/[\s,]+/)
    .map(function(x) { return x.trim(); })
    .filter(Boolean);
}

function readRaw() {
  try {
    var v = JSON.parse(window.localStorage.getItem(KEY));
    if (v && Array.isArray(v.ids)) return v;
  } catch (e) {}
  return null;
}

function writeRaw(data) {
  window.localStorage.setItem(KEY, JSON.stringify(data));
  // Mirror to iCloud (no-op unless sync is enabled); global avoids import cycle.
  if (typeof window !== "undefined" && window.__macpttIcloudPush) {
    window.__macpttIcloudPush();
  }
}

// One-time migration from the old prefs.blacklist text field.
function migrate() {
  try {
    var pref = JSON.parse(window.localStorage.getItem(OLD_PREF_KEY));
    var text = pref && pref.values && pref.values.blacklist;
    if (text) {
      var data = { ids: dedup(parseBlacklistText(text)), updated: Date.now() };
      writeRaw(data);
      // clear the old field so it doesn't migrate again
      pref.values.blacklist = "";
      window.localStorage.setItem(OLD_PREF_KEY, JSON.stringify(pref));
      return data;
    }
  } catch (e) {}
  return null;
}

function dedup(ids) {
  var seen = {};
  var out = [];
  ids.forEach(function(id) {
    var k = id.toLowerCase();
    if (id && !seen[k]) {
      seen[k] = 1;
      out.push(id);
    }
  });
  return out;
}

export function getData() {
  return readRaw() || migrate() || { ids: [], updated: 0 };
}

export function getCount() {
  return getData().ids.length;
}

export function getUpdated() {
  return getData().updated;
}

// Most-recently-added first.
export function getRecent(n) {
  var ids = getData().ids;
  return ids.slice(Math.max(0, ids.length - (n || 20))).reverse();
}

export function search(query) {
  var q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  return getData().ids.filter(function(id) {
    return id.toLowerCase().indexOf(q) >= 0;
  });
}

// Add one id or a list. Returns the number actually added.
export function add(idOrList) {
  var list = Array.isArray(idOrList) ? idOrList : parseBlacklistText(idOrList);
  if (!list.length) return 0;
  var data = getData();
  var seen = {};
  data.ids.forEach(function(id) { seen[id.toLowerCase()] = 1; });
  var added = 0;
  list.forEach(function(id) {
    id = String(id).trim();
    var k = id.toLowerCase();
    if (id && !seen[k]) {
      seen[k] = 1;
      data.ids.push(id);
      added++;
    }
  });
  if (added) {
    data.updated = Date.now();
    writeRaw(data);
  }
  return added;
}

export function remove(id) {
  var k = String(id).toLowerCase();
  var data = getData();
  var before = data.ids.length;
  data.ids = data.ids.filter(function(x) { return x.toLowerCase() !== k; });
  if (data.ids.length !== before) {
    data.updated = Date.now();
    writeRaw(data);
    return true;
  }
  return false;
}

export function exportText() {
  return getData().ids.join("\n");
}

// Cheap memoized lookup that refreshes when the store changes.
var _raw = null;
var _set = null;
export function isBlacklisted(userId) {
  if (!userId) return false;
  var cur = window.localStorage.getItem(KEY);
  if (cur !== _raw) {
    _raw = cur;
    _set = {};
    getData().ids.forEach(function(id) { _set[id.toLowerCase()] = 1; });
  }
  return !!_set[String(userId).toLowerCase()];
}

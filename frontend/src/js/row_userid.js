// PttChrome v3 — detect the author user id of a rendered row (article list /
// push line), ported from the original PttChrome blacklist feature. Used to
// fade blacklisted authors and to drive the right-click "add to blacklist".

import { b2u } from './string_util';

// Reconstruct a row's Unicode text from its char array (handles Big5 DBCS),
// mirroring TermBuf.getRowText.
export function rowCharsToText(chars) {
  if (!chars) return '';
  var out = '';
  for (var col = 0; col < chars.length; col++) {
    var c = chars[col];
    if (!c || c.isLeadByte) continue; // lead byte handled at its trail byte
    if (col >= 1 && chars[col - 1] && chars[col - 1].isLeadByte) {
      var b5 = chars[col - 1].ch + c.ch;
      out += b5.length === 1 ? b5 : b2u(b5);
    } else {
      out += c.ch;
    }
  }
  return out;
}

// Article-list row (pageState 2): "<num> <flag> <date> <userid> <title-mark>".
const THREAD_RE = /(?:(?:\d+)|(?:  ★ )) [+mMsSD*!=~ ](?:(?:[X\d ]{2})|(?:爆))[\d ]\d\/\d{2} (\w+) +[□轉R]:?/;
// Push line (pageState 3): "推/噓/→ <userid>: ... MM/DD HH:MM".
const PUSH_RE = /[→推噓] (\w+) *:.+ \d{2}\/\d{2} \d{2}:\d{2}/;

// Returns the lower-cased author id of the row, or null.
export function parseRowUserId(text) {
  if (!text) return null;
  var m = PUSH_RE.exec(text);
  if (m) return m[1].toLowerCase();
  m = THREAD_RE.exec(text);
  if (m) return m[1].toLowerCase();
  return null;
}

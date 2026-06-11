import LinkSegmentBuilder from "./LinkSegmentBuilder";
import { rowCharsToText, parseRowUserId } from "../../js/row_userid";
import { isBlacklisted } from "../../js/blacklist";

// A compact, COMPLETE signature of everything in a row that affects how it
// renders. The terminal mutates TermChar cells in place (same array refs every
// frame), so reference equality can't tell changed rows from unchanged ones —
// React.memo below compares this signature instead, letting an unchanged row
// (the common case: only the status-line clock ticked) skip rebuilding its whole
// segment tree and reconciling. Over-inclusive on purpose: extra fields only
// cause a harmless re-render, a missed field would cause a stale row.
export function rowSig(chars) {
  const parts = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    parts.push(
      c.ch,
      c.fg,
      c.bg,
      (c.bright ? 1 : 0) |
        (c.blink ? 2 : 0) |
        (c.underLine ? 4 : 0) |
        (c.invert ? 8 : 0) |
        (c.isLeadByte ? 16 : 0),
      c.partOfURL
        ? "u" + (c.startOfURL ? "s" : "") + (c.endOfURL ? "e" : "") + (c.fullurl || "")
        : "",
      c.partOfKeyWord ? "k" + (c.keyWordColor || "") : ""
    );
  }
  return parts.join("");
}

export const Row = ({
  chars,
  row,
  enableLinkInlinePreview,
  forceWidth,
  highlighted,
  onHyperLinkMouseOver,
  onHyperLinkMouseOut
}) => {
  // Detect the row's author so blacklisted authors can be faded, and so a
  // right-click can read the user id from the `blu_<userid>` class.
  let userid = null;
  let faded = false;
  try {
    userid = parseRowUserId(rowCharsToText(chars));
    if (userid) faded = isBlacklisted(userid);
  } catch (e) {}

  return (
    <span
      type="bbsrow"
      srow={row}
      className={userid ? "blu_" + userid : undefined}
      style={faded ? { opacity: 0.2 } : undefined}
    >
      {chars
        .reduce(
          LinkSegmentBuilder.accumulator,
          new LinkSegmentBuilder(
            row,
            enableLinkInlinePreview,
            forceWidth,
            highlighted,
            onHyperLinkMouseOver,
            onHyperLinkMouseOut
          )
        )
        .build()}
    </span>
  );
};

// Re-render a row only when its content signature, highlight, or the stable
// per-screen props actually change. (`sig` is supplied by Screen; the hyperlink
// callbacks are stable class methods, so comparing by reference is correct.)
function rowPropsEqual(prev, next) {
  // No signature (e.g. the deprecated easy-reading renderRowHtml path) → never
  // memoize; always re-render to preserve the old behaviour.
  if (prev.sig === undefined || next.sig === undefined) return false;
  return (
    prev.sig === next.sig &&
    prev.highlighted === next.highlighted &&
    prev.row === next.row &&
    prev.enableLinkInlinePreview === next.enableLinkInlinePreview &&
    prev.forceWidth === next.forceWidth &&
    prev.onHyperLinkMouseOver === next.onHyperLinkMouseOver &&
    prev.onHyperLinkMouseOut === next.onHyperLinkMouseOut
  );
}

export default React.memo(Row, rowPropsEqual);

import LinkSegmentBuilder from "./LinkSegmentBuilder";
import { rowCharsToText, parseRowUserId } from "../../js/row_userid";
import { isBlacklisted } from "../../js/blacklist";

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

export default Row;

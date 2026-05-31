import cx from "classnames";
import React from "react";
import { compose, lifecycle, withHandlers } from "recompose";
import { MenuItem } from "react-bootstrap";
import { i18n } from "../../js/i18n";
import { isBlacklisted } from "../../js/blacklist";
import "./DropdownMenu.css";

const top = (mouseHeight, menuHeight) => {
  const pageHeight = window.innerHeight;

  // opening menu would pass the bottom of the page
  if (mouseHeight + menuHeight > pageHeight && menuHeight < mouseHeight) {
    return mouseHeight - menuHeight;
  }
  return mouseHeight;
};

const left = (mouseWidth, menuWidth) => {
  const pageWidth = window.innerWidth;

  // opening menu would pass the side of the page
  if (mouseWidth + menuWidth > pageWidth && menuWidth < mouseWidth) {
    return mouseWidth - menuWidth;
  }
  return mouseWidth;
};

const normalizeSelectedText = selectedText => {
  if (selectedText.length > 15) {
    return `${selectedText.substr(0, 15)} …`;
  }
  return selectedText;
};

const QUICK_SEARCH = {
  providers: [
    {
      name: "goo.gl",
      url: "https://goo.gl/%s"
    }
  ]
};

const enhance = compose(
  withHandlers(() => {
    const refs = {};

    return {
      onDropdownMenuMount: () => ref => {
        refs.dropdownMenu = ref;
      },
      onMousePositionChange: ({ pageX, pageY }) => () => {
        // Set the properties directly — the old `cssText +=` appended a new
        // top/left pair on every right-click, ballooning the inline style.
        refs.dropdownMenu.style.top =
          top(pageY, refs.dropdownMenu.clientHeight) + "px";
        refs.dropdownMenu.style.left =
          left(pageX, refs.dropdownMenu.clientWidth) + "px";
      },
      onContextMenu: () => event => {
        event.stopPropagation();
        event.preventDefault();
      }
    };
  }),
  lifecycle({
    componentDidMount() {
      this.props.onMousePositionChange();
    },
    componentDidUpdate(prevProps) {
      if (
        this.props.pageX !== prevProps.pageX ||
        this.props.pageY !== prevProps.pageY
      ) {
        this.props.onMousePositionChange();
      }
    }
  })
);

export const DropdownMenu = ({
  pageX,
  pageY,
  urlEnabled,
  normalEnabled,
  selEnabled,
  mouseBrowsingEnabled,
  selectedText,
  contextUserId,
  onMenuSelect,
  onInputHelperClick,
  onLiveArticleHelperClick,
  onSettingsClick,
  onQuickSearchSelect,
  //
  onDropdownMenuMount,
  onContextMenu
}) => (
  <ul
    className="dropdown-menu DropdownMenu--reset"
    ref={onDropdownMenuMount}
    onContextMenu={onContextMenu}
  >
    {selEnabled && (
      <React.Fragment>
        <MenuItem eventKey="copy" onSelect={onMenuSelect}>
          {i18n("cmenu_copy")}
          <span className="DropdownMenu__Item__HotKey">⌘C</span>
        </MenuItem>
        <MenuItem eventKey="copyAnsi" onSelect={onMenuSelect}>
          {i18n("cmenu_copyAnsi")}
        </MenuItem>
      </React.Fragment>
    )}
    {selEnabled && contextUserId && <MenuItem divider />}
    {contextUserId && (
      isBlacklisted(contextUserId) ? (
        <MenuItem eventKey="removeBlacklistUser" onSelect={onMenuSelect}>
          將 {contextUserId} 移出黑名單
        </MenuItem>
      ) : (
        <MenuItem eventKey="addBlacklistUser" onSelect={onMenuSelect}>
          將 {contextUserId} 加入黑名單
        </MenuItem>
      )
    )}
  </ul>
);

export default enhance(DropdownMenu);

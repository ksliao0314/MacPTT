const noop = () => {};

// Hide images that fail to load (dead links, blocked mixed content) instead of
// showing the browser's broken-image placeholder.
const hideOnError = e => {
  if (e && e.target) e.target.style.display = "none";
};

import { ShareGlyph } from "./icons";

const IS_TAURI = typeof window !== "undefined" && !!window.__TAURI__;

const imgInvoke = (cmd, src) => {
  if (!IS_TAURI) return Promise.reject(new Error("not tauri"));
  return window.__TAURI__.core.invoke(cmd, { url: src });
};

// Save / share buttons shown over a loaded image (Tauri only). They act on the
// downloaded image file (fetched natively in Rust), not the link.
const ImageActions = ({ src }) => {
  const stop = e => {
    e.preventDefault();
    e.stopPropagation();
  };
  const btnStyle = {
    font: "12px sans-serif",
    lineHeight: "1",
    padding: "4px 7px",
    cursor: "pointer",
    color: "#fff",
    background: "rgba(0,0,0,.6)",
    border: "1px solid rgba(255,255,255,.4)",
    borderRadius: "4px"
  };
  const onSave = e => {
    stop(e);
    toast("儲存中…");
    imgInvoke("save_image", src)
      .then(() => toast("已儲存到下載資料夾 ✓"))
      .catch(() => toast("儲存失敗"));
  };
  const onShare = e => {
    stop(e);
    imgInvoke("share_image", src).catch(() => toast("分享失敗"));
  };
  return (
    <span
      className="imgActions"
      style={{
        position: "absolute",
        top: "4px",
        left: "4px",
        display: "flex",
        gap: "4px",
        opacity: 0.35,
        transition: "opacity .15s",
        zIndex: 3
      }}
      onMouseOver={e => (e.currentTarget.style.opacity = 1)}
      onMouseOut={e => (e.currentTarget.style.opacity = 0.35)}
      onMouseDown={stop}
    >
      <button type="button" style={btnStyle} title="儲存到下載資料夾" onClick={onSave}>
        ⬇ 儲存
      </button>
      <button type="button" style={btnStyle} title="分享圖片" onClick={onShare}>
        <ShareGlyph /> 分享
      </button>
    </span>
  );
};

let _toastEl = null;
let _toastTimer = null;
function toast(text) {
  if (typeof document === "undefined") return;
  if (!_toastEl) {
    _toastEl = document.createElement("div");
    const s = _toastEl.style;
    s.position = "fixed";
    s.left = "50%";
    s.bottom = "44px";
    s.transform = "translateX(-50%)";
    s.zIndex = "2147483647";
    s.background = "rgba(0,0,0,.85)";
    s.color = "#fff";
    s.font = "14px sans-serif";
    s.padding = "10px 16px";
    s.borderRadius = "8px";
    s.pointerEvents = "none";
    s.boxShadow = "0 4px 16px rgba(0,0,0,.4)";
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = text;
  _toastEl.style.display = "block";
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    if (_toastEl) _toastEl.style.display = "none";
  }, 1800);
}

export const of = src => Promise.resolve({ src });

export const resolveSrcToImageUrl = ({ src }) =>
  imageUrlResolvers.find(r => r.test(src)).request(src);

export const resolveWithImageDOM = ({ src }) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        src,
        height: img.height
      });
    img.onerror = reject;
    img.src = src;
  });

export class ImagePreviewer extends React.PureComponent {
  state = {
    pending: undefined,
    value: undefined,
    error: undefined
  };

  componentDidMount() {
    this.handleStart();
  }

  componentDidUpdate(prevProps) {
    if (this.props.request !== prevProps.request) {
      this.handleStart();
    }
  }

  handleStart(props) {
    this.setState((state, { request }) => {
      request.then(this.handleResolve, this.handleReject);
      return {
        pending: request,
        value: undefined,
        error: undefined
      };
    });
  }

  handleResolve = value => {
    this.setState(({ pending }, { request }) => {
      if (pending !== request) {
        return;
      }
      return { value };
    });
  };

  handleReject = error => {
    this.setState(({ pending }, { request }) => {
      if (pending !== request) {
        return;
      }
      return { error };
    });
  };

  render() {
    return React.createElement(this.props.component, {
      ...this.props,
      component: undefined,
      request: undefined,
      value: this.state.value,
      error: this.state.error
    });
  }
}

const getTop = (top, height) => {
  const pageHeight = $(window).height();

  // opening image would pass the bottom of the page
  if (top + height / 2 > pageHeight - 20) {
    if (height / 2 < top) {
      return pageHeight - 20 - height;
    }
  } else if (top - 20 > height / 2) {
    return top - height / 2;
  }
  return 20;
};

ImagePreviewer.OnHover = ({ left, top, value, error }) => {
  if (error) {
    return false;
  } else if (value) {
    return (
      <img
        src={value.src}
        onError={hideOnError}
        style={{
          display: "block",
          position: "absolute",
          left: left + 20,
          top: getTop(top, value.height),
          maxHeight: "80%",
          maxWidth: "90%",
          zIndex: 2
        }}
      />
    );
  } else {
    return (
      <i
        className="glyphicon glyphicon-refresh glyphicon-refresh-animate"
        style={{
          position: "absolute",
          left: left + 20,
          top: top,
          zIndex: 2
        }}
      />
    );
  }
};

// Loads its <img> only when scrolled near the viewport, so a long article
// doesn't fetch every image up front — each one loads as you approach it.
class LazyImg extends React.Component {
  constructor(props) {
    super(props);
    this.state = { visible: false };
    this.ref = React.createRef();
  }
  componentDidMount() {
    this._mounted = true;
    if (typeof IntersectionObserver === "undefined") {
      this.setState({ visible: true });
      return;
    }
    this.io = new IntersectionObserver(
      entries => {
        if (this._mounted && entries.some(e => e.isIntersecting)) {
          this.setState({ visible: true });
          this._stop();
        }
      },
      { rootMargin: "600px 0px" } // start loading ~600px before it enters view
    );
    if (this.ref.current) this.io.observe(this.ref.current);
    // Fallback: inside the terminal's CSS transform the observer's intersection
    // geometry is unreliable and may never fire, leaving the image hidden. Reveal
    // shortly after mount so inline images always appear (the observer still
    // handles the immediate on-screen case faster).
    this._reveal = setTimeout(() => {
      if (this._mounted) this.setState({ visible: true });
      this._stop();
    }, 350);
  }
  componentWillUnmount() {
    this._mounted = false;
    this._stop();
    if (this._reveal) clearTimeout(this._reveal);
  }
  _stop() {
    if (this.io) {
      this.io.disconnect();
      this.io = null;
    }
  }
  render() {
    return (
      <span
        ref={this.ref}
        className="lazyImgWrap"
        style={{ display: "inline-block", minWidth: "1px", minHeight: "1px" }}
      >
        {this.state.visible ? (
          <span style={{ position: "relative", display: "inline-block" }}>
            <img
              className={this.props.className}
              src={this.props.src}
              onError={e => {
                // Hide the whole box (image + action buttons) on failure.
                if (e.target.parentElement)
                  e.target.parentElement.style.display = "none";
              }}
            />
            {IS_TAURI ? <ImageActions src={this.props.src} /> : null}
          </span>
        ) : null}
      </span>
    );
  }
}

ImagePreviewer.Inline = ({ value, error }) => {
  if (error) {
    return false;
  } else if (value) {
    return <LazyImg className="easyReadingImg hyperLinkPreview" src={value.src} />;
  } else {
    return (
      <i className="glyphicon glyphicon-refresh glyphicon-refresh-animate" />
    );
  }
};

const IMAGE_URL_REGEX = /\.(jpe?g|png|gif|webp|bmp)(?:[?#]|$)/i;

const imageUrlResolvers = [
  {
    /*
     * Generic: any link that ends in a known image extension. Upgrade http ->
     * https because the webview is a secure context that blocks mixed content.
     */
    test(src) {
      return IMAGE_URL_REGEX.test(src);
    },
    request(src) {
      return Promise.resolve({ src: src.replace(/^http:\/\//i, "https://") });
    }
  },
  {
    /*
     * Default: not a recognized image link -> no preview.
     */
    test() {
      return true;
    },
    request() {
      return Promise.reject(new Error("Unimplemented"));
    }
  }
];

const registerImageUrlResolver = imageUrlResolvers.unshift.bind(
  imageUrlResolvers
);

registerImageUrlResolver({
  /*
   * imgur.com
   */
  regex: /^https?:\/\/(?:i\.)?imgur\.com\/([^.]+)(?:\.(.*))?/,
  test(src) {
    return this.regex.test(src);
  },
  request(src) {
    const [_, photoId, extension = "jpg"] = this.regex.exec(src);
    return Promise.resolve({
      src: `https://i.imgur.com/${photoId}.${extension}`
    });
  }
});

export default ImagePreviewer;

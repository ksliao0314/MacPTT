// PttChrome v3 — link (URL) previews and article-URL sharing.
//
// For non-image URLs we fetch Open Graph metadata natively (Rust, no CORS) and
// render a small preview card, lazily (only when scrolled near, like images).
// The article's own URL gets a share icon instead of a preview. Tauri only.

import { ShareGlyph } from "./icons";

const IS_TAURI = typeof window !== "undefined" && !!window.__TAURI__;

function invoke(cmd, args) {
  return window.__TAURI__.core.invoke(cmd, args);
}

const hideOnError = e => {
  if (e && e.target) e.target.style.display = "none";
};

// Renders children only once it has scrolled near the viewport.
class LazyMount extends React.Component {
  constructor(props) {
    super(props);
    this.state = { visible: false };
    this.ref = React.createRef();
  }
  componentDidMount() {
    if (typeof IntersectionObserver === "undefined") {
      this.setState({ visible: true });
      return;
    }
    this.io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          this.setState({ visible: true });
          this._stop();
        }
      },
      { rootMargin: "600px 0px" }
    );
    if (this.ref.current) this.io.observe(this.ref.current);
  }
  componentWillUnmount() {
    this._stop();
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
        style={{ display: "block", minWidth: "1px", minHeight: "1px" }}
      >
        {this.state.visible ? this.props.children : null}
      </span>
    );
  }
}

class LinkCard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { data: null };
  }
  componentDidMount() {
    invoke("fetch_link_preview", { url: this.props.url })
      .then(d => {
        if (d && (d.title || d.image)) this.setState({ data: d });
      })
      .catch(() => {});
  }
  render() {
    var d = this.state.data;
    if (!d) return null; // nothing while loading / on failure
    return (
      <a
        href={this.props.url}
        target="_blank"
        rel="noreferrer"
        className="linkPreviewCard"
        style={{
          display: "flex",
          alignItems: "stretch",
          maxWidth: "560px",
          margin: "2px 0 6px",
          border: "1px solid #444",
          borderRadius: "8px",
          overflow: "hidden",
          background: "#1d1d1d",
          textDecoration: "none",
          color: "#ddd",
          fontFamily: "sans-serif"
        }}
      >
        {d.image && /^https:\/\//i.test(d.image) ? (
          <img
            src={d.image}
            onError={hideOnError}
            style={{
              width: "120px",
              objectFit: "cover",
              flex: "0 0 auto",
              background: "#000"
            }}
          />
        ) : null}
        <span style={{ padding: "8px 10px", overflow: "hidden", minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontWeight: "bold",
              fontSize: "13px",
              color: "#eee",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {d.title || d.site}
          </span>
          {d.description ? (
            <span
              style={{
                display: "block",
                fontSize: "12px",
                color: "#aaa",
                margin: "3px 0",
                maxHeight: "2.6em",
                overflow: "hidden"
              }}
            >
              {d.description}
            </span>
          ) : null}
          <span style={{ display: "block", fontSize: "11px", color: "#888" }}>
            {d.site}
          </span>
        </span>
      </a>
    );
  }
}

export function LinkPreview({ url }) {
  if (!IS_TAURI) return null;
  return (
    <LazyMount>
      <LinkCard url={url} />
    </LazyMount>
  );
}

// --- YouTube --------------------------------------------------------------
// Scraping YouTube's OG tags is unreliable (consent interstitials / blocking),
// so we recognise the URL, derive the video id, and show its predictable
// thumbnail with a play overlay. Clicking opens the video (system browser).
export function getYouTubeId(url) {
  // Verify the actual HOST is YouTube first (so notyoutube.com, fakeyoutu.be, or
  // a youtu.be link buried in another site's query string don't match), then
  // pull the 11-char id from the path/query.
  var hm = String(url).match(/^https?:\/\/([^/?#]+)/i);
  if (!hm) return null;
  var host = hm[1].toLowerCase().replace(/:\d+$/, "");
  var isYT =
    /(^|\.)youtube\.com$/.test(host) ||
    /(^|\.)youtu\.be$/.test(host) ||
    /(^|\.)youtube-nocookie\.com$/.test(host);
  if (!isYT) return null;
  var m = url.match(
    /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/v\/|\/live\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

class YouTubeCard extends React.Component {
  render() {
    var id = this.props.videoId;
    var thumb = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
    return (
      <a
        href={this.props.url}
        target="_blank"
        rel="noreferrer"
        className="ytPreviewCard"
        title="在瀏覽器開啟 YouTube 影片"
        style={{
          position: "relative",
          display: "inline-block",
          width: "100%",
          maxWidth: "480px",
          margin: "2px 0 6px",
          borderRadius: "8px",
          overflow: "hidden",
          background: "#000",
          lineHeight: 0
        }}
      >
        <img
          src={thumb}
          onError={hideOnError}
          style={{ display: "block", width: "100%", maxWidth: "480px" }}
        />
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "62px",
            height: "44px",
            background: "rgba(255,0,0,0.92)",
            borderRadius: "12px",
            boxShadow: "0 1px 6px rgba(0,0,0,.4)"
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </a>
    );
  }
}

export function YouTubePreview({ url }) {
  var id = getYouTubeId(url);
  if (!id) return null;
  return (
    <LazyMount>
      <YouTubeCard url={url} videoId={id} />
    </LazyMount>
  );
}

export function ShareUrlIcon({ url }) {
  if (!IS_TAURI) return null;
  var onClick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    invoke("share_text", { text: url }).catch(function() {});
  };
  return (
    <span
      onMouseDown={function(e) { e.preventDefault(); e.stopPropagation(); }}
      onClick={onClick}
      onMouseOver={function(e) { e.currentTarget.style.opacity = "1"; }}
      onMouseOut={function(e) { e.currentTarget.style.opacity = "0.45"; }}
      title="分享此文章網址"
      style={{
        display: "inline-block",
        marginLeft: "8px",
        cursor: "pointer",
        font: "12px sans-serif",
        lineHeight: "1",
        padding: "3px 8px",
        color: "#fff",
        background: "rgba(0,0,0,.6)",
        border: "1px solid rgba(255,255,255,.4)",
        borderRadius: "4px",
        opacity: "0.45",
        userSelect: "none",
        verticalAlign: "middle"
      }}
    >
      <ShareGlyph /> 分享
    </span>
  );
}

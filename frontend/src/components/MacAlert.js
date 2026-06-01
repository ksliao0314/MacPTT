import React from "react";
import "./MacAlert.css";

// Shared macOS-HIG top banner card. Presentational only.
// Props: variant ('danger'|'warning'|'info'), icon (node), title, text,
// primaryLabel, onPrimary, kbd (optional keycap string), onClose (optional ✕).
export const MacAlert = ({
  variant = "info",
  icon,
  title,
  text,
  primaryLabel,
  onPrimary,
  kbd,
  onClose,
  ariaLabel
}) => (
  <div className="macAlert">
    <div className="macAlert__card" role="alertdialog" aria-label={ariaLabel || title}>
      {icon && (
        <div className={"macAlert__icon macAlert__icon--" + variant}>{icon}</div>
      )}
      <div className="macAlert__body">
        <div className="macAlert__title">{title}</div>
        {text && <div className="macAlert__text">{text}</div>}
        {primaryLabel && (
          <div className="macAlert__actions">
            <button
              type="button"
              className="macBtn macBtn--primary"
              onClick={onPrimary}
              autoFocus
            >
              {primaryLabel}
              {kbd && <span className="macAlert__kbd">{kbd}</span>}
            </button>
          </div>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          className="macAlert__close"
          onClick={onClose}
          aria-label="關閉"
          title="關閉"
        >
          ✕
        </button>
      )}
    </div>
  </div>
);

// --- Shared glyphs (use currentColor; the icon badge sets the colour) ---

export const DisconnectGlyph = () => (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.55a10 10 0 0 1 14 0" />
    <path d="M8.5 16.05a5 5 0 0 1 7 0" />
    <line x1="12" y1="20" x2="12" y2="20" />
    <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
  </svg>
);

export const WarningGlyph = () => (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3.4 22 20.2H2z" />
    <line x1="12" y1="10" x2="12" y2="14" />
    <line x1="12" y1="17.3" x2="12" y2="17.3" />
  </svg>
);

export const InfoGlyph = () => (
  <svg
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9.2" />
    <line x1="12" y1="11" x2="12" y2="16.5" />
    <line x1="12" y1="7.6" x2="12" y2="7.6" />
  </svg>
);

export default MacAlert;

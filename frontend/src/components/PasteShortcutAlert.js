import React from "react";
import { MacAlert, InfoGlyph } from "./MacAlert";

export const PasteShortcutAlert = ({ onDismiss }) => (
  <MacAlert
    variant="info"
    icon={<InfoGlyph />}
    title="貼上"
    text="請使用 Shift+Insert 快速鍵來貼上。"
    primaryLabel="確定"
    onPrimary={onDismiss}
    onClose={onDismiss}
    ariaLabel="貼上"
  />
);

export default PasteShortcutAlert;

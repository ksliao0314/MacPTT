import React from "react";
import { MacAlert, WarningGlyph } from "./MacAlert";

export const DeveloperModeAlert = ({ onDismiss }) => (
  <MacAlert
    variant="warning"
    icon={<WarningGlyph />}
    title="開發者模式"
    text="您正在使用開發者模式，部分功能可能不穩定，無法保證一切正常運作。"
    primaryLabel="我瞭解了"
    onPrimary={onDismiss}
    onClose={onDismiss}
    ariaLabel="開發者模式"
  />
);

export default DeveloperModeAlert;

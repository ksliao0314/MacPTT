import React from "react";
import { compose, lifecycle } from "recompose";
import { MacAlert, DisconnectGlyph } from "./MacAlert";

const enhance = compose(
  lifecycle({
    componentDidMount() {
      // While the prompt is up, swallow ALL keys so nothing leaks to the (now
      // dead) terminal; Enter triggers the reconnect.
      this.handler = e => {
        if (e.keyCode === 13) {
          this.props.onDismiss();
        }
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      window.addEventListener("keydown", this.handler, true);
    },
    componentWillUnmount() {
      window.removeEventListener("keydown", this.handler, true);
    }
  })
);

export const ConnectionAlert = ({ onDismiss, onClose }) => (
  <MacAlert
    variant="danger"
    icon={<DisconnectGlyph />}
    title="連線已中斷"
    text="與 PTT 的連線已斷開，要重新連線嗎？"
    primaryLabel="重新連線"
    kbd="⏎"
    onPrimary={onDismiss}
    onClose={onClose || onDismiss}
    ariaLabel="連線已中斷"
  />
);

export default enhance(ConnectionAlert);

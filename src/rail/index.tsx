import { PanelLeft } from "lucide";
import { render } from "preact";

import type { Extension } from "../extension.ts";
import { Rail } from "./Rail.tsx";
import { RailSettings } from "./RailSettings.tsx";
import styles from "./rail.css";

export const rail: Extension = {
  name: "rail",
  title: "Project rail",
  description: "Discord-style project rail on the left edge",
  icon: PanelLeft,
  styles,
  Settings: RailSettings,
  mount: () => {
    const host = document.createElement("div");
    host.id = "t3rail-root";
    document.body.prepend(host);
    document.documentElement.dataset.t3rail = "";
    render(<Rail />, host);
    return () => {
      render(null, host);
      host.remove();
      delete document.documentElement.dataset.t3rail;
    };
  },
};

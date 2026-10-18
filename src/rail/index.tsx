import { render } from "preact";

import type { Extension } from "../extension.ts";
import { Rail } from "./Rail.tsx";
import styles from "./rail.css";

export const rail: Extension = {
  name: "rail",
  styles,
  mount: () => {
    const host = document.createElement("div");
    host.id = "t3rail-root";
    document.body.prepend(host);
    document.documentElement.dataset.t3rail = "";
    render(<Rail />, host);
  },
};

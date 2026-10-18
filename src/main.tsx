import { render } from "preact";

import { connect } from "./connection.ts";
import { Rail } from "./Rail.tsx";
import styles from "./rail.css";
import { mountUsageBar } from "./usage/UsageBar.tsx";
import usageStyles from "./usage/usage.css";

const style = document.createElement("style");
style.id = "t3rail-styles";
style.textContent = styles + usageStyles;
document.head.append(style);

const host = document.createElement("div");
host.id = "t3rail-root";
document.body.prepend(host);
document.documentElement.dataset.t3rail = "";

render(<Rail />, host);
mountUsageBar();
connect();
console.info("[rail] loaded");

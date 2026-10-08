import { render } from "preact";

import { connect } from "./connection.ts";
import { Rail } from "./Rail.tsx";
import styles from "./rail.css";

const style = document.createElement("style");
style.id = "t3rail-styles";
style.textContent = styles;
document.head.append(style);

const host = document.createElement("div");
host.id = "t3rail-root";
document.body.prepend(host);
document.documentElement.dataset.t3rail = "";

render(<Rail />, host);
connect();
console.info("[rail] loaded");

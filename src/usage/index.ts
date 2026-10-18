import { onSession } from "../connection.ts";
import type { Extension } from "../extension.ts";
import { usageSession } from "./session.ts";
import { mountUsageBar } from "./UsageBar.tsx";
import styles from "./usage.css";

export const usage: Extension = {
  name: "usage",
  styles,
  mount: () => {
    mountUsageBar();
    onSession(usageSession);
  },
};

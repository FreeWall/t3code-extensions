import { Gauge } from "lucide";

import { onSession } from "../connection.ts";
import type { Extension } from "../extension.ts";
import { usageSession } from "./session.ts";
import { mountUsageBar } from "./UsageBar.tsx";
import { UsageSettings } from "./UsageSettings.tsx";
import styles from "./usage.css";

export const usage: Extension = {
  name: "usage",
  title: "Usage bar",
  description: "Provider usage limits in the thread header",
  icon: Gauge,
  styles,
  Settings: UsageSettings,
  mount: () => {
    const unmountBar = mountUsageBar();
    const stopSession = onSession(usageSession);
    return () => {
      stopSession();
      unmountBar();
    };
  },
};

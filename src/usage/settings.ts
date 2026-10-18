import { strings } from "../json.ts";
import { settingsSection } from "../settings.ts";

export interface UsageSettings {
  /** Provider instance ids in the order dragged on the header usage bar. */
  readonly order: ReadonlyArray<string>;
}

export const usageSettings = settingsSection(
  "usage",
  (raw): UsageSettings => ({ order: strings(raw.order) }),
);

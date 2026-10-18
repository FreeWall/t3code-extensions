import { strings } from "../json.ts";
import { settingsSection } from "../settings.ts";

export interface RailSettings {
  /** "app" follows the sidebar's own project order instead of `projectOrder`. */
  readonly projectSort: "manual" | "app";
  /** Project ids in the order dragged on the rail. */
  readonly projectOrder: ReadonlyArray<string>;
  /** Project ids left off the rail; the app's own project picker still lists them. */
  readonly hiddenProjects: ReadonlyArray<string>;
}

export const railSettings = settingsSection(
  "rail",
  (raw): RailSettings => ({
    projectSort: raw.projectSort === "app" ? "app" : "manual",
    projectOrder: strings(raw.projectOrder),
    hiddenProjects: strings(raw.hiddenProjects),
  }),
);

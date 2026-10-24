import { strings } from "../json.ts";
import { settingsSection } from "../settings.ts";

export type HexColor = `#${string}`;

export const isHexColor = (value: unknown): value is HexColor =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export interface RailSettings {
  /** "app" follows the sidebar's own project order instead of `projectOrder`. */
  readonly projectSort: "manual" | "app";
  /** Project ids in the order dragged on the rail. */
  readonly projectOrder: ReadonlyArray<string>;
  /** Project ids left off the rail; the app's own project picker still lists them. */
  readonly hiddenProjects: ReadonlyArray<string>;
  /** Overrides the theme-derived rail background; null follows the theme. */
  readonly background: HexColor | null;
  /** Overrides the active project indicator's `--primary`; null follows the theme. */
  readonly pillBackground: HexColor | null;
}

export const railSettings = settingsSection(
  "rail",
  (raw): RailSettings => ({
    projectSort: raw.projectSort === "app" ? "app" : "manual",
    projectOrder: strings(raw.projectOrder),
    hiddenProjects: strings(raw.hiddenProjects),
    background: isHexColor(raw.background) ? raw.background : null,
    pillBackground: isHexColor(raw.pillBackground) ? raw.pillBackground : null,
  }),
);

import { strings } from "../json.ts";
import { settingsSection } from "../settings.ts";

/** What each chip shows beside the provider icon. */
export type UsageChipStyle = "bars" | "percent" | "barsAndPercent";

export const REFRESH_MINUTES = [6, 15, 30, 0] as const;
export type RefreshMinutes = (typeof REFRESH_MINUTES)[number];

const isRefreshMinutes = (value: unknown): value is RefreshMinutes =>
  REFRESH_MINUTES.some((minutes) => minutes === value);

export interface UsageSettings {
  /** Provider instance ids in the order dragged on the header usage bar. */
  readonly order: ReadonlyArray<string>;
  /** Provider instance ids left off the bar; they aren't refreshed either. */
  readonly hiddenProviders: ReadonlyArray<string>;
  /** Background limits refresh interval; 0 refreshes only on click. */
  readonly refreshMinutes: RefreshMinutes;
  readonly chipStyle: UsageChipStyle;
  /** Time until the headline window resets, after its % (`60% · 2h 13m`). */
  readonly showReset: boolean;
}

export const usageSettings = settingsSection(
  "usage",
  (raw): UsageSettings => ({
    order: strings(raw.order),
    hiddenProviders: strings(raw.hiddenProviders),
    refreshMinutes: isRefreshMinutes(raw.refreshMinutes) ? raw.refreshMinutes : 6,
    chipStyle:
      raw.chipStyle === "bars" || raw.chipStyle === "percent" ? raw.chipStyle : "barsAndPercent",
    showReset: raw.showReset !== false,
  }),
);

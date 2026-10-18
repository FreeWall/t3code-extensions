/**
 * Subscription usage windows per provider instance, from the `providers` the server
 * publishes on `subscribeServerConfig` (`ServerProvider.usageLimits` in the contracts),
 * the same snapshots the app's Usage → Limits view reads.
 */

import { type Json, record, string } from "../json.ts";

export type WindowKind = "session" | "weekly" | "monthly" | "other";

export interface UsageWindow {
  readonly id: string;
  readonly kind: WindowKind;
  readonly label: string;
  /** Compact tag for the header: `5h`, `7d`, or the kind's initial. */
  readonly short: string;
  readonly usedPercent: number;
  /** Epoch millis, or null when the provider reports no reset. */
  readonly resetsAt: number | null;
}

export interface ProviderUsage {
  readonly instanceId: string;
  /** Driver kind slug (`claudeAgent`, `codex`, …); picks the icon. */
  readonly driver: string;
  readonly name: string;
  readonly accentColor: string | null;
  readonly windows: ReadonlyArray<UsageWindow>;
  /** Epoch millis of the probe these windows came from, or null when not reported. */
  readonly checkedAt: number | null;
  /** Why there are no windows (API key account, failed probe); null when there are. */
  readonly notice: string | null;
}

/** `providerDriverMeta.ts` labels; unknown drivers fall back to their slug. */
const DRIVER_LABELS: Record<string, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

const KIND_ORDER: Record<WindowKind, number> = { session: 0, weekly: 1, monthly: 2, other: 3 };

const isKind = (value: unknown): value is WindowKind =>
  typeof value === "string" && value in KIND_ORDER;

function shortTag(kind: WindowKind, durationMins: unknown): string {
  if (typeof durationMins === "number" && durationMins > 0) {
    const hours = Math.round(durationMins / 60);
    return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  }
  return kind === "other" ? "·" : kind[0]!.toUpperCase();
}

function toWindow(value: unknown): UsageWindow | undefined {
  const raw = record(value);
  const id = string(raw?.id);
  if (raw === undefined || id === undefined || typeof raw.usedPercent !== "number") return undefined;
  const resetsAt = Date.parse(string(raw.resetsAt) ?? "");
  const kind = isKind(raw.kind) ? raw.kind : "other";
  return {
    id,
    kind,
    label: string(raw.label) ?? id,
    short: shortTag(kind, raw.windowDurationMins),
    usedPercent: Math.max(0, Math.min(100, raw.usedPercent)),
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
  };
}

/** Same filter as `providersWithLimits` in `@t3tools/shared/usageLimits`. */
function toProviderUsage(value: unknown): ProviderUsage | undefined {
  const raw = record(value);
  const instanceId = string(raw?.instanceId);
  const limits = record(raw?.usageLimits);
  if (raw === undefined || instanceId === undefined || limits === undefined) return undefined;
  if (raw.enabled !== true || raw.installed !== true || raw.availability === "unavailable") {
    return undefined;
  }
  const driver = string(raw.driver) ?? instanceId;
  const windows = ((limits.windows as unknown[] | undefined) ?? [])
    .map(toWindow)
    .filter((window) => window !== undefined)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const unavailable = record(limits.unavailable);
  const checkedAt = Date.parse(string(limits.checkedAt) ?? "");
  return {
    instanceId,
    driver,
    name: string(raw.displayName) ?? DRIVER_LABELS[driver] ?? driver,
    accentColor: string(raw.accentColor) ?? null,
    windows,
    checkedAt: Number.isFinite(checkedAt) ? checkedAt : null,
    notice: unavailable
      ? (string(unavailable.message) ??
        (unavailable.reason === "unsupported" ? "No subscription limits" : "Could not read limits"))
      : windows.length === 0
        ? "No limits reported"
        : null,
  };
}

let providers: ReadonlyArray<ProviderUsage> = [];
const listeners = new Set<() => void>();

export const getUsage = (): ReadonlyArray<ProviderUsage> => providers;

export function subscribeUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setProviders(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  providers = raw.map(toProviderUsage).filter((provider) => provider !== undefined);
  for (const listener of listeners) listener();
}

type Refresher = (instanceId: string) => Promise<void>;
let refresher: Refresher | null = null;

/** Set by the connection while a socket is up; null offline. */
export const setLimitsRefresher = (next: Refresher | null): void => {
  refresher = next;
};

/** Re-probes one instance; the new windows arrive on the config stream. No-op offline. */
export const refreshProvider = async (instanceId: string): Promise<void> => {
  await refresher?.(instanceId);
};

/** Applies one `subscribeServerConfig` stream item; only provider lists matter here. */
export function applyServerConfigItem(item: unknown): void {
  const raw = record(item);
  switch (string(raw?.type)) {
    case "snapshot":
      return setProviders(record(raw?.config)?.providers);
    case "providerStatuses":
      return setProviders(record(raw?.payload)?.providers);
  }
}

/** Quota left, 0..100, as the app's bars show it. */
export const remainingPercent = (window: UsageWindow): number => Math.round(100 - window.usedPercent);

/** A reading whose window has since reset says nothing about the new window. */
export const isExpired = (window: UsageWindow, now: number): boolean =>
  window.resetsAt !== null && window.resetsAt <= now;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `2h 13m`, `3d 4h`, `12m`, like `formatDuration` in the app. */
export function formatDuration(ms: number): string {
  const remaining = Math.max(0, ms);
  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

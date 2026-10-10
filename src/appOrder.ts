/**
 * The app sidebar's own project order, for the rail's "same as sidebar" setting.
 * The sort mode lives in the app's client settings (the desktop bridge, or
 * localStorage in a browser); its manual order lives in the UI state in
 * localStorage. The sorting follows `sortProjectsForSidebar` in `Sidebar.logic.ts`.
 */

import type { Project, Thread } from "./store.ts";

export type AppSortOrder = "updated_at" | "created_at" | "manual";

interface AppOrder {
  readonly sort: AppSortOrder;
  /** Physical project keys (`environmentId:workspaceRoot`) the sidebar was dragged into. */
  readonly manual: ReadonlyArray<string>;
}

const CLIENT_SETTINGS_KEY = "t3code:client-settings:v1";
const UI_STATE_KEY = "t3code:ui-state:v1";
const LEGACY_CWD_PREFIX = "legacy-project-cwd:";
/** The app persists its UI state 500 ms after a change. */
const PERSIST_DELAY_MS = 700;

type Json = Record<string, unknown>;

function readJson(key: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof value === "object" && value !== null ? (value as Json) : undefined;
  } catch {
    return undefined;
  }
}

const toSort = (value: unknown): AppSortOrder | undefined =>
  value === "updated_at" || value === "created_at" || value === "manual" ? value : undefined;

let order: AppOrder = { sort: "updated_at", manual: [] };
const listeners = new Set<() => void>();

export const getAppOrder = (): AppOrder => order;

export function subscribeAppOrder(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function refresh(): Promise<void> {
  let settings: unknown;
  try {
    settings = await window.desktopBridge?.getClientSettings?.();
  } catch (error) {
    console.warn("[rail] could not read the app's client settings", error);
  }
  const sort =
    toSort((settings as Json | null | undefined)?.sidebarProjectSortOrder) ??
    toSort(readJson(CLIENT_SETTINGS_KEY)?.sidebarProjectSortOrder) ??
    "updated_at";
  const stored = readJson(UI_STATE_KEY)?.projectOrder;
  const manual = Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === "string")
    : [];
  if (sort === order.sort && JSON.stringify(manual) === JSON.stringify(order.manual)) return;
  order = { sort, manual };
  for (const listener of listeners) listener();
}

/**
 * Reads the sidebar order now and after each click or drag, the only ways it
 * changes in this window. Returns the cleanup.
 */
export function watchAppOrder(): () => void {
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), PERSIST_DELAY_MS);
  };
  void refresh();
  document.addEventListener("pointerup", schedule, true);
  document.addEventListener("keyup", schedule, true);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("pointerup", schedule, true);
    document.removeEventListener("keyup", schedule, true);
  };
}

const timestamp = (...values: Array<string | null | undefined>): number => {
  for (const value of values) {
    const parsed = value ? Date.parse(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
};

const trimPath = (path: string): string => path.trim().replace(/(?<=.)[\\/]+$/, "");

/** Projects in the order the app sidebar lists them. */
export function sortLikeApp(
  projects: ReadonlyArray<Project>,
  threads: Iterable<Thread>,
  environmentId: string | null,
  { sort, manual }: AppOrder,
): Project[] {
  if (sort === "manual") {
    const rank = new Map(manual.map((key, index) => [key, index] as const));
    const rankOf = (project: Project) => {
      const path = trimPath(project.workspaceRoot);
      return Math.min(
        rank.get(`${environmentId}:${path}`) ?? Infinity,
        rank.get(`${LEGACY_CWD_PREFIX}${path}`) ?? Infinity,
      );
    };
    // Array sort is stable, so projects the sidebar hasn't placed keep their order.
    return [...projects].sort((a, b) => {
      const left = rankOf(a);
      const right = rankOf(b);
      return left === right ? 0 : left < right ? -1 : 1;
    });
  }

  const latest = new Map<string, number>();
  for (const thread of threads) {
    const time =
      sort === "created_at"
        ? timestamp(thread.createdAt, thread.updatedAt)
        : timestamp(thread.latestUserMessageAt, thread.updatedAt, thread.createdAt);
    latest.set(thread.projectId, Math.max(latest.get(thread.projectId) ?? time, time));
  }
  const timeOf = (project: Project) =>
    latest.get(project.id) ??
    (sort === "created_at"
      ? timestamp(project.createdAt)
      : timestamp(project.updatedAt, project.createdAt));
  return projects
    .map((project) => ({ project, time: timeOf(project) }))
    .sort(
      (a, b) =>
        (a.time === b.time ? 0 : b.time > a.time ? 1 : -1) ||
        a.project.title.localeCompare(b.project.title) ||
        a.project.id.localeCompare(b.project.id),
    )
    .map(({ project }) => project);
}

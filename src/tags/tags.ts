/**
 * Thread tags: the server's free-form `tags` on each thread, set with
 * `thread.tag.set`. The app keeps them but shows none, so this extension labels
 * sidebar rows with them and filters the list by one.
 */

import { dispatchCommand } from "../connection.ts";
import type { ShellState, Thread } from "../store.ts";

/** Same rule as `ThreadTag` in the contracts: one trimmed line, at most 64 characters. */
export const MAX_TAG_LENGTH = 64;

export function normalizeTag(input: string): string | null {
  const tag = input.trim();
  return tag.length > 0 && tag.length <= MAX_TAG_LENGTH && !/\p{Cc}/u.test(tag) ? tag : null;
}

export const setThreadTag = (threadId: string, tag: string, tagged: boolean): Promise<void> =>
  dispatchCommand({ type: "thread.tag.set", commandId: crypto.randomUUID(), threadId, tag, tagged });

export interface TagCount {
  readonly tag: string;
  readonly count: number;
}

/** Every tag in use, alphabetically, with how many active threads carry it. */
export function countTags(threads: Iterable<Thread>): TagCount[] {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    for (const tag of thread.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }));
}

/**
 * Threads of the project the sidebar is filtered to (`readScopeLabel`), or all of them
 * for "All projects". The scope is a display name, matched like the rail does.
 */
export function threadsInScope(state: ShellState, scopeLabel: string | null): Thread[] {
  const threads = [...state.threads.values()];
  if (scopeLabel === null) return threads;
  const projectIds = new Set(
    [...state.projects.values()].filter((project) => project.title === scopeLabel).map((project) => project.id),
  );
  return threads.filter((thread) => projectIds.has(thread.projectId));
}

/** A stable hue per tag, so a tag looks the same everywhere. */
export function tagHue(tag: string): number {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return Math.abs(hash) % 360;
}

/** Sidebar row keys are `environmentId:threadId`; thread ids can contain colons. */
export const threadIdFromRowKey = (key: string): string => key.slice(key.indexOf(":") + 1);

/** The thread open in the main view, from a `/environmentId/threadId` route. */
export function threadIdFromRoute(route: string): string | null {
  const segments = route.split("/").filter(Boolean);
  return segments.length === 2 ? decodeURIComponent(segments[1]!) : null;
}

/* The filter is a per-window view choice, so it lives in localStorage, not the settings file. */

const FILTER_KEY = "t3ext:tags:filter";

function readFilter(): string | null {
  try {
    return localStorage.getItem(FILTER_KEY);
  } catch {
    return null;
  }
}

let filter = readFilter();
const filterListeners = new Set<() => void>();

export const getFilter = (): string | null => filter;

/** The filter while some thread carries its tag; otherwise it would hide every thread. */
export const activeFilter = (threads: Iterable<Thread>): string | null => {
  if (filter === null) return null;
  for (const thread of threads) if (thread.tags.includes(filter)) return filter;
  return null;
};

export function subscribeFilter(listener: () => void): () => void {
  filterListeners.add(listener);
  return () => filterListeners.delete(listener);
}

export function setFilter(next: string | null): void {
  if (next === filter) return;
  filter = next;
  try {
    if (next === null) localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, next);
  } catch {
    // Storage off: the filter just isn't remembered.
  }
  for (const listener of filterListeners) listener();
}

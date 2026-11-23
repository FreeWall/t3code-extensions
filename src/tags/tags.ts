/**
 * Thread tags: the server's free-form `tags` on each thread, set with
 * `thread.tag.set`. The app keeps them but shows none, so this extension labels
 * sidebar rows with them and filters the list by one.
 */

import { dispatchCommand } from "../connection.ts";
import { getState, type ShellState, type Thread } from "../store.ts";

/** Title of the throwaway thread auto-tagging asks the model in; the sidebar hides it. */
export const AUTOTAG_TITLE = "Auto-tag";

/** Same rule as `ThreadTag` in the contracts: one trimmed line, at most 64 characters. */
export const MAX_TAG_LENGTH = 64;

export function normalizeTag(input: string): string | null {
  const tag = input.trim();
  return tag.length > 0 && tag.length <= MAX_TAG_LENGTH && !/\p{Cc}/u.test(tag) ? tag : null;
}

export const setThreadTag = (thread: Thread, tag: string, tagged: boolean): Promise<void> =>
  dispatchCommand(thread.environmentId, {
    type: "thread.tag.set",
    commandId: crypto.randomUUID(),
    threadId: thread.id,
    tag,
    tagged,
  });

/**
 * Moves `from` to `to` on every given thread that carries it; an existing `to` merges.
 * Each thread gains the new tag before losing the old, so it is never left untagged.
 */
export async function renameTag(threads: Iterable<Thread>, from: string, to: string): Promise<void> {
  const tagged = [...threads].filter((thread) => thread.tags.includes(from));
  await Promise.all(
    tagged.map(async (thread) => {
      if (!thread.tags.includes(to)) await setThreadTag(thread, to, true);
      await setThreadTag(thread, from, false);
    }),
  );
  // Filtering by the old name would match nothing; follow the rename.
  if (filter === from) setFilter(to);
}

/** Takes `tag` off every given thread that carries it. */
export async function removeTag(threads: Iterable<Thread>, tag: string): Promise<void> {
  const tagged = [...threads].filter((thread) => thread.tags.includes(tag));
  await Promise.all(tagged.map((thread) => setThreadTag(thread, tag, false)));
  if (filter === tag) setFilter(null);
}

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

/** Hues far enough apart to tell chips apart at a glance. */
const HUES = [260, 145, 25, 200, 320, 85, 0, 175, 290, 50, 230, 115];

function hashSlot(tag: string): number {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return Math.abs(hash) % HUES.length;
}

/**
 * Each tag gets its hashed palette slot, or the next free one when an older tag holds it,
 * so tags differ until the palette runs out. Older tags pick first and keep their color.
 */
function assignHues(threads: ReadonlyMap<string, Thread>): Map<string, number> {
  const firstSeen = new Map<string, string>();
  for (const thread of threads.values()) {
    for (const tag of thread.tags) {
      const seen = firstSeen.get(tag);
      if (seen === undefined || thread.createdAt < seen) firstSeen.set(tag, thread.createdAt);
    }
  }
  const taken = new Set<number>();
  const hues = new Map<string, number>();
  const byAge = [...firstSeen].sort(([a, x], [b, y]) => x.localeCompare(y) || a.localeCompare(b));
  for (const [tag] of byAge) {
    let slot = hashSlot(tag);
    for (let step = 0; step < HUES.length && taken.has(slot); step++) slot = (slot + 1) % HUES.length;
    taken.add(slot);
    hues.set(tag, HUES[slot]!);
  }
  return hues;
}

const hueCache = new WeakMap<ReadonlyMap<string, Thread>, Map<string, number>>();

/** A tag's hue, the same everywhere: distinct from other tags' while the palette lasts. */
export function tagHue(tag: string): number {
  const { threads } = getState();
  let hues = hueCache.get(threads);
  if (hues === undefined) hueCache.set(threads, (hues = assignHues(threads)));
  return hues.get(tag) ?? HUES[hashSlot(tag)]!;
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

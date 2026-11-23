/**
 * Tags a new thread by asking a cheap model, through T3 Code itself: it launches a
 * throwaway thread with the new thread's first message and the project's other
 * threads, reads the JSON reply, applies the tags and deletes the throwaway thread.
 */

import { getThreadProjection, launchThread, dispatchCommand } from "../connection.ts";
import { record, string } from "../json.ts";
import { getState, subscribe, type Thread } from "../store.ts";
import { fillPrompt, MAX_TAGS } from "./prompt.ts";
import { activePrompt, tagsSettings } from "./settings.ts";
import { AUTOTAG_TITLE, countTags, normalizeTag, setThreadTag } from "./tags.ts";

/** Most recently updated threads shown to the model as candidates. */
const MAX_OTHERS = 60;
const MAX_MESSAGE_CHARS = 2000;
const REPLY_TIMEOUT_MS = 3 * 60_000;
/** A throwaway thread older than this was left by a window that closed mid-run. */
const STALE_MS = 5 * 60_000;

/* Shared by every window through localStorage; the Web Lock below serializes them. */

const SINCE_KEY = "t3ext:autotag:since";
const DONE_KEY = "t3ext:autotag:done";
const MAX_DONE = 500;

function storage<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** Only threads created after auto-tagging was last switched on are tagged. */
function startedAt(restart: boolean): string {
  const now = new Date().toISOString();
  return storage(() => {
    const since = localStorage.getItem(SINCE_KEY);
    if (since !== null && !restart) return since;
    localStorage.setItem(SINCE_KEY, now);
    return now;
  }, now);
}

const readDone = (): string[] =>
  storage(() => {
    const parsed: unknown = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  }, []);

function markDone(threadId: string): void {
  storage(() => localStorage.setItem(DONE_KEY, JSON.stringify([...readDone(), threadId].slice(-MAX_DONE))), undefined);
}

const isDone = (threadId: string): boolean => readDone().includes(threadId);

/** A thread whose first run finished and that has no tags yet. */
/** Only the window's own backend: a remote one's threads are its own windows' to tag. */
const isCandidate = (thread: Thread, since: string): boolean =>
  thread.environmentId === getState().primaryEnvironmentId &&
  thread.title !== AUTOTAG_TITLE &&
  thread.createdAt > since &&
  thread.tags.length === 0 &&
  thread.latestRunCompletedAt !== null &&
  !thread.working &&
  !thread.needsInput;

/* Reply reading */

interface Message {
  readonly role: string;
  readonly text: string;
  readonly createdAt: string;
}

function messages(projection: unknown): Message[] {
  const list = record(projection)?.messages;
  if (!Array.isArray(list)) return [];
  return list.flatMap((value) => {
    const raw = record(value);
    const role = string(raw?.role);
    const text = string(raw?.text);
    if (role === undefined || text === undefined || raw?.streaming === true) return [];
    return [{ role, text, createdAt: string(raw?.createdAt) ?? "" }];
  });
}

const byTime = (a: Message, b: Message) => a.createdAt.localeCompare(b.createdAt);

/** The model's answer: tags for the new thread, each with the listed threads that share it. */
interface Suggestion {
  readonly tag: string;
  readonly threads: ReadonlyArray<number>;
}

function parseReply(text: string): Suggestion[] {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (json === undefined) return [];
  const parsed: unknown = storage(() => JSON.parse(json), null);
  const list = record(parsed)?.tags;
  if (!Array.isArray(list)) return [];
  return list.flatMap((value) => {
    const raw = record(value);
    const tag = normalizeTag(string(raw?.tag) ?? "");
    if (tag === null) return [];
    const threads = Array.isArray(raw?.threads)
      ? raw.threads.filter((n): n is number => Number.isInteger(n))
      : [];
    return [{ tag, threads }];
  });
}

function prompt(thread: Thread, firstMessage: string, others: ReadonlyArray<Thread>): string {
  const lines = others.map(
    (other, index) => `${index + 1}. ${other.title}${other.tags.length ? ` [${other.tags.join(", ")}]` : ""}`,
  );
  return fillPrompt(activePrompt(tagsSettings.get()), {
    title: thread.title,
    firstMessage: firstMessage.slice(0, MAX_MESSAGE_CHARS),
    project: getState().projects.get(thread.projectId)?.title ?? "",
    threads: lines.length ? lines.join("\n") : "(none)",
    maxTags: String(MAX_TAGS),
  });
}

/* The run */

/** Resolves when the thread's first run ends; rejects if it asks for input or times out. */
function runFinished(threadId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const thread = getState().threads.get(threadId);
      if (thread?.needsInput) done(new Error("the model asked for input"));
      else if (thread && thread.latestRunCompletedAt !== null && !thread.working) done();
    };
    const timer = setTimeout(() => done(new Error("no reply in time")), REPLY_TIMEOUT_MS);
    const stop = subscribe(check);
    function done(error?: Error) {
      clearTimeout(timer);
      stop();
      if (error) reject(error);
      else resolve();
    }
    check();
  });
}

const deleteThread = async (environmentId: string, threadId: string) =>
  dispatchCommand(environmentId, { type: "thread.delete", commandId: crypto.randomUUID(), threadId });

/** Asks the model and returns its reply text. */
async function ask(environmentId: string, projectId: string, text: string): Promise<string> {
  const launched = await launchThread(environmentId, {
    commandId: crypto.randomUUID(),
    projectId,
    title: AUTOTAG_TITLE,
    generateTitle: false,
    modelSelection: tagsSettings.get().model,
    // Nothing runs without approval, and no approval ever comes.
    runtimeMode: "approval-required",
    interactionMode: "default",
    workspaceStrategy: { type: "root" },
    initialMessage: { text, attachments: [] },
  });
  const threadId = string(record(launched)?.threadId);
  if (threadId === undefined) throw new Error("launchThread returned no thread id");
  try {
    await runFinished(threadId);
    const reply = messages(await getThreadProjection(environmentId, threadId)).filter((m) => m.role === "assistant").sort(byTime).at(-1);
    return reply?.text ?? "";
  } finally {
    await deleteThread(environmentId, threadId).catch(() => undefined);
  }
}

async function tagThread(thread: Thread): Promise<void> {
  const firstMessage = messages(await getThreadProjection(thread.environmentId, thread.id)).filter((m) => m.role === "user").sort(byTime)[0];
  const others = [...getState().threads.values()]
    .filter((other) => other.projectId === thread.projectId && other.id !== thread.id && other.title !== AUTOTAG_TITLE)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_OTHERS);

  const known = new Map(countTags(others).map(({ tag }) => [tag.toLowerCase(), tag]));

  const reply = await ask(thread.environmentId, thread.projectId, prompt(thread, firstMessage?.text ?? "", others));
  for (const suggestion of parseReply(reply).slice(0, MAX_TAGS)) {
    const existing = known.get(suggestion.tag.toLowerCase());
    const tag = existing ?? suggestion.tag;
    const related = suggestion.threads.flatMap((n) => others[n - 1] ?? []).filter((other) => !other.tags.includes(tag));
    // A new tag on one thread alone groups nothing.
    if (existing === undefined && related.length === 0) continue;
    await Promise.all([thread, ...related].map((target) => setThreadTag(target, tag, true)));
    console.info(`[t3ext] auto-tag “${tag}”:`, [thread, ...related].map((target) => target.title));
  }
}

/** Deletes throwaway threads a closed window left behind. */
const cleanUpLater = (): Promise<void> => navigator.locks.request("t3ext:autotag", cleanUp).then(() => undefined);

async function cleanUp(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const stale = [...getState().threads.values()].filter((t) => t.title === AUTOTAG_TITLE && t.createdAt < cutoff);
  await Promise.all(stale.map((t) => deleteThread(t.environmentId, t.id).catch(() => undefined)));
}

/**
 * Tags one thread unless another window already has. The lock is shared by every
 * window of the app, so only one asks at a time and none asks twice.
 */
async function autoTag(threadId: string): Promise<void> {
  await navigator.locks.request("t3ext:autotag", async () => {
    await cleanUp();
    const thread = getState().threads.get(threadId);
    if (isDone(threadId) || thread === undefined || thread.tags.length > 0) return;
    markDone(threadId);
    await tagThread(thread).catch((error: unknown) => console.warn("[t3ext] auto-tag failed", thread.title, error));
  });
}

/**
 * Auto-tags each new thread once its first run ends, while the setting is on. Only
 * threads created after it was switched on count, so existing threads are left alone.
 */
export function watchNewThreads(): () => void {
  let enabled = tagsSettings.get().autoTag;
  let since = startedAt(false);
  /** Threads this window has handed to `autoTag`, so a store update doesn't queue one twice. */
  const queued = new Set<string>();
  const scan = () => {
    if (getState().status !== "live" || !tagsSettings.get().autoTag) return;
    for (const thread of getState().threads.values()) {
      if (queued.has(thread.id) || !isCandidate(thread, since) || isDone(thread.id)) continue;
      queued.add(thread.id);
      void autoTag(thread.id);
    }
  };
  const stopStore = subscribe(scan);
  // Switched back on: threads made while it was off stay untagged.
  const stopSettings = tagsSettings.subscribe(() => {
    const next = tagsSettings.get().autoTag;
    if (next && !enabled) since = startedAt(true);
    enabled = next;
    scan();
  });
  scan();
  // Once the shell has loaded, so the store lists the leftovers.
  const cleanup = setTimeout(() => void cleanUpLater(), 30_000);
  return () => {
    stopStore();
    stopSettings();
    clearTimeout(cleanup);
  };
}

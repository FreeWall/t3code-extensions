/**
 * Unsent composer drafts. The app keeps them only in this window's localStorage
 * (`composerDraftStore.ts`), written debounced through `localStorage.setItem`, so
 * the rail re-reads the key whenever the app writes it.
 */

import { type Json, record } from "../json.ts";

const STORAGE_KEY = "t3code:composer-drafts:v1";

export interface Draft {
  /** Route that opens the draft: `/<environmentId>/<threadId>` or `/draft/<draftId>`. */
  readonly path: string;
  readonly threadId: string;
  /** Known for a new-thread draft; a draft on an existing thread takes the thread's project. */
  readonly projectId: string | null;
}

const nonEmpty = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/** Same fields as `composerDraftHasUserContent`; `attachments` is the persisted image list. */
function hasUserContent(draft: Json): boolean {
  return (
    (typeof draft.prompt === "string" && draft.prompt.trim().length > 0) ||
    nonEmpty(draft.attachments) ||
    nonEmpty(draft.files) ||
    nonEmpty(draft.terminalContexts) ||
    nonEmpty(draft.previewAnnotations) ||
    nonEmpty(draft.reviewComments) ||
    nonEmpty(draft.threadContexts)
  );
}

function readDrafts(): ReadonlyArray<Draft> {
  let state: Json | undefined;
  try {
    state = record(record(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"))?.state);
  } catch {
    return [];
  }
  const drafts = record(state?.draftsByThreadKey) ?? {};
  const sessions = record(state?.draftThreadsByThreadKey) ?? {};
  const result: Draft[] = [];
  for (const [key, value] of Object.entries(drafts)) {
    const draft = record(value);
    if (!draft || !hasUserContent(draft)) continue;
    const session = record(sessions[key]);
    const promoted = record(session?.promotedTo);
    if (session && !promoted && typeof session.threadId === "string") {
      result.push({
        path: `/draft/${key}`,
        threadId: session.threadId,
        projectId: typeof session.projectId === "string" ? session.projectId : null,
      });
      continue;
    }
    // Scoped thread key: `<environmentId>:<threadId>`.
    const environmentId =
      typeof promoted?.environmentId === "string" ? promoted.environmentId : key.slice(0, key.indexOf(":"));
    const threadId = typeof promoted?.threadId === "string" ? promoted.threadId : key.slice(key.indexOf(":") + 1);
    if (!environmentId || !threadId) continue;
    result.push({ path: `/${environmentId}/${threadId}`, threadId, projectId: null });
  }
  return result;
}

let drafts = readDrafts();
const listeners = new Set<() => void>();

/**
 * Runs after the app's storage call has returned, so a failure here can never
 * surface inside the app's own setItem/removeItem.
 */
function refresh(): void {
  queueMicrotask(() => {
    try {
      drafts = readDrafts();
      for (const listener of listeners) listener();
    } catch (error) {
      console.warn("[rail] could not refresh drafts", error);
    }
  });
}

const setItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
  setItem.call(this, key, value);
  if (this === localStorage && key === STORAGE_KEY) refresh();
};
const removeItem = Storage.prototype.removeItem;
Storage.prototype.removeItem = function (this: Storage, key: string) {
  removeItem.call(this, key);
  if (this === localStorage && key === STORAGE_KEY) refresh();
};

export const getDrafts = (): ReadonlyArray<Draft> => drafts;

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

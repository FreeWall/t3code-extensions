/**
 * Shell state for the rail: the projects and active threads from
 * `orchestration.subscribeShell`, reduced to the few fields the rail reads.
 */

export type ProjectIcon =
  | { readonly kind: "lucide"; readonly name: string; readonly color: string | undefined }
  | { readonly kind: "emoji"; readonly emoji: string }
  | { readonly kind: "monogram"; readonly text: string; readonly color: string | undefined };

export interface Project {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly faviconPath: string | null;
  readonly projectIcon: ProjectIcon | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Thread {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly working: boolean;
  readonly needsInput: boolean;
  /** Latest run finished after the thread was last opened. */
  readonly unread: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestUserMessageAt: string | null;
}

export type ConnectionStatus = "connecting" | "live" | "offline";

export interface RailState {
  readonly status: ConnectionStatus;
  readonly environmentId: string | null;
  readonly projects: ReadonlyMap<string, Project>;
  readonly threads: ReadonlyMap<string, Thread>;
}

type Json = Record<string, unknown>;

const record = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
const string = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Decodes the wire icon like `ProjectIconOverride` in the contracts: a monogram
 * travels as a lucide icon carrying `monogramText` (older peers: `monogram`).
 */
function toProjectIcon(value: unknown): ProjectIcon | null {
  const raw = record(value);
  const color = string(raw?.color);
  switch (string(raw?.kind)) {
    case "lucide": {
      const text = string(raw?.monogramText) ?? string(raw?.monogram);
      if (text) return { kind: "monogram", text, color };
      const name = string(raw?.name);
      return name ? { kind: "lucide", name, color } : null;
    }
    case "monogram": {
      const text = string(raw?.text);
      return text ? { kind: "monogram", text, color } : null;
    }
    case "emoji": {
      const emoji = string(raw?.emoji);
      return emoji ? { kind: "emoji", emoji } : null;
    }
  }
  return null;
}

function toProject(value: unknown): Project | undefined {
  const raw = record(value);
  const id = string(raw?.id);
  if (raw === undefined || id === undefined) return undefined;
  return {
    id,
    title: string(raw.title) ?? id,
    workspaceRoot: string(raw.workspaceRoot) ?? "",
    faviconPath: string(raw.faviconPath) ?? null,
    projectIcon: toProjectIcon(raw.projectIcon),
    createdAt: string(raw.createdAt) ?? "",
    updatedAt: string(raw.updatedAt) ?? "",
  };
}

function toThread(value: unknown): Thread | undefined {
  const raw = record(value);
  const id = string(raw?.id);
  const projectId = string(raw?.projectId);
  if (raw === undefined || id === undefined || projectId === undefined) return undefined;
  if (raw.deletedAt != null || raw.archivedAt != null) return undefined;
  // Subagent threads are delegated child work; the sidebar doesn't list them either.
  if (record(raw.lineage)?.relationshipToParent === "subagent") return undefined;
  const completedAt = string(raw.latestRunCompletedAt);
  const visitedAt = string(raw.lastVisitedAt);
  // Same rules as the app sidebar's status pills: an auth refresh isn't the user's
  // turn, and a proposed plan only waits on the user in plan mode once the run ends.
  const request = record(raw.pendingRuntimeRequest);
  const needsInput =
    (request !== undefined && request.kind !== "auth_refresh") ||
    (raw.interactionMode === "plan" &&
      raw.hasActionableProposedPlan === true &&
      raw.activeRunId == null);
  return {
    id,
    projectId,
    title: string(raw.title) ?? "",
    working: raw.activeRunId != null && !needsInput,
    needsInput,
    // A never-visited thread counts as read, as in the sidebar; otherwise every
    // historical thread would light up.
    unread:
      raw.settledAt == null &&
      completedAt !== undefined &&
      visitedAt !== undefined &&
      Date.parse(completedAt) > Date.parse(visitedAt),
    createdAt: string(raw.createdAt) ?? "",
    updatedAt: string(raw.updatedAt) ?? "",
    latestUserMessageAt: string(raw.latestUserMessageAt) ?? null,
  };
}

let state: RailState = {
  status: "connecting",
  environmentId: null,
  projects: new Map(),
  threads: new Map(),
};
const listeners = new Set<() => void>();

function set(next: Partial<RailState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const getState = (): RailState => state;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const setStatus = (status: ConnectionStatus): void => {
  if (state.status !== status) set({ status });
};

export const setEnvironmentId = (environmentId: string): void => set({ environmentId });

/** Applies one `orchestration.subscribeShell` stream item. */
export function applyShellItem(item: unknown): void {
  const raw = record(item);
  switch (string(raw?.kind)) {
    case "snapshot": {
      // Enrichment refreshes carry only the projects whose repository identity just
      // resolved and no threads; they patch identity, which the rail doesn't read.
      if (raw?.resolvedRepositoryIdentityRoots !== undefined) return;
      const snapshot = record(raw?.snapshot);
      const projects = new Map<string, Project>();
      for (const value of (snapshot?.projects as unknown[]) ?? []) {
        const project = toProject(value);
        if (project) projects.set(project.id, project);
      }
      const threads = new Map<string, Thread>();
      for (const value of (snapshot?.threads as unknown[]) ?? []) {
        const thread = toThread(value);
        if (thread) threads.set(thread.id, thread);
      }
      set({ projects, threads });
      return;
    }
    case "project.updated": {
      const project = toProject(raw?.project);
      if (!project) return;
      set({ projects: new Map(state.projects).set(project.id, project) });
      return;
    }
    case "project.removed": {
      const id = string(raw?.projectId);
      if (id === undefined || !state.projects.has(id)) return;
      const projects = new Map(state.projects);
      projects.delete(id);
      set({ projects });
      return;
    }
    case "thread.updated": {
      const id = string(record(raw?.thread)?.id);
      if (id === undefined) return;
      const thread = raw?.location === "active" ? toThread(raw?.thread) : undefined;
      const threads = new Map(state.threads);
      if (thread) threads.set(id, thread);
      else threads.delete(id);
      set({ threads });
      return;
    }
    case "thread.removed": {
      const id = string(raw?.threadId);
      if (id === undefined || !state.threads.has(id)) return;
      const threads = new Map(state.threads);
      threads.delete(id);
      set({ threads });
      return;
    }
  }
}

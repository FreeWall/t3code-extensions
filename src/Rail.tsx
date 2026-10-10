import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "preact/compat";

import { getAppOrder, sortLikeApp, subscribeAppOrder, watchAppOrder } from "./appOrder.ts";
import { activeRoute, navigate, readScopeLabel, selectScope, watchScope } from "./app.ts";
import { getDrafts, subscribeDrafts, type Draft } from "./drafts.ts";
import { ProjectIcon } from "./ProjectIcon.tsx";
import { getSettings, subscribeSettings, updateSettings } from "./settings.ts";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { getState, subscribe, type Project, type Thread } from "./store.ts";

interface ProjectActivity {
  readonly working: number;
  readonly needsInput: ReadonlyArray<Thread>;
  readonly unread: ReadonlyArray<Thread>;
  readonly drafts: ReadonlyArray<Draft>;
}

/** Dragged order first, then projects the rail hasn't placed yet, oldest first. */
function orderProjects(projects: Iterable<Project>, order: ReadonlyArray<string>): Project[] {
  const rank = new Map(order.map((id, index) => [id, index] as const));
  return Array.from(projects).sort(
    (a, b) =>
      (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

function summarize(
  threads: ReadonlyMap<string, Thread>,
  drafts: ReadonlyArray<Draft>,
  route: string,
): Map<string, ProjectActivity> {
  const byProject = new Map<
    string,
    { working: number; needsInput: Thread[]; unread: Thread[]; drafts: Draft[] }
  >();
  const entry = (projectId: string) => {
    let found = byProject.get(projectId);
    if (!found) {
      byProject.set(projectId, (found = { working: 0, needsInput: [], unread: [], drafts: [] }));
    }
    return found;
  };
  for (const thread of threads.values()) {
    if (thread.needsInput) entry(thread.projectId).needsInput.push(thread);
    else if (thread.working) entry(thread.projectId).working += 1;
    // The open thread is marked visited a moment after its run finishes; skip it so
    // the badge doesn't flash in between.
    else if (thread.unread && !route.endsWith(`/${thread.id}`)) {
      entry(thread.projectId).unread.push(thread);
    }
  }
  for (const draft of drafts) {
    // The sidebar doesn't flag the draft you are looking at either.
    if (draft.path === route) continue;
    const projectId = threads.get(draft.threadId)?.projectId ?? draft.projectId;
    if (projectId) entry(projectId).drafts.push(draft);
  }
  return byProject;
}

/** Sidebar scope and current route; both change with the app's DOM. */
function useAppLocation(): { scopeLabel: string | null; route: string } {
  const [scopeLabel, setScopeLabel] = useState(readScopeLabel);
  const [route, setRoute] = useState(activeRoute);
  useEffect(
    () =>
      watchScope(() => {
        setScopeLabel(readScopeLabel());
        setRoute(activeRoute());
      }),
    [],
  );
  return { scopeLabel, route };
}

function tooltip(project: Project, activity: ProjectActivity | undefined): string {
  const parts = [project.title];
  if (activity?.needsInput.length) parts.push(`${activity.needsInput.length} waiting for you`);
  if (activity?.working) parts.push(`${activity.working} working`);
  if (activity?.unread.length) parts.push(`${activity.unread.length} finished`);
  if (activity?.drafts.length) parts.push(`${activity.drafts.length} unsent draft`);
  return parts.join(" · ");
}

export function Rail() {
  const state = useSyncExternalStore(subscribe, getState);
  const drafts = useSyncExternalStore(subscribeDrafts, getDrafts);
  const { scopeLabel, route } = useAppLocation();
  const settings = useSyncExternalStore(subscribeSettings, getSettings);
  const [dragging, setDragging] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const appOrder = useSyncExternalStore(subscribeAppOrder, getAppOrder);
  const live = state.status === "live";
  const manual = settings.projectSort === "manual";

  useEffect(() => (manual ? undefined : watchAppOrder()), [manual]);

  const allProjects = useMemo(
    () =>
      manual
        ? orderProjects(state.projects.values(), settings.projectOrder)
        : sortLikeApp(
            [...state.projects.values()],
            state.threads.values(),
            state.environmentId,
            appOrder,
          ),
    [manual, state.projects, state.threads, state.environmentId, settings.projectOrder, appOrder],
  );
  const projects = useMemo(() => {
    const hidden = new Set(settings.hiddenProjects);
    return allProjects.filter((project) => !hidden.has(project.id));
  }, [allProjects, settings.hiddenProjects]);
  const activity = useMemo(
    () => summarize(state.threads, drafts, route),
    [state.threads, drafts, route],
  );

  const moveProject = (id: string, beforeId: string) => {
    if (id === beforeId) return;
    // Hidden projects keep their place, so unhiding one puts it back where it was.
    const ids = allProjects.map((project) => project.id).filter((other) => other !== id);
    ids.splice(ids.indexOf(beforeId), 0, id);
    updateSettings({ projectOrder: ids });
  };

  const openThread = (thread: Thread) => {
    if (state.environmentId) navigate(`/${state.environmentId}/${thread.id}`);
  };

  return (
    <nav class="t3rail" data-status={state.status} aria-label="Projects">
      <button
        type="button"
        class="t3rail-item t3rail-all"
        data-active={scopeLabel === null}
        title="All projects"
        onClick={() => void selectScope(null)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </button>
      <div class="t3rail-separator" />
      <div class="t3rail-list">
        {projects.map((project) => {
          const entry = activity.get(project.id);
          // Waiting threads first: they block an agent, a finished one doesn't.
          const attention = [...(entry?.needsInput ?? []), ...(entry?.unread ?? [])];
          const draft = entry?.drafts[0];
          return (
            <div
              key={project.id}
              class="t3rail-slot"
              data-dragging={dragging === project.id}
              draggable={manual}
              onDragStart={(event) => {
                event.dataTransfer?.setData("text/plain", project.id);
                setDragging(project.id);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => dragging && event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging) moveProject(dragging, project.id);
                setDragging(null);
              }}
            >
              <span class="t3rail-pill" />
              <button
                type="button"
                class="t3rail-item"
                data-active={scopeLabel === project.title}
                data-working={(entry?.working ?? 0) > 0}
                title={tooltip(project, entry)}
                onClick={() =>
                  void selectScope(scopeLabel === project.title ? null : project.title)
                }
              >
                <ProjectIcon project={project} live={live} />
              </button>
              {attention.length > 0 ? (
                <button
                  type="button"
                  class="t3rail-badge"
                  title={`Open "${attention[0]!.title}"`}
                  onClick={() => openThread(attention[0]!)}
                >
                  {attention.length}
                </button>
              ) : null}
              {draft ? (
                <button
                  type="button"
                  class="t3rail-draft"
                  title={
                    entry!.drafts.length > 1
                      ? `${entry!.drafts.length} unsent drafts`
                      : "Open unsent draft"
                  }
                  onClick={() => navigate(draft.path)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
                  </svg>
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        class="t3rail-item t3rail-settings-toggle"
        data-active={settingsOpen}
        title="Rail settings"
        onClick={() => setSettingsOpen(!settingsOpen)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {settingsOpen ? (
        <SettingsPanel projects={allProjects} live={live} onClose={closeSettings} />
      ) : null}
    </nav>
  );
}

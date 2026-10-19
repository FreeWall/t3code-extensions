import { useEffect, useMemo, useSyncExternalStore } from "preact/compat";

import { getAppOrder, sortLikeApp, subscribeAppOrder, watchAppOrder } from "./appOrder.ts";
import { railSettings } from "./settings.ts";
import { isSettingsProject } from "../settings.ts";
import { getState, subscribe, type Project } from "../store.ts";

/** Dragged order first, then projects the rail hasn't placed yet, oldest first. */
export function orderProjects(projects: Iterable<Project>, order: ReadonlyArray<string>): Project[] {
  const rank = new Map(order.map((id, index) => [id, index] as const));
  return Array.from(projects).sort(
    (a, b) =>
      (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** Every project, hidden ones included, in the rail's order; the settings project is left out. */
export function useOrderedProjects(): Project[] {
  const state = useSyncExternalStore(subscribe, getState);
  const settings = useSyncExternalStore(railSettings.subscribe, railSettings.get);
  const appOrder = useSyncExternalStore(subscribeAppOrder, getAppOrder);
  const manual = settings.projectSort === "manual";

  useEffect(() => (manual ? undefined : watchAppOrder()), [manual]);

  return useMemo(() => {
    const projects = [...state.projects.values()].filter(
      (project) => !isSettingsProject(project.workspaceRoot),
    );
    return manual
      ? orderProjects(projects, settings.projectOrder)
      : sortLikeApp(projects, state.threads.values(), state.environmentId, appOrder);
  }, [manual, state.projects, state.threads, state.environmentId, settings.projectOrder, appOrder]);
}

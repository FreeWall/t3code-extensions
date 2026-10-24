import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "preact/compat";

import { activeRoute, navigate, readScopeLabel, selectScope, watchScope } from "../app.ts";
import { getDrafts, subscribeDrafts, type Draft } from "./drafts.ts";
import { ProjectIcon } from "./ProjectIcon.tsx";
import { orderProjects, useOrderedProjects } from "./projects.ts";
import { isPageOpen, openExtensionSettings, subscribePage } from "../settings-page/state.ts";
import { railSettings } from "./settings.ts";
import { getState, subscribe, type Project, type Thread } from "../store.ts";

interface ProjectActivity {
  readonly working: number;
  readonly needsInput: ReadonlyArray<Thread>;
  readonly unread: ReadonlyArray<Thread>;
  readonly drafts: ReadonlyArray<Draft>;
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

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** FLIP: slides slots from where they are on screen whenever the order changes. */
function useSlideOnReorder(
  slots: ReadonlyMap<string, HTMLElement>,
  order: unknown,
  draggedId: string | undefined,
): void {
  const lastTops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const tops = new Map<string, number>();
    for (const [id, el] of slots) {
      const top = el.offsetTop;
      tops.set(id, top);
      // The dragged slot follows the pointer instead.
      if (id === draggedId) continue;
      // Mid-slide, or the pointer offset of a just released slot.
      const shift = new DOMMatrix(getComputedStyle(el).transform).m42;
      el.style.transform = "";
      const last = lastTops.current.get(id);
      if (last === undefined || last + shift === top || reducedMotion.matches) continue;
      for (const animation of el.getAnimations()) animation.cancel();
      el.animate(
        [{ transform: `translateY(${last + shift - top}px)` }, { transform: "none" }],
        { duration: 150, easing: "ease-out" },
      );
    }
    lastTops.current = tops;
  }, [order]);
}

/** Pointer travel before a press on a project becomes a drag. */
const DRAG_THRESHOLD = 4;

export function Rail() {
  const state = useSyncExternalStore(subscribe, getState);
  const drafts = useSyncExternalStore(subscribeDrafts, getDrafts);
  const { scopeLabel, route } = useAppLocation();
  const settings = useSyncExternalStore(railSettings.subscribe, railSettings.get);
  // While dragging, the order the rail previews; saved on release.
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null);
  // Read by the document listeners, which outlive a render.
  const dragRef = useRef(drag);
  dragRef.current = drag;
  /** Where the dragged slot was grabbed, and where the pointer is now; list coordinates. */
  const pointer = useRef<{ grab: number; clientY: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<string, HTMLDivElement>()).current;
  const settingsOpen = useSyncExternalStore(subscribePage, isPageOpen);
  const live = state.status === "live";
  const manual = settings.projectSort === "manual";
  const allProjects = useOrderedProjects();
  const projects = useMemo(() => {
    const hidden = new Set(settings.hiddenProjects);
    const ordered = drag ? orderProjects(allProjects, drag.order) : allProjects;
    return ordered.filter((project) => !hidden.has(project.id));
  }, [allProjects, drag, settings.hiddenProjects]);
  useSlideOnReorder(slots, projects, drag?.id);
  useLayoutEffect(() => follow(), [projects]);
  const activity = useMemo(
    () => summarize(state.threads, drafts, route),
    [state.threads, drafts, route],
  );

  const listY = (list: HTMLElement, clientY: number) =>
    clientY - list.getBoundingClientRect().top + list.scrollTop;

  /** Keeps the dragged slot under the pointer; its layout spot moves as the order does. */
  const follow = () => {
    const el = dragRef.current && slots.get(dragRef.current.id);
    if (!el || !pointer.current || !listRef.current) return;
    const y = listY(listRef.current, pointer.current.clientY) - pointer.current.grab;
    el.style.transform = `translateY(${y - el.offsetTop}px)`;
  };

  /** Puts the dragged project before the first slot whose middle is below the pointer. */
  const previewDrop = (clientY: number) => {
    const current = dragRef.current;
    if (!current || !listRef.current) return;
    const y = listY(listRef.current, clientY);
    // offsetTop ignores transforms, so slides and the dragged slot don't shift targets.
    let before: HTMLElement | undefined;
    let beforeId: string | undefined;
    for (const [id, slot] of slots) {
      if (id === current.id || slot.offsetTop + slot.offsetHeight / 2 <= y) continue;
      if (!before || slot.offsetTop < before.offsetTop) [before, beforeId] = [slot, id];
    }
    // Hidden projects keep their place, so unhiding one puts it back where it was.
    const order = current.order.filter((id) => id !== current.id);
    order.splice(beforeId ? order.indexOf(beforeId) : order.length, 0, current.id);
    if (order.every((id, index) => id === current.order[index])) return;
    dragRef.current = { id: current.id, order };
    setDrag(dragRef.current);
  };

  /** A press turns into a drag once it moves; a plain click still selects the project. */
  const pressProject = (event: PointerEvent, id: string) => {
    const el = slots.get(id);
    const list = listRef.current;
    if (!manual || event.button !== 0 || !el || !list) return;
    const { pointerId, clientY: startY } = event;
    const grab = listY(list, startY) - el.offsetTop;

    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      if (!pointer.current) {
        if (Math.abs(moved.clientY - startY) < DRAG_THRESHOLD) return;
        pointer.current = { grab, clientY: moved.clientY };
        el.setPointerCapture(pointerId);
        dragRef.current = { id, order: allProjects.map((project) => project.id) };
        setDrag(dragRef.current);
      }
      pointer.current.clientY = moved.clientY;
      follow();
      previewDrop(moved.clientY);
    };
    const finish = (save: boolean) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      if (!pointer.current) return;
      pointer.current = null;
      if (save && dragRef.current) railSettings.update({ projectOrder: dragRef.current.order });
      dragRef.current = null;
      setDrag(null);
      // The release would also click the project under it.
      const swallow = (click: Event) => click.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true));
    };
    const release = (up: PointerEvent) => up.pointerId === pointerId && finish(true);
    const cancel = (up: PointerEvent) => up.pointerId === pointerId && finish(false);
    const escape = (key: KeyboardEvent) => {
      if (key.key !== "Escape" || !pointer.current) return;
      key.stopPropagation();
      finish(false);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
  };

  const openThread = (thread: Thread) => {
    if (state.environmentId) navigate(`/${state.environmentId}/${thread.id}`);
  };

  return (
    <nav
      class="t3rail"
      data-status={state.status}
      aria-label="Projects"
      style={{
        "--t3rail-background": settings.background ?? undefined,
        "--t3rail-pill-background": settings.pillBackground ?? undefined,
      }}
    >
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
      <div class="t3rail-list" ref={listRef}>
        {projects.map((project) => {
          const entry = activity.get(project.id);
          // Waiting threads first: they block an agent, a finished one doesn't.
          const attention = [...(entry?.needsInput ?? []), ...(entry?.unread ?? [])];
          const draft = entry?.drafts[0];
          return (
            <div
              key={project.id}
              class="t3rail-slot"
              ref={(el) => {
                if (el) slots.set(project.id, el);
                else slots.delete(project.id);
              }}
              data-dragging={drag?.id === project.id}
              onPointerDown={(event) => pressProject(event, project.id)}
              // Native drag of the favicon would steal the pointer.
              onDragStart={(event) => event.preventDefault()}
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
        title="Extension settings"
        onClick={() => openExtensionSettings("rail")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </nav>
  );
}

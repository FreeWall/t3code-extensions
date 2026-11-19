import { Plus, X } from "lucide";
import { useEffect, useMemo, useState, useSyncExternalStore } from "preact/compat";

import { activeRoute, readScopeLabel, watchScope } from "../app.ts";
import { getState, subscribe } from "../store.ts";
import { Icon } from "../ui/index.tsx";
import {
  activeFilter,
  countTags,
  getFilter,
  setFilter,
  subscribeFilter,
  tagHue,
  threadIdFromRoute,
  threadsInScope,
} from "./tags.ts";

/** Current route and sidebar project scope; both change with the app's DOM. */
function useAppLocation(): { route: string; scopeLabel: string | null } {
  const read = () => ({ route: activeRoute(), scopeLabel: readScopeLabel() });
  const [location, setLocation] = useState(read);
  useEffect(
    () =>
      watchScope(() => {
        const next = read();
        setLocation((current) =>
          current.route === next.route && current.scopeLabel === next.scopeLabel ? current : next,
        );
      }),
    [],
  );
  return location;
}

/**
 * Tag chips under the sidebar search: click one to show only its threads. Lists the
 * tags of the project the sidebar is filtered to, or of every project for "All projects".
 */
export function FilterBar({ onEdit }: { onEdit: (threadId: string, anchor: DOMRect) => void }) {
  const state = useSyncExternalStore(subscribe, getState);
  useSyncExternalStore(subscribeFilter, getFilter);
  const { route, scopeLabel } = useAppLocation();
  const scoped = useMemo(() => threadsInScope(state, scopeLabel), [state.threads, state.projects, scopeLabel]);
  const tags = useMemo(() => countTags(scoped), [scoped]);
  const filter = activeFilter(scoped);
  // The open thread's id while it is one the shell knows; null on drafts, settings, home.
  const routeThreadId = threadIdFromRoute(route);
  const openThreadId = routeThreadId !== null && state.threads.has(routeThreadId) ? routeThreadId : null;

  if (tags.length === 0 && openThreadId === null) return null;

  return (
    <div class="t3tags-bar" role="toolbar" aria-label="Filter threads by tag">
      {tags.map(({ tag, count }) => {
        const active = filter === tag;
        return (
          <button
            key={tag}
            type="button"
            class="t3tags-chip"
            data-active={active ? "" : undefined}
            aria-pressed={active}
            title={active ? "Show all threads" : `Show only threads tagged “${tag}”`}
            style={{ "--t3tag-hue": String(tagHue(tag)) }}
            onClick={() => setFilter(active ? null : tag)}
          >
            {tag}
            {active ? <Icon node={X} class="t3tags-chip-icon" /> : <span class="t3tags-count">{count}</span>}
          </button>
        );
      })}
      {openThreadId !== null ? (
        <button
          type="button"
          class="t3tags-add"
          title="Tag the open thread (Shift+right-click tags any thread)"
          aria-label="Tag the open thread"
          onClick={(event) => onEdit(openThreadId, event.currentTarget.getBoundingClientRect())}
        >
          <Icon node={Plus} class="t3tags-chip-icon" />
          {tags.length === 0 ? <span>Tag</span> : null}
        </button>
      ) : null}
    </div>
  );
}

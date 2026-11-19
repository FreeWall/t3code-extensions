import { Tag } from "lucide";
import { render } from "preact";

import type { Extension } from "../extension.ts";
import { subscribe } from "../store.ts";
import { FilterBar } from "./FilterBar.tsx";
import { clearRows, decorateRows, watchChipClicks } from "./rows.ts";
import { TagEditor } from "./TagEditor.tsx";
import { subscribeFilter, threadIdFromRowKey } from "./tags.ts";
import styles from "./tags.css";

/** The thread list's scroll area; the bar goes right above it, under the search. */
const LIST_SCROLL_AREA = '[data-slot="sidebar-inner"] [data-slot="scroll-area-viewport"]:has(> [data-slot="sidebar-content"])';
const THREAD_ROW = '[data-slot="sidebar"] li[data-thread-item]';

function mountEditor(): { open: (threadId: string, x: number, y: number) => void; stop: () => void } {
  const host = document.createElement("div");
  host.id = "t3tags-editor-root";
  document.body.append(host);
  const close = () => render(null, host);
  return {
    open: (threadId, x, y) => render(<TagEditor key={`${threadId}:${x}:${y}`} threadId={threadId} x={x} y={y} onClose={close} />, host),
    stop: () => {
      close();
      host.remove();
    },
  };
}

export const tags: Extension = {
  name: "tags",
  title: "Thread tags",
  description: "Tag labels on sidebar threads and a tag filter",
  icon: Tag,
  styles,
  mount: () => {
    const editor = mountEditor();
    const bar = document.createElement("div");
    bar.id = "t3tags-bar-root";
    render(<FilterBar onEdit={(threadId, anchor) => editor.open(threadId, anchor.left, anchor.bottom + 4)} />, bar);

    /**
     * Re-applies chips, row visibility and the bar's place after any sidebar render.
     * Batched in a microtask, so it lands before the browser paints the app's change.
     */
    let pending = false;
    let stopped = false;
    const sync = () => {
      pending = false;
      if (stopped) return;
      decorateRows();
      const scrollArea = document.querySelector(LIST_SCROLL_AREA)?.parentElement;
      if (!scrollArea) bar.remove();
      else if (bar.nextElementSibling !== scrollArea) scrollArea.before(bar);
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      queueMicrotask(sync);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true });
    const stopStore = subscribe(schedule);
    const stopFilter = subscribeFilter(schedule);
    const stopChips = watchChipClicks();
    schedule();

    // Shift+right-click on a thread row edits its tags; a plain right-click keeps the app's menu.
    const onContextMenu = (event: MouseEvent) => {
      if (!event.shiftKey || !(event.target instanceof Element)) return;
      const key = event.target.closest<HTMLElement>(THREAD_ROW)?.dataset.threadItem;
      if (!key) return;
      event.preventDefault();
      event.stopPropagation();
      editor.open(threadIdFromRowKey(key), event.clientX, event.clientY);
    };
    document.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      stopped = true;
      observer.disconnect();
      stopStore();
      stopFilter();
      stopChips();
      render(null, bar);
      bar.remove();
      editor.stop();
      clearRows();
    };
  },
};

/**
 * A plain click on the sidebar's New thread button opens the command palette's
 * "New thread in..." picker (`handleNewThreadClick` in `Sidebar.tsx`). While the
 * sidebar is filtered to a project, this picks that project in the picker, so the
 * thread starts in the filtered project. Shift+click, which the app sends to the
 * viewed thread's project, is turned into a plain click so it does the same.
 */

import { SquarePen } from "lucide";

import { readScopeLabel, waitFor } from "../app.ts";
import type { Extension } from "../extension.ts";
import styles from "./new-thread.css";

const NEW_THREAD_BUTTON = '[data-slot="sidebar"] button[aria-label="New thread"]';
const PALETTE_ITEM = '[aria-label="Command palette"] [data-slot="command-item"]';

const itemTitle = (item: Element): string => item.querySelector(".truncate")?.textContent?.trim() ?? "";

async function pickProject(label: string): Promise<void> {
  // Hides the palette while it is driven, so it doesn't flash.
  document.documentElement.dataset.t3newthread = "";
  try {
    const item = await waitFor(() =>
      Array.from(document.querySelectorAll<HTMLElement>(PALETTE_ITEM)).find((candidate) => itemTitle(candidate) === label),
    );
    item?.click();
  } finally {
    delete document.documentElement.dataset.t3newthread;
  }
}

function onClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLElement>(NEW_THREAD_BUTTON);
  if (button === null) return;
  const label = readScopeLabel();
  if (label === null) return;
  if (event.shiftKey) {
    // Capture on document runs before React's root listener, so the app never sees it.
    event.preventDefault();
    event.stopPropagation();
    button.click();
    return;
  }
  void pickProject(label);
}

export const newThread: Extension = {
  name: "newThread",
  title: "New thread button",
  description: "Starts a new thread in the project's sidebar",
  icon: SquarePen,
  styles,
  mount: () => {
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  },
};

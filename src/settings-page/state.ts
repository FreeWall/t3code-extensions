import { activeRoute, navigate } from "../app.ts";

/** Whether the Extensions page shows in place of the app's own settings section. */
let open = false;
const listeners = new Set<() => void>();

export const isPageOpen = (): boolean => open;

export function subscribePage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setPageOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

/** The extension picked in the page's list; null for the first one. */
let selected: string | null = null;

export const getSelected = (): string | null => selected;

export function select(name: string): void {
  if (selected === name) return;
  selected = name;
  for (const listener of listeners) listener();
}

/** Goes to Settings and shows the Extensions page, with one extension picked. */
export function openExtensionSettings(name?: string): void {
  if (!activeRoute().startsWith("/settings/")) navigate("/settings/general");
  if (name !== undefined) select(name);
  setPageOpen(true);
}

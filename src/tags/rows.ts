/**
 * Puts tag chips on the app's sidebar rows and hides the rows the filter leaves out.
 * React owns the rows, so this only adds its own nodes and attributes and redoes
 * them whenever the sidebar re-renders. Selectors follow `SidebarThreadRow.tsx`.
 */

import { readScopeLabel } from "../app.ts";
import { getState } from "../store.ts";
import { activeFilter, AUTOTAG_TITLE, setFilter, tagHue, threadIdFromRowKey, threadsInScope } from "./tags.ts";

/** The filter as it applies to the project the sidebar shows. */
const scopedFilter = (): string | null => activeFilter(threadsInScope(getState(), readScopeLabel()));

const ROW_ITEM = '[data-slot="sidebar"] li[data-thread-item]';
const SEARCH_RESULTS = "#sidebar-thread-search-results";
/** The time/status slot that ends a row's first line; chips sit just before it. */
const STATUS_SLOT = '[class~="ml-auto"]';
const HIDDEN = "data-t3tags-hidden";

function chipsFor(tags: ReadonlyArray<string>, active: string | null): HTMLElement {
  const container = document.createElement("span");
  container.className = "t3tags-chips";
  for (const tag of tags) {
    const chip = document.createElement("span");
    chip.className = "t3tags-chip";
    chip.textContent = tag;
    chip.title = active === tag ? `Showing only “${tag}”; click to show all` : `Show only “${tag}”`;
    chip.dataset.tag = tag;
    if (active === tag) chip.dataset.active = "";
    chip.style.setProperty("--t3tag-hue", String(tagHue(tag)));
    container.append(chip);
  }
  return container;
}

/** Brings one row in line with its thread's tags and the filter; a no-op when it already is. */
function decorate(item: HTMLElement, filter: string | null): void {
  const thread = getState().threads.get(threadIdFromRowKey(item.dataset.threadItem ?? ""));
  const tags = thread?.tags ?? [];

  const hide =
    thread?.title === AUTOTAG_TITLE ||
    (filter !== null && thread !== undefined && !tags.includes(filter) && item.closest(SEARCH_RESULTS) === null);
  if (item.hasAttribute(HIDDEN) !== hide) item.toggleAttribute(HIDDEN, hide);

  const existing = item.querySelector<HTMLElement>(".t3tags-chips");
  const signature = `${filter ?? ""}\u0000${tags.join("\u0000")}`;
  if (tags.length === 0) {
    existing?.remove();
    return;
  }
  const slot = item.querySelector("[data-sidebar-row]")?.querySelector(STATUS_SLOT);
  if (existing?.dataset.signature === signature && existing.nextElementSibling === slot) return;
  existing?.remove();
  if (!slot) return;
  const chips = chipsFor(tags, filter);
  chips.dataset.signature = signature;
  slot.before(chips);
}

export function decorateRows(): void {
  const filter = scopedFilter();
  for (const item of document.querySelectorAll<HTMLElement>(ROW_ITEM)) decorate(item, filter);
}

/**
 * A chip filters by its tag. Its pointer events are stopped in the capture phase on
 * the document, before React's root listener, so the row doesn't open or start a drag.
 */
function onChipEvent(event: Event): void {
  if (!(event.target instanceof Element)) return;
  const chip = event.target.closest<HTMLElement>(".t3tags-chips .t3tags-chip");
  if (chip === null) return;
  event.stopPropagation();
  if (event.type !== "click") return;
  event.preventDefault();
  const tag = chip.dataset.tag ?? null;
  setFilter(scopedFilter() === tag ? null : tag);
}

const CHIP_EVENTS = ["click", "pointerdown", "mousedown", "dblclick"] as const;

export function watchChipClicks(): () => void {
  for (const type of CHIP_EVENTS) document.addEventListener(type, onChipEvent, true);
  return () => {
    for (const type of CHIP_EVENTS) document.removeEventListener(type, onChipEvent, true);
  };
}

export function clearRows(): void {
  for (const node of document.querySelectorAll(".t3tags-chips")) node.remove();
  for (const node of document.querySelectorAll(`[${HIDDEN}]`)) node.removeAttribute(HIDDEN);
}

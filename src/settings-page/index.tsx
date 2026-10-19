/**
 * Adds an "Extensions" section to the app's Settings. The app's settings routes are
 * fixed, so the page isn't a route: a nav item cloned from the app's own opens it
 * over whichever section is showing, and any other nav item, or leaving Settings,
 * closes it. Selectors follow `SettingsSidebarNav.tsx` and `routes/settings.tsx`.
 */

import { createElement, Puzzle } from "lucide";
import { render } from "preact";

import { activeRoute } from "../app.ts";
import uiStyles from "../ui/ui.css";
import { ExtensionsPage } from "./ExtensionsPage.tsx";
import pageStyles from "./page.css";
import { isPageOpen, setPageOpen, subscribePage } from "./state.ts";

const NAV = '[data-slot="sidebar-content"] ul[data-slot="sidebar-menu"]:not([role])';
const NAV_BUTTON = '[data-slot="sidebar-menu-button"]';
/** The settings layout's column: the header, then the routed section. */
const COLUMN = 'main[data-slot="sidebar-inset"] > div';
const BREADCRUMB = 'nav[aria-label="Settings breadcrumb"] ol';

const LABEL = "Extensions";

/** A copy of one of the app's nav items, so it picks up their look. */
function createNavItem(nav: Element): HTMLElement | null {
  const item = nav.querySelector(":scope > li")?.cloneNode(true);
  if (!(item instanceof HTMLElement)) return null;
  const button = item.querySelector<HTMLElement>(NAV_BUTTON);
  if (button === null) return null;
  item.dataset.t3ext = "";
  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = LABEL;
  button.replaceChildren(createElement(Puzzle), label);
  button.addEventListener("click", () => setPageOpen(true));
  return item;
}

function createCrumb(current: Element): HTMLElement {
  const crumb = current.cloneNode(false) as HTMLElement;
  crumb.dataset.t3ext = "";
  crumb.textContent = LABEL;
  return crumb;
}

/**
 * The routed section's nav item, unselected while the page is open. React only
 * rewrites `data-active` when its own value changes, so it stays as set here.
 */
const unselected = new Set<Element>();

function restoreSelection(): void {
  for (const button of unselected) button.setAttribute("data-active", "true");
  unselected.clear();
}

export function mountSettingsPage(): void {
  const style = document.createElement("style");
  style.id = "t3ext-core-styles";
  style.textContent = `${uiStyles}\n${pageStyles}`;
  document.head.append(style);

  const page = document.createElement("div");
  page.id = "t3ext-settings-page";
  let rendered = false;
  let navItem: HTMLElement | null = null;
  let crumb: HTMLElement | null = null;

  const sync = () => {
    frame = 0;
    const onSettings = activeRoute().startsWith("/settings/");
    if (!onSettings) setPageOpen(false);
    const open = isPageOpen();
    document.documentElement.toggleAttribute("data-t3ext-page", open);

    const nav = onSettings ? document.querySelector(NAV) : null;
    if (nav !== null) {
      navItem ??= createNavItem(nav);
      if (navItem !== null && navItem.parentElement !== nav) nav.append(navItem);
    }
    navItem?.querySelector(NAV_BUTTON)?.setAttribute("data-active", String(open));
    if (open && nav !== null) {
      const selected = `li:not([data-t3ext]) > ${NAV_BUTTON}[data-active="true"]`;
      for (const button of nav.querySelectorAll(selected)) {
        button.setAttribute("data-active", "false");
        unselected.add(button);
      }
    } else if (!open) {
      restoreSelection();
    }

    const breadcrumb = open ? document.querySelector(BREADCRUMB) : null;
    const current = breadcrumb?.querySelector('li[aria-current="page"]:not([data-t3ext])');
    if (breadcrumb && current) {
      crumb ??= createCrumb(current);
      if (crumb.parentElement !== breadcrumb) breadcrumb.append(crumb);
    } else {
      crumb?.remove();
    }

    const column = open ? document.querySelector(COLUMN) : null;
    if (column !== null) {
      if (page.parentElement !== column) column.append(page);
      if (!rendered) render(<ExtensionsPage />, page);
      rendered = true;
    } else if (rendered) {
      render(null, page);
      page.remove();
      rendered = false;
    }
  };

  let frame = 0;
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(sync);
  };
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true });
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  subscribePage(schedule);

  // Any of the app's own nav items or search results takes over from the page.
  document.addEventListener(
    "click",
    (event) => {
      const button = (event.target as Element | null)?.closest?.(NAV_BUTTON);
      if (!button || button.closest("[data-t3ext]")) return;
      // Before React handles the click, so its own update of `data-active` wins.
      restoreSelection();
      setPageOpen(false);
    },
    true,
  );
  sync();
}

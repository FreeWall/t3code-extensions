/**
 * Actions on the running app. Which project the sidebar is filtered to lives only in
 * the app's client store, so the rail reads it from, and drives, the sidebar's own
 * "Filter threads by project" picker. Selectors here follow `Sidebar.tsx`; expect to
 * touch them when a nightly reshapes the sidebar header.
 */

const SCOPE_TRIGGER = 'button[aria-label^="Filter threads by project"]';
const SCOPE_LABEL_PREFIX = "Filter threads by project: ";
const WAIT_TIMEOUT_MS = 1500;

const scopeTrigger = (): HTMLElement | null => document.querySelector(SCOPE_TRIGGER);

/** Display name of the project the sidebar is filtered to; null for all projects. */
export function readScopeLabel(): string | null {
  const label = scopeTrigger()?.getAttribute("aria-label") ?? "";
  return label.startsWith(SCOPE_LABEL_PREFIX) ? label.slice(SCOPE_LABEL_PREFIX.length) : null;
}

/** Current route path, `/…`, under hash routing (desktop) or the pathname (browser). */
export function activeRoute(): string {
  return window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1).split("?")[0]!
    : window.location.pathname;
}

/** Calls back whenever the sidebar's scope may have changed. */
export function watchScope(onChange: () => void): () => void {
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-label"],
  });
  return () => observer.disconnect();
}

export function waitFor<T>(find: () => T | null | undefined): Promise<T | null> {
  return new Promise((resolve) => {
    const found = find();
    if (found) return resolve(found);
    const deadline = performance.now() + WAIT_TIMEOUT_MS;
    const tick = () => {
      const next = find();
      if (next) resolve(next);
      else if (performance.now() > deadline) resolve(null);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Base UI listens to pointer events as well as clicks; send the whole sequence. */
function press(element: HTMLElement): void {
  const init = { bubbles: true, cancelable: true, composed: true, button: 0, pointerType: "mouse" };
  element.dispatchEvent(new PointerEvent("pointerdown", init));
  element.dispatchEvent(new MouseEvent("mousedown", init));
  element.dispatchEvent(new PointerEvent("pointerup", init));
  element.dispatchEvent(new MouseEvent("mouseup", init));
  element.click();
}

const optionLabel = (option: Element): string =>
  (option.querySelector(".truncate")?.textContent ?? option.textContent ?? "").trim();

/**
 * Client-side navigation. The desktop window uses hash routing (`t3code://app/#/…`);
 * assigning the hash fires the popstate TanStack Router listens to.
 */
export function navigate(path: string): void {
  if (window.location.hash.startsWith("#/")) {
    if (window.location.hash !== `#${path}`) window.location.hash = path;
    return;
  }
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
}

/**
 * Filters the sidebar to the project with this display name, or to all projects when
 * `label` is null. Routes without the thread sidebar (Settings) go home first.
 */
export async function selectScope(label: string | null): Promise<boolean> {
  if (readScopeLabel() === label) return true;
  if (scopeTrigger() === null) navigate("/");
  const trigger = await waitFor(scopeTrigger);
  if (trigger === null) return false;

  const listbox = () => document.querySelector('[role="listbox"]');
  if (listbox() === null) trigger.click();
  if ((await waitFor(listbox)) === null) {
    press(trigger);
    if ((await waitFor(listbox)) === null) return false;
  }
  const option = await waitFor(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((candidate) =>
      label === null ? optionLabel(candidate) === "All projects" : optionLabel(candidate) === label,
    ),
  );
  if (option === null) {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    return false;
  }
  option.click();
  if ((await waitFor(() => readScopeLabel() === label || null)) === null) press(option);
  return readScopeLabel() === label;
}

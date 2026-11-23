/**
 * Projects and threads of the app's other environments (remote ones saved under
 * Connections), read live from the app's own state: the effect atom registry its
 * React tree is given (`AppAtomRegistryProvider` in `rpc/atomRegistry.ts`). Each
 * environment's shell is the `environment-snapshot:<environmentId>` atom
 * (`client-runtime/state/snapshots.ts`), the same snapshot `orchestration.subscribeShell`
 * sends, decoded. Expect to touch the labels when a nightly renames them.
 */

import { record } from "./json.ts";
import { applyShellItem, clearEnvironment, getState } from "./store.ts";

const SNAPSHOT_LABEL = "environment-snapshot:";
const POLL_MS = 1000;
/** The provider sits near the top of the tree; give up long before walking all of it. */
const MAX_FIBERS = 5000;

interface Atom {
  readonly label?: readonly [string, string];
}

interface Registry {
  getNodes(): ReadonlyMap<unknown, { readonly atom: Atom }>;
  get(atom: Atom): unknown;
}

interface Fiber {
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
  readonly memoizedProps: unknown;
}

const isRegistry = (value: unknown): value is Registry =>
  typeof record(value)?.getNodes === "function" && typeof record(value)?.get === "function";

/** Walks React's fiber tree from the root container to the registry provider's value. */
function findRegistry(): Registry | null {
  for (const element of document.body.querySelectorAll(":scope > *")) {
    const key = Object.keys(element).find((name) => name.startsWith("__reactContainer$"));
    if (key === undefined) continue;
    const stack = [(element as unknown as Record<string, Fiber | null>)[key]];
    for (let visited = 0; stack.length > 0 && visited < MAX_FIBERS; visited++) {
      const fiber = stack.pop();
      if (!fiber) continue;
      const value = record(fiber.memoizedProps)?.value;
      if (isRegistry(value)) return value;
      stack.push(fiber.sibling, fiber.child);
    }
  }
  return null;
}

let registry: Registry | null = null;
/** Snapshots applied last, by environment; atoms keep the same object while unchanged. */
const applied = new Map<string, unknown>();

function poll(): void {
  registry ??= findRegistry();
  if (registry === null) return;
  const primary = getState().primaryEnvironmentId;
  for (const { atom } of registry.getNodes().values()) {
    const label = atom.label?.[0];
    if (!label?.startsWith(SNAPSHOT_LABEL)) continue;
    const environmentId = label.slice(SNAPSHOT_LABEL.length);
    // The window's own environment comes live over its socket.
    if (environmentId === primary) continue;
    const snapshot = registry.get(atom);
    if (applied.get(environmentId) === snapshot) continue;
    applied.set(environmentId, snapshot);
    // Null once the environment is removed or switched off under Connections. An atom
    // missing altogether only means no thread list is on screen, so its rows stay.
    if (snapshot === null || snapshot === undefined) clearEnvironment(environmentId);
    // Back to the wire's JSON: dates are DateTime objects, whose toJSON is ISO.
    else applyShellItem(environmentId, { kind: "snapshot", snapshot: JSON.parse(JSON.stringify(snapshot)) });
  }
}

export function watchAppState(): void {
  setInterval(() => {
    try {
      poll();
    } catch (error) {
      registry = null;
      console.warn("[t3ext] app state unreadable", error);
    }
  }, POLL_MS);
}

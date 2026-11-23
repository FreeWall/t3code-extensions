/**
 * Projects and threads of the app's other environments (remote ones saved under
 * Connections), read from the shell cache the app keeps in IndexedDB
 * (`apps/web/src/connection/storage.ts`): one JSON row per environment, the same
 * snapshot `orchestration.subscribeShell` sends. No socket of our own: the app is the
 * one connected. It saves a changed shell at most every 10 seconds, so badges for
 * these environments trail the app's sidebar by that much.
 */

import { record, string } from "./json.ts";
import { applyShellItem, clearEnvironment, getState } from "./store.ts";

const DATABASE_NAME = "t3code:connection-runtime";
const SHELL_STORE_NAME = "shell";
const POLL_MS = 3000;

let database: IDBDatabase | null = null;

/** Opens the app's database only once the app has made it, so an upgrade stays the app's. */
async function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database;
  const existing = await indexedDB.databases();
  if (!existing.some((entry) => entry.name === DATABASE_NAME)) return null;
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const opened = request.result;
      // The app bumping its version must not wait on us.
      opened.onversionchange = () => {
        opened.close();
        database = null;
      };
      database = opened;
      resolve(opened);
    };
  });
}

/** Every cached shell row, keyed by environment id. */
async function readShells(): Promise<Map<string, string>> {
  const opened = await openDatabase();
  if (!opened?.objectStoreNames.contains(SHELL_STORE_NAME)) return new Map();
  return new Promise((resolve, reject) => {
    const store = opened.transaction(SHELL_STORE_NAME, "readonly").objectStore(SHELL_STORE_NAME);
    const keys = store.getAllKeys();
    const values = store.getAll();
    values.onerror = () => reject(values.error);
    values.onsuccess = () =>
      resolve(
        new Map(
          keys.result.flatMap((key, index) => {
            const value = values.result[index];
            return typeof key === "string" && typeof value === "string" ? [[key, value] as const] : [];
          }),
        ),
      );
  });
}

/** Rows applied last, so an unchanged one isn't parsed again. */
const applied = new Map<string, string>();

async function poll(): Promise<void> {
  const shells = await readShells();
  // The window's own environment comes live over its socket.
  const primary = getState().primaryEnvironmentId;
  for (const [environmentId, raw] of shells) {
    if (environmentId === primary) {
      applied.delete(environmentId);
      continue;
    }
    if (applied.get(environmentId) === raw) continue;
    applied.set(environmentId, raw);
    const stored = record(JSON.parse(raw));
    if (string(stored?.environmentId) !== environmentId) continue;
    applyShellItem(environmentId, { kind: "snapshot", snapshot: stored?.snapshot });
  }
  // Removed under Connections: the app drops its cache row too.
  for (const environmentId of applied.keys()) {
    if (shells.has(environmentId)) continue;
    applied.delete(environmentId);
    clearEnvironment(environmentId);
  }
}

export function watchAppCache(): void {
  const tick = () =>
    poll()
      .catch((error: unknown) => console.warn("[t3ext] app shell cache unreadable", error))
      .finally(() => setTimeout(tick, POLL_MS));
  void tick();
}

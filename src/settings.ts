/**
 * Extension settings, kept in `~/.config/t3code-extensions/settings.json` with one
 * object per extension (`{ "rail": {...}, "usage": {...} }`). The page can't touch
 * the disk, so the file goes through the backend's `projects.readFile`/`writeFile`
 * (see `connection.ts`). A localStorage copy lets extensions render the last known
 * settings before the socket is up; the file wins once it has been read.
 */

import { type Json, record } from "./json.ts";

/** Reads and writes the settings file; `read` resolves null when it doesn't exist. */
export interface SettingsFile {
  readonly path: string;
  readonly read: () => Promise<string | null>;
  readonly write: (contents: string) => Promise<void>;
}

const CACHE_KEY = "t3ext:settings";

/**
 * Relative to the server's home. The server only writes inside registered projects,
 * so this directory is added as one; `isSettingsProject` keeps it off the rail.
 */
export const SETTINGS_DIRECTORY = ".config/t3code-extensions";

export const isSettingsProject = (workspaceRoot: string): boolean =>
  workspaceRoot.replace(/\/+$/, "").endsWith(`/${SETTINGS_DIRECTORY}`);

function parse(text: string | null): Json | undefined {
  try {
    return record(JSON.parse(text ?? "null"));
  } catch {
    return undefined;
  }
}

/** Keys no extension knows survive a write, so a hand edit isn't lost. */
let raw: Json = parse(localStorage.getItem(CACHE_KEY)) ?? {};
let file: SettingsFile | null = null;
/** The file is read once per page load; later sessions only write to it. */
let loaded = false;
/** A change made while the file was unreachable, written once it is back. */
let unsaved = false;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function apply(next: Json): void {
  raw = next;
  localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

function save(): void {
  const target = file;
  if (target === null) {
    unsaved = true;
    return;
  }
  const contents = `${JSON.stringify(raw, null, 2)}\n`;
  writing = writing
    .then(() => target.write(contents))
    .then(
      () => {
        unsaved = false;
      },
      (error) => {
        unsaved = true;
        console.warn("[t3ext] could not save settings", error);
      },
    );
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const settingsPath = (): string | null => file?.path ?? null;

export interface SettingsSection<T> {
  /** Stable between changes to the section, so it works with `useSyncExternalStore`. */
  readonly get: () => T;
  readonly subscribe: (listener: () => void) => () => void;
  readonly update: (patch: Partial<T>) => void;
}

/** One extension's typed slice of the file, under `key`; `decode` fills in defaults. */
export function settingsSection<T>(key: string, decode: (raw: Json) => T): SettingsSection<T> {
  let cached: { readonly source: unknown; readonly value: T } | undefined;
  return {
    get: () => {
      if (cached === undefined || cached.source !== raw[key]) {
        cached = { source: raw[key], value: decode(record(raw[key]) ?? {}) };
      }
      return cached.value;
    },
    subscribe: subscribeSettings,
    update: (patch) => {
      apply({ ...raw, [key]: { ...record(raw[key]), ...patch } });
      save();
    },
  };
}

/** Reads the file, picking up hand edits; unsaved local changes win over it. */
async function load(target: SettingsFile): Promise<void> {
  const text = await target.read();
  if (file !== target) return;
  loaded = true;
  const parsed = parse(text);
  if (text === null || unsaved) {
    save();
  } else if (parsed === undefined) {
    // Don't overwrite a file the user is halfway through editing.
    console.warn(`[t3ext] ${target.path} is not a JSON object; keeping the current settings`);
  } else if (JSON.stringify(parsed) !== JSON.stringify(raw)) {
    apply(parsed);
  }
}

/** Called by the connection once per session; null while offline. */
export function attachSettingsFile(target: SettingsFile | null): void {
  file = target;
  for (const listener of listeners) listener();
  if (target === null) return;
  if (loaded) {
    if (unsaved) save();
    return;
  }
  void load(target).catch((error) => {
    // An unreadable file must not be replaced with defaults.
    if (file === target) file = null;
    console.warn("[t3ext] could not read settings", error);
  });
}

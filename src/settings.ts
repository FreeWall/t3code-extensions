/**
 * Rail settings, kept in `~/.config/t3code-rail/settings.json`. The page can't touch
 * the disk, so the file goes through the backend's `projects.readFile`/`writeFile`
 * (see `connection.ts`). A localStorage copy lets the rail render the last known
 * settings before the socket is up; the file wins once it has been read.
 */

export interface RailSettings {
  /** "app" follows the sidebar's own project order instead of `projectOrder`. */
  readonly projectSort: "manual" | "app";
  /** Project ids in the order dragged on the rail. */
  readonly projectOrder: ReadonlyArray<string>;
  /** Project ids left off the rail; the app's own project picker still lists them. */
  readonly hiddenProjects: ReadonlyArray<string>;
  /** Provider instance ids in the order dragged on the header usage bar. */
  readonly usageOrder: ReadonlyArray<string>;
}

/** Reads and writes the settings file; `read` resolves null when it doesn't exist. */
export interface SettingsFile {
  readonly path: string;
  readonly read: () => Promise<string | null>;
  readonly write: (contents: string) => Promise<void>;
}

const CACHE_KEY = "t3rail:settings";
/** Where the drag order lived before the settings file. */
const LEGACY_ORDER_KEY = "t3rail:project-order";

type Json = Record<string, unknown>;

const record = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function parse(text: string | null): Json | undefined {
  try {
    return record(JSON.parse(text ?? "null"));
  } catch {
    return undefined;
  }
}

const toSettings = (raw: Json): RailSettings => ({
  projectSort: raw.projectSort === "app" ? "app" : "manual",
  projectOrder: strings(raw.projectOrder),
  hiddenProjects: strings(raw.hiddenProjects),
  usageOrder: strings(raw.usageOrder),
});

function legacyOrder(): string[] {
  try {
    return strings(JSON.parse(localStorage.getItem(LEGACY_ORDER_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/** Keys the rail doesn't know survive a write, so a hand edit isn't lost. */
let raw: Json = parse(localStorage.getItem(CACHE_KEY)) ?? { projectOrder: legacyOrder() };
let settings = toSettings(raw);
let file: SettingsFile | null = null;
/** The file is read once per page load; later sessions only write to it. */
let loaded = false;
/** A change made while the file was unreachable, written once it is back. */
let unsaved = false;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function apply(next: Json): void {
  raw = next;
  settings = toSettings(next);
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
        console.warn("[rail] could not save settings", error);
      },
    );
}

export const getSettings = (): RailSettings => settings;

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateSettings(patch: Partial<RailSettings>): void {
  apply({ ...raw, ...patch });
  save();
}

export const settingsPath = (): string | null => file?.path ?? null;

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
    console.warn(`[rail] ${target.path} is not a JSON object; keeping the current settings`);
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
    console.warn("[rail] could not read settings", error);
  });
}

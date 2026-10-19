/**
 * Mounts the extensions that are switched on, and unmounts one the moment it is
 * switched off; `extensions.disabled` in the settings file lists the ones that are off.
 */

import type { Extension } from "./extension.ts";
import { strings } from "./json.ts";
import { rail } from "./rail/index.tsx";
import { settingsSection } from "./settings.ts";
import { usage } from "./usage/index.ts";

export const extensions: ReadonlyArray<Extension> = [rail, usage];

export const extensionSettings = settingsSection("extensions", (raw) => ({
  /** Names of switched-off extensions, so a new one starts switched on. */
  disabled: strings(raw.disabled),
}));

export function setEnabled(name: string, enabled: boolean): void {
  const others = extensionSettings.get().disabled.filter((other) => other !== name);
  extensionSettings.update({ disabled: enabled ? others : [...others, name] });
}

/** Unmount of each running extension, by name. */
const running = new Map<string, () => void>();

function start(extension: Extension): () => void {
  const style = document.createElement("style");
  style.dataset.t3ext = extension.name;
  style.textContent = extension.styles;
  document.head.append(style);
  const unmount = extension.mount();
  return () => {
    unmount();
    style.remove();
  };
}

function sync(): void {
  const disabled = new Set(extensionSettings.get().disabled);
  for (const extension of extensions) {
    const stop = running.get(extension.name);
    if (disabled.has(extension.name)) {
      if (stop === undefined) continue;
      running.delete(extension.name);
      stop();
    } else if (stop === undefined) {
      running.set(extension.name, start(extension));
    }
  }
}

export function startExtensions(): void {
  sync();
  extensionSettings.subscribe(sync);
}

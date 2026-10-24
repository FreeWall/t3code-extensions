import type { IconNode } from "lucide";
import type { ComponentType } from "preact";

/** One self-contained customization; `host.ts` injects its styles and mounts it. */
export interface Extension {
  /** Stable id, also its key in the settings file. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly icon: IconNode;
  readonly styles: string;
  /** Starts the extension; returns what undoes it, so it can be switched off live. */
  readonly mount: () => () => void;
  /** Its detail on the Extensions settings page, made of `Section`s. */
  readonly Settings?: ComponentType;
}

/** One self-contained customization; `main.tsx` injects its styles and mounts it. */
export interface Extension {
  readonly name: string;
  readonly styles: string;
  readonly mount: () => void;
}

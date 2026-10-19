/**
 * Controls for the Extensions settings page, styled after the app's own settings
 * (`SettingsGroup`, `SettingsRow`, `Switch`); see `ui.css`.
 */

import type { IconNode } from "lucide";
import { createElement, type ComponentChildren } from "preact";

export function Icon({ node, class: className }: { node: IconNode; class?: string }) {
  return (
    <svg
      class={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {node.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))}
    </svg>
  );
}

export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ComponentChildren;
}) {
  return (
    <div class="t3ext-row">
      <div class="t3ext-row-text">
        <div class="t3ext-row-title">{title}</div>
        {description ? <div class="t3ext-row-description">{description}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Switch({
  checked,
  label,
  title,
  onChange,
}: {
  checked: boolean;
  label: string;
  title?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      class="t3ext-switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <span class="t3ext-switch-thumb" />
    </button>
  );
}

/** Up/down arrows for reordering a settings list, after the app's model list. */
export function MoveButtons({
  name,
  index,
  count,
  disabled = false,
  onMove,
}: {
  name: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <>
      <button
        type="button"
        class="t3ext-move"
        title="Move up"
        aria-label={`Move ${name} up`}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
      </button>
      <button
        type="button"
        class="t3ext-move"
        title="Move down"
        aria-label={`Move ${name} down`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      </button>
    </>
  );
}

export function Segmented<T extends string>({
  value,
  label,
  options,
  onChange,
}: {
  value: T;
  label: string;
  options: ReadonlyArray<{ readonly value: T; readonly label: string; readonly title?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div class="t3ext-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

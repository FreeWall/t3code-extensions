import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "preact/compat";

import { getState, subscribe } from "../store.ts";
import { usePopover } from "./popover.ts";
import { MAX_TAG_LENGTH, normalizeTag, removeTag, renameTag, tagHue, threadsInScope } from "./tags.ts";

export interface TagRenameProps {
  readonly tag: string;
  /** The sidebar's project scope when opened; null renames across all projects. */
  readonly scopeLabel: string | null;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}

/** Popover that renames a filter bar tag, or removes it, on every thread in the bar's scope. */
export function TagRename({ tag, scopeLabel, x, y, onClose }: TagRenameProps) {
  const state = useSyncExternalStore(subscribe, getState);
  const scoped = useMemo(() => threadsInScope(state, scopeLabel), [state.threads, state.projects, scopeLabel]);
  const count = scoped.filter((thread) => thread.tags.includes(tag)).length;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Removing asks for a second click. */
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref, position } = usePopover({ x, y, layoutKey: error, onClose });

  // Focus without scrolling the sidebar under the popover.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);

  /** Blank, invalid or unchanged names just close. */
  const submit = () => {
    const to = normalizeTag(inputRef.current?.value ?? "");
    if (to === null || to === tag) return onClose();
    setSaving(true);
    setError(null);
    renameTag(scoped, tag, to).then(onClose, () => {
      setSaving(false);
      setError("Couldn't rename the tag");
    });
  };

  const remove = () => {
    if (!confirmRemove) return setConfirmRemove(true);
    setSaving(true);
    setError(null);
    removeTag(scoped, tag).then(onClose, () => {
      setSaving(false);
      setConfirmRemove(false);
      setError("Couldn't remove the tag");
    });
  };

  return (
    <div
      ref={ref}
      class="t3tags-editor"
      role="dialog"
      aria-label={`Edit “${tag}”`}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
    >
      <div class="t3tags-editor-title">
        Rename{" "}
        <span class="t3tags-chip" style={{ "--t3tag-hue": String(tagHue(tag)) }}>
          {tag}
        </span>
      </div>
      <form
        class="t3tags-rename-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          class="t3tags-editor-input"
          type="text"
          aria-label="New name"
          maxLength={MAX_TAG_LENGTH}
          defaultValue={tag}
          disabled={saving}
        />
        <button type="submit" class="t3tags-rename-submit" disabled={saving}>
          Rename
        </button>
      </form>
      <div class="t3tags-rename-hint">
        {count} {count === 1 ? "thread" : "threads"} in {scopeLabel ?? "all projects"}. An existing name merges.
      </div>
      <button
        type="button"
        class="t3tags-remove"
        data-confirm={confirmRemove ? "" : undefined}
        disabled={saving}
        onClick={remove}
      >
        {confirmRemove ? `Click again to remove from ${count} ${count === 1 ? "thread" : "threads"}` : "Remove tag"}
      </button>
      {error ? <div class="t3tags-editor-error">{error}</div> : null}
    </div>
  );
}

import { Pencil } from "lucide";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "preact/compat";

import { getState, subscribe } from "../store.ts";
import { Icon } from "../ui/index.tsx";
import { usePopover } from "./popover.ts";
import { countTags, MAX_TAG_LENGTH, normalizeTag, renameTag, setThreadTag, tagHue } from "./tags.ts";

export interface TagEditorProps {
  readonly threadId: string;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}

/** Popover that toggles a thread's tags, adds new ones and renames them across the project. */
export function TagEditor({ threadId, x, y, onClose }: TagEditorProps) {
  const state = useSyncExternalStore(subscribe, getState);
  const thread = state.threads.get(threadId);
  // Suggests the tags of the thread's own project.
  const projectId = thread?.projectId;
  const projectThreads = useMemo(
    () => [...state.threads.values()].filter((other) => other.projectId === projectId),
    [state.threads, projectId],
  );
  const known = useMemo(() => countTags(projectThreads), [projectThreads]);
  const [draft, setDraft] = useState("");
  /** The tag whose name is being edited. */
  const [renaming, setRenaming] = useState<string | null>(null);
  // Enter and the blur when the field unmounts would both commit; only the first counts.
  const committed = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref, position } = usePopover({
    x,
    y,
    layoutKey: known.length,
    onClose,
    // Escape while renaming cancels the rename; the blur as its field unmounts must not commit.
    onEscape:
      renaming === null
        ? onClose
        : () => {
            committed.current = true;
            setRenaming(null);
          },
  });

  // Focus without scrolling the sidebar under the popover.
  useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);

  // The thread was archived or deleted while open.
  useEffect(() => {
    if (state.status === "live" && thread === undefined) onClose();
  }, [state.status, thread, onClose]);
  if (thread === undefined) return null;

  const toggle = (tag: string, tagged: boolean) => {
    setError(null);
    setThreadTag(thread, tag, tagged).catch(() => setError("Couldn't save the tag"));
  };

  /** Reads the field itself: a fast Enter can beat the render that stores the last keystroke. */
  const add = (value: string) => {
    const tag = normalizeTag(value);
    if (tag === null) return;
    setDraft("");
    if (!thread.tags.includes(tag)) toggle(tag, true);
  };

  /** Reads the field itself, like `add`. Blank, invalid or unchanged names just cancel. */
  const rename = (from: string, value: string) => {
    if (committed.current) return;
    committed.current = true;
    setRenaming(null);
    const to = normalizeTag(value);
    if (to === null || to === from) return;
    setError(null);
    renameTag(projectThreads, from, to).catch(() => setError("Couldn't rename the tag"));
  };

  const tags = [...new Set([...known.map((entry) => entry.tag), ...thread.tags])];

  return (
    <div
      ref={ref}
      class="t3tags-editor"
      role="dialog"
      aria-label={`Tags for ${thread.title}`}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
    >
      <div class="t3tags-editor-title">{thread.title || "Untitled thread"}</div>
      {tags.length > 0 ? (
        <ul class="t3tags-editor-list">
          {tags.map((tag) => {
            const checked = thread.tags.includes(tag);
            return (
              <li key={tag} class="t3tags-editor-item">
                {renaming === tag ? (
                  <input
                    class="t3tags-editor-input t3tags-editor-rename"
                    type="text"
                    aria-label={`Rename “${tag}”`}
                    maxLength={MAX_TAG_LENGTH}
                    defaultValue={tag}
                    ref={(input) => input?.focus({ preventScroll: true })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        rename(tag, event.currentTarget.value);
                      }
                    }}
                    onBlur={(event) => rename(tag, event.currentTarget.value)}
                  />
                ) : (
                  <>
                    <label class="t3tags-editor-option">
                      <input type="checkbox" checked={checked} onChange={() => toggle(tag, !checked)} />
                      <span class="t3tags-chip" style={{ "--t3tag-hue": String(tagHue(tag)) }}>
                        {tag}
                      </span>
                    </label>
                    <button
                      type="button"
                      class="t3tags-editor-rename-button"
                      title={`Rename “${tag}” in this project`}
                      aria-label={`Rename “${tag}”`}
                      onClick={() => {
                        committed.current = false;
                        setRenaming(tag);
                      }}
                    >
                      <Icon node={Pencil} class="t3tags-chip-icon" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <input
        class="t3tags-editor-input"
        type="text"
        placeholder="New tag…"
        maxLength={MAX_TAG_LENGTH}
        value={draft}
        ref={inputRef}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(event.currentTarget.value);
          }
        }}
      />
      {error ? <div class="t3tags-editor-error">{error}</div> : null}
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "preact/compat";

import { getState, subscribe } from "../store.ts";
import { countTags, MAX_TAG_LENGTH, normalizeTag, setThreadTag, tagHue } from "./tags.ts";

export interface TagEditorProps {
  readonly threadId: string;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}

const MARGIN = 8;

/** Popover that toggles a thread's tags and adds new ones. */
export function TagEditor({ threadId, x, y, onClose }: TagEditorProps) {
  const state = useSyncExternalStore(subscribe, getState);
  const thread = state.threads.get(threadId);
  // Suggests the tags of the thread's own project.
  const projectId = thread?.projectId;
  const known = useMemo(
    () => countTags([...state.threads.values()].filter((other) => other.projectId === projectId)),
    [state.threads, projectId],
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the popover on screen.
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN)),
    });
  }, [x, y, known.length]);

  // Focus without scrolling the sidebar under the popover.
  useEffect(() => inputRef.current?.focus({ preventScroll: true }), []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose]);

  // The thread was archived or deleted while open.
  useEffect(() => {
    if (state.status === "live" && thread === undefined) onClose();
  }, [state.status, thread, onClose]);
  if (thread === undefined) return null;

  const toggle = (tag: string, tagged: boolean) => {
    setError(null);
    setThreadTag(threadId, tag, tagged).catch(() => setError("Couldn't save the tag"));
  };

  /** Reads the field itself: a fast Enter can beat the render that stores the last keystroke. */
  const add = (value: string) => {
    const tag = normalizeTag(value);
    if (tag === null) return;
    setDraft("");
    if (!thread.tags.includes(tag)) toggle(tag, true);
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
              <li key={tag}>
                <label class="t3tags-editor-option">
                  <input type="checkbox" checked={checked} onChange={() => toggle(tag, !checked)} />
                  <span class="t3tags-chip" style={{ "--t3tag-hue": String(tagHue(tag)) }}>
                    {tag}
                  </span>
                </label>
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

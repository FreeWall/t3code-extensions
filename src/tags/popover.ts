import { useEffect, useLayoutEffect, useRef, useState } from "preact/compat";
import type { RefObject } from "preact";

const MARGIN = 8;

/**
 * A fixed popover at (x, y), kept on screen and re-measured when `layoutKey` changes.
 * A press outside closes it; Escape calls `onEscape`, by default `onClose`.
 */
export function usePopover({
  x,
  y,
  layoutKey,
  onClose,
  onEscape = onClose,
}: {
  x: number;
  y: number;
  layoutKey?: unknown;
  onClose: () => void;
  onEscape?: () => void;
}): { ref: RefObject<HTMLDivElement>; position: { left: number; top: number } } {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - rect.height - MARGIN)),
    });
  }, [x, y, layoutKey]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onEscape();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, onEscape]);

  return { ref, position };
}

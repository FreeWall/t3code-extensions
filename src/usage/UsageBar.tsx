import { render } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "preact/compat";

import { usageSettings } from "./settings.ts";

// https://github.com/pingdotgg/t3code/discussions/11563

import {
  formatDuration,
  getUsage,
  isExpired,
  refreshProvider,
  remainingPercent,
  subscribeUsage,
  type ProviderUsage,
  type UsageWindow,
} from "./limits.ts";
import { ClaudeIcon, OpenAIIcon } from "./icons.tsx";

/**
 * The thread header's title row: `ChatHeader.tsx` renders it as the header's child
 * holding the "Thread breadcrumb" nav, padded on the right for the panel controls.
 * Expect to touch this when a nightly reshapes the header.
 */
const HEADER_ROW = 'header[data-chat-header] > div:has(> nav[aria-label="Thread breadcrumb"])';
const TICK_MS = 30_000;

/** How each provider shows in the header, as in the discussion's "Usage meters" setting. */
type UsageBarVariant = "off" | "bars" | "percent" | "barsAndPercent";
const VARIANT: UsageBarVariant = "barsAndPercent";
/** Time until the % window resets, after the % label (`60% · 2h 13m`). */
const SHOW_RESET = true;

/** Below this much quota left, the bar and number turn red. */
const LOW_PERCENT = 20;

/** Brand colour per driver; others use their instance accent, then the text colour. */
const DRIVER_COLORS: Record<string, string> = {
  claudeAgent: "#d97757",
  codex: "currentColor",
};

function ProviderIcon({ provider }: { provider: ProviderUsage }) {
  switch (provider.driver) {
    case "claudeAgent":
      return <ClaudeIcon class="t3usage-icon" />;
    case "codex":
      return <OpenAIIcon class="t3usage-icon" />;
    default:
      return <span class="t3usage-icon t3usage-monogram">{provider.name.slice(0, 1)}</span>;
  }
}

const remainingNow = (window: UsageWindow, now: number): number | null =>
  isExpired(window, now) ? null : remainingPercent(window);

function Bars({ windows, now }: { windows: ReadonlyArray<UsageWindow>; now: number }) {
  return (
    <span class="t3usage-bars">
      {windows.map((window) => {
        const remaining = remainingNow(window, now);
        return (
          <span
            key={window.id}
            class="t3usage-track"
            data-low={remaining !== null && remaining < LOW_PERCENT}
          >
            <span class="t3usage-fill" style={{ width: `${remaining ?? 0}%` }} />
          </span>
        );
      })}
    </span>
  );
}

function resetsIn(window: UsageWindow, now: number): string {
  if (window.resetsAt === null) return "";
  return window.resetsAt <= now
    ? "reset, awaiting new reading"
    : `resets in ${formatDuration(window.resetsAt - now)}`;
}

function Details({ provider, now }: { provider: ProviderUsage; now: number }) {
  return (
    <div class="t3usage-popover" role="tooltip">
      <div class="t3usage-popover-title">{provider.name}</div>
      {provider.windows.map((window) => (
        <div key={window.id} class="t3usage-row">
          <span>{window.label}</span>
          <span class="t3usage-row-value">
            {isExpired(window, now) ? "–" : `${remainingPercent(window)}% left`}
          </span>
          <span class="t3usage-row-reset">{resetsIn(window, now)}</span>
        </div>
      ))}
      {provider.notice ? <div class="t3usage-row-reset">{provider.notice}</div> : null}
      <div class="t3usage-popover-footer">
        {provider.checkedAt === null
          ? "Click to refresh"
          : `Checked ${formatDuration(now - provider.checkedAt)} ago · click to refresh`}
      </div>
    </div>
  );
}

interface ChipProps {
  readonly provider: ProviderUsage;
  readonly now: number;
  readonly dragging: boolean;
  readonly slotRef: (el: HTMLDivElement | null) => void;
  readonly onPointerDown: (event: PointerEvent) => void;
}

function ProviderChip({ provider, now, dragging, slotRef, onPointerDown }: ChipProps) {
  // Session (top bar) and weekly (bottom) carry the signal; the rest (per-model, monthly) live in the popover.
  const primary = provider.windows.filter(
    (window) => window.kind === "session" || window.kind === "weekly",
  );
  const shown = primary.length > 0 ? primary : provider.windows.slice(0, 2);
  // The number is the session window; providers without one show their first window.
  const headline = shown.find((window) => window.kind === "session") ?? shown[0];
  const percent = headline ? remainingNow(headline, now) : null;
  const resetIn =
    SHOW_RESET && percent !== null && headline?.resetsAt != null
      ? formatDuration(headline.resetsAt - now)
      : null;
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    if (busy) return;
    setBusy(true);
    refreshProvider(provider.instanceId)
      .catch((error: unknown) => console.warn("[t3ext] limits refresh failed", error))
      .finally(() => setBusy(false));
  };
  const color = DRIVER_COLORS[provider.driver] ?? provider.accentColor ?? "currentColor";
  return (
    <div
      ref={slotRef}
      class="t3usage-chip"
      data-dragging={dragging}
      onPointerDown={onPointerDown}
      role="button"
      tabIndex={0}
      aria-busy={busy}
      aria-label={`${provider.name} usage limits`}
      onClick={refresh}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        refresh();
      }}
      style={{ "--t3usage-color": color }}
    >
      <ProviderIcon provider={provider} />
      {VARIANT === "bars" || VARIANT === "barsAndPercent" ? <Bars windows={shown} now={now} /> : null}
      {VARIANT === "percent" || VARIANT === "barsAndPercent" ? (
        <span class="t3usage-value" data-low={percent !== null && percent < LOW_PERCENT}>
          {percent === null ? "–" : `${percent}%`}
        </span>
      ) : null}
      {resetIn ? <span class="t3usage-reset">{resetIn}</span> : null}
      <Details provider={provider} now={now} />
    </div>
  );
}

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Dragged order first, then instances not placed yet, in the server's order. */
function orderProviders(
  providers: ReadonlyArray<ProviderUsage>,
  order: ReadonlyArray<string>,
): ProviderUsage[] {
  const rank = new Map(order.map((id, index) => [id, index] as const));
  return [...providers].sort(
    (a, b) => (rank.get(a.instanceId) ?? Infinity) - (rank.get(b.instanceId) ?? Infinity),
  );
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** FLIP, as the rail's `useSlideOnReorder`, along x: slides chips whenever the order changes. */
function useSlideOnReorder(
  slots: ReadonlyMap<string, HTMLElement>,
  order: unknown,
  draggedId: string | undefined,
): void {
  const lastLefts = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const lefts = new Map<string, number>();
    for (const [id, el] of slots) {
      const left = el.offsetLeft;
      lefts.set(id, left);
      if (id === draggedId) continue;
      const shift = new DOMMatrix(getComputedStyle(el).transform).m41;
      el.style.transform = "";
      const last = lastLefts.current.get(id);
      if (last === undefined || last + shift === left || reducedMotion.matches) continue;
      for (const animation of el.getAnimations()) animation.cancel();
      el.animate(
        [{ transform: `translateX(${last + shift - left}px)` }, { transform: "none" }],
        { duration: 150, easing: "ease-out" },
      );
    }
    lastLefts.current = lefts;
  }, [order]);
}

/** Pointer travel before a press on a chip becomes a drag. */
const DRAG_THRESHOLD = 4;

export function UsageBar() {
  const providers = useSyncExternalStore(subscribeUsage, getUsage);
  const settings = useSyncExternalStore(usageSettings.subscribe, usageSettings.get);
  const now = useNow();
  // While dragging, the order the bar previews; saved on release.
  const [drag, setDrag] = useState<{ id: string; order: string[] } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  /** Where the dragged chip was grabbed, and where the pointer is now; bar coordinates. */
  const pointer = useRef<{ grab: number; clientX: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<string, HTMLDivElement>()).current;

  const allProviders = useMemo(
    () =>
      orderProviders(
        providers.filter((provider) => provider.windows.length > 0),
        settings.order,
      ),
    [providers, settings.order],
  );
  const shown = useMemo(
    () => (drag ? orderProviders(allProviders, drag.order) : allProviders),
    [allProviders, drag],
  );
  useSlideOnReorder(slots, shown, drag?.id);
  useLayoutEffect(() => follow(), [shown]);

  const barX = (bar: HTMLElement, clientX: number) => clientX - bar.getBoundingClientRect().left;

  /** Keeps the dragged chip under the pointer; its layout spot moves as the order does. */
  const follow = () => {
    const el = dragRef.current && slots.get(dragRef.current.id);
    if (!el || !pointer.current || !barRef.current) return;
    const x = barX(barRef.current, pointer.current.clientX) - pointer.current.grab;
    el.style.transform = `translateX(${x - el.offsetLeft}px)`;
  };

  /** Puts the dragged chip before the first chip whose middle is right of the pointer. */
  const previewDrop = (clientX: number) => {
    const current = dragRef.current;
    if (!current || !barRef.current) return;
    const x = barX(barRef.current, clientX);
    let before: HTMLElement | undefined;
    let beforeId: string | undefined;
    for (const [id, slot] of slots) {
      if (id === current.id || slot.offsetLeft + slot.offsetWidth / 2 <= x) continue;
      if (!before || slot.offsetLeft < before.offsetLeft) [before, beforeId] = [slot, id];
    }
    const order = current.order.filter((id) => id !== current.id);
    order.splice(beforeId ? order.indexOf(beforeId) : order.length, 0, current.id);
    if (order.every((id, index) => id === current.order[index])) return;
    dragRef.current = { id: current.id, order };
    setDrag(dragRef.current);
  };

  /** A press turns into a drag once it moves; a plain click still refreshes. */
  const pressChip = (event: PointerEvent, id: string) => {
    const el = slots.get(id);
    const bar = barRef.current;
    if (event.button !== 0 || !el || !bar) return;
    const { pointerId, clientX: startX } = event;
    const grab = barX(bar, startX) - el.offsetLeft;

    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      if (!pointer.current) {
        if (Math.abs(moved.clientX - startX) < DRAG_THRESHOLD) return;
        pointer.current = { grab, clientX: moved.clientX };
        el.setPointerCapture(pointerId);
        // Instances that aren't reporting right now keep their saved place.
        const visible = allProviders.map((provider) => provider.instanceId);
        dragRef.current = {
          id,
          order: [...visible, ...settings.order.filter((saved) => !visible.includes(saved))],
        };
        setDrag(dragRef.current);
      }
      pointer.current.clientX = moved.clientX;
      follow();
      previewDrop(moved.clientX);
    };
    const finish = (save: boolean) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      if (!pointer.current) return;
      pointer.current = null;
      if (save && dragRef.current) usageSettings.update({ order: dragRef.current.order });
      dragRef.current = null;
      setDrag(null);
      // The release would also click (refresh) the chip under it.
      const swallow = (click: Event) => click.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true));
    };
    const release = (up: PointerEvent) => up.pointerId === pointerId && finish(true);
    const cancel = (up: PointerEvent) => up.pointerId === pointerId && finish(false);
    const escape = (key: KeyboardEvent) => {
      if (key.key !== "Escape" || !pointer.current) return;
      key.stopPropagation();
      finish(false);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
  };

  if (VARIANT === "off" || shown.length === 0) return null;
  return (
    <div class="t3usage" ref={barRef} data-dragging={drag !== null} aria-label="Usage limits">
      {shown.map((provider) => (
        <ProviderChip
          key={provider.instanceId}
          provider={provider}
          now={now}
          dragging={drag?.id === provider.instanceId}
          slotRef={(el) => {
            if (el) slots.set(provider.instanceId, el);
            else slots.delete(provider.instanceId);
          }}
          onPointerDown={(event) => pressChip(event, provider.instanceId)}
        />
      ))}
    </div>
  );
}

/**
 * Renders once into a detached host and keeps that host inside whichever header row
 * is mounted; React swaps the header per thread and route, the host just moves along.
 */
export function mountUsageBar(): void {
  const host = document.createElement("div");
  host.id = "t3usage-root";
  render(<UsageBar />, host);

  let frame = 0;
  const place = () => {
    frame = 0;
    const row = document.querySelector(HEADER_ROW);
    if (row && host.parentElement !== row) row.append(host);
  };
  new MutationObserver(() => {
    if (frame === 0) frame = requestAnimationFrame(place);
  }).observe(document.body, { subtree: true, childList: true });
  place();
}

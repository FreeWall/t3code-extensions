import { useEffect, useRef, useSyncExternalStore } from "preact/compat";

import { ProjectIcon } from "./ProjectIcon.tsx";
import { settingsPath, subscribeSettings } from "../settings.ts";
import { railSettings } from "./settings.ts";
import type { Project } from "../store.ts";

/** Popover next to the rail; closes on Escape or a click outside it and its toggle. */
export function SettingsPanel({
  projects,
  live,
  onClose,
}: {
  projects: ReadonlyArray<Project>;
  live: boolean;
  onClose: () => void;
}) {
  const settings = useSyncExternalStore(railSettings.subscribe, railSettings.get);
  const path = useSyncExternalStore(subscribeSettings, settingsPath);
  const panel = useRef<HTMLDivElement>(null);
  const hidden = new Set(settings.hiddenProjects);
  const manual = settings.projectSort === "manual";

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (panel.current?.contains(target) || target?.closest(".t3rail-settings-toggle")) return;
      onClose();
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

  /** Swaps with the neighbour; hidden projects take part, as they keep their rail slot. */
  const move = (index: number, direction: -1 | 1) => {
    const ids = projects.map((project) => project.id);
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    railSettings.update({ projectOrder: ids });
  };

  const setVisible = (id: string, visible: boolean) => {
    const others = settings.hiddenProjects.filter((other) => other !== id);
    railSettings.update({ hiddenProjects: visible ? others : [...others, id] });
  };

  return (
    <div ref={panel} class="t3rail-settings" role="dialog" aria-label="Rail settings">
      <div class="t3rail-settings-heading">Order</div>
      <div class="t3rail-segmented" role="radiogroup" aria-label="Project order">
        {(
          [
            ["manual", "Manual", "Drag on the rail or use the arrows below"],
            ["app", "Same as sidebar", "Follow the sort set in the app's sidebar"],
          ] as const
        ).map(([value, label, title]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={settings.projectSort === value}
            title={title}
            onClick={() => railSettings.update({ projectSort: value })}
          >
            {label}
          </button>
        ))}
      </div>
      <div class="t3rail-settings-heading">Projects on the rail</div>
      <div class="t3rail-settings-list">
        {projects.map((project, index) => {
          const visible = !hidden.has(project.id);
          return (
            <div
              key={project.id}
              class="t3rail-settings-row"
              data-hidden={!visible}
              title={project.workspaceRoot}
            >
              <span class="t3rail-settings-icon">
                <ProjectIcon project={project} live={live} />
              </span>
              <span class="t3rail-settings-name">{project.title}</span>
              <span class="t3rail-settings-actions">
                <button
                  type="button"
                  class="t3rail-settings-move"
                  title="Move up"
                  aria-label={`Move ${project.title} up`}
                  disabled={index === 0 || !manual}
                  onClick={() => move(index, -1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m5 12 7-7 7 7" />
                    <path d="M12 19V5" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="t3rail-settings-move"
                  title="Move down"
                  aria-label={`Move ${project.title} down`}
                  disabled={index === projects.length - 1 || !manual}
                  onClick={() => move(index, 1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="m19 12-7 7-7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  role="switch"
                  class="t3rail-switch"
                  aria-checked={visible}
                  title={visible ? "Shown on the rail" : "Hidden from the rail"}
                  aria-label={`Show ${project.title} on the rail`}
                  onClick={() => setVisible(project.id, !visible)}
                >
                  <span class="t3rail-switch-thumb" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div class="t3rail-settings-footer">
        {path ?? "Offline: changes are saved once the app reconnects"}
      </div>
    </div>
  );
}

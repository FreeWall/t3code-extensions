import { useEffect, useRef, useSyncExternalStore } from "preact/compat";

import { ProjectIcon } from "./ProjectIcon.tsx";
import { getSettings, settingsPath, subscribeSettings, updateSettings } from "./settings.ts";
import type { Project } from "./store.ts";

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
  const settings = useSyncExternalStore(subscribeSettings, getSettings);
  const path = useSyncExternalStore(subscribeSettings, settingsPath);
  const panel = useRef<HTMLDivElement>(null);
  const hidden = new Set(settings.hiddenProjects);

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

  const setVisible = (id: string, visible: boolean) => {
    const others = settings.hiddenProjects.filter((other) => other !== id);
    updateSettings({ hiddenProjects: visible ? others : [...others, id] });
  };

  return (
    <div ref={panel} class="t3rail-settings" role="dialog" aria-label="Rail settings">
      <div class="t3rail-settings-heading">Projects on the rail</div>
      <div class="t3rail-settings-list">
        {projects.map((project) => (
          <label key={project.id} class="t3rail-settings-row" title={project.workspaceRoot}>
            <span class="t3rail-settings-icon">
              <ProjectIcon project={project} live={live} />
            </span>
            <span class="t3rail-settings-name">{project.title}</span>
            <input
              type="checkbox"
              checked={!hidden.has(project.id)}
              onChange={(event) => setVisible(project.id, event.currentTarget.checked)}
            />
          </label>
        ))}
      </div>
      <div class="t3rail-settings-footer">
        {path ?? "Offline: changes are saved once the app reconnects"}
      </div>
    </div>
  );
}

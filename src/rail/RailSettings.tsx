import { useSyncExternalStore } from "preact/compat";

import { ProjectIcon } from "./ProjectIcon.tsx";
import { useOrderedProjects } from "./projects.ts";
import { railSettings } from "./settings.ts";
import { getState, subscribe } from "../store.ts";
import { MoveButtons, Row, Segmented, Switch } from "../ui/index.tsx";

const SORT_OPTIONS = [
  { value: "manual", label: "Manual", title: "Drag on the rail or use the arrows below" },
  { value: "app", label: "Same as sidebar", title: "Follow the sort set in the app's sidebar" },
] as const;

/** The rail's section on the Extensions settings page. */
export function RailSettings() {
  const settings = useSyncExternalStore(railSettings.subscribe, railSettings.get);
  const live = useSyncExternalStore(subscribe, getState).status === "live";
  const projects = useOrderedProjects();
  const hidden = new Set(settings.hiddenProjects);
  const manual = settings.projectSort === "manual";

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
    <>
      <Row title="Order" description="How projects are ordered on the rail">
        <Segmented
          value={settings.projectSort}
          label="Project order"
          options={SORT_OPTIONS}
          onChange={(projectSort) => railSettings.update({ projectSort })}
        />
      </Row>
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
                <MoveButtons
                  name={project.title}
                  index={index}
                  count={projects.length}
                  disabled={!manual}
                  onMove={(direction) => move(index, direction)}
                />
                <Switch
                  checked={visible}
                  label={`Show ${project.title} on the rail`}
                  title={visible ? "Shown on the rail" : "Hidden from the rail"}
                  onChange={(checked) => setVisible(project.id, checked)}
                />
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

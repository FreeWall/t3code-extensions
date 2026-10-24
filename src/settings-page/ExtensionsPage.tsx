import { useSyncExternalStore } from "preact/compat";

import { extensions, extensionSettings, setEnabled } from "../host.ts";
import { settingsPath, subscribeSettings } from "../settings.ts";
import { Icon, Switch } from "../ui/index.tsx";
import { getSelected, select, subscribePage } from "./state.ts";

/** A list of extensions beside the picked one's settings, after the app's Providers page. */
export function ExtensionsPage() {
  const { disabled } = useSyncExternalStore(extensionSettings.subscribe, extensionSettings.get);
  const path = useSyncExternalStore(subscribeSettings, settingsPath);
  const selectedName = useSyncExternalStore(subscribePage, getSelected);
  const selected = extensions.find(({ name }) => name === selectedName) ?? extensions[0]!;
  const selectedEnabled = !disabled.includes(selected.name);
  const { Settings } = selected;

  return (
    <div class="t3ext-page topbar-scroll-fade scrollbar-gutter-both">
      <div class="t3ext-page-body">
        <div class="t3ext-split">
          <div class="t3ext-split-list">
            {extensions.map(({ name, title, icon }) => {
              const enabled = !disabled.includes(name);
              return (
                <div
                  key={name}
                  class="t3ext-split-item"
                  data-selected={name === selected.name}
                  data-enabled={enabled}
                >
                  <button
                    type="button"
                    class="t3ext-split-select"
                    aria-label={`Select ${title}`}
                    aria-pressed={name === selected.name}
                    onClick={() => select(name)}
                  />
                  <Icon node={icon} class="t3ext-split-icon" />
                  <span class="t3ext-split-text">
                    <span class="t3ext-split-title">{title}</span>
                    <span class="t3ext-split-status">{enabled ? "Enabled" : "Disabled"}</span>
                  </span>
                  <Switch
                    checked={enabled}
                    label={`Enable ${title}`}
                    onChange={(checked) => setEnabled(name, checked)}
                  />
                </div>
              );
            })}
          </div>
          <div class="t3ext-split-detail">
            <div class="t3ext-split-header">
              <div class="t3ext-split-heading">
                <Icon node={selected.icon} class="t3ext-split-icon" />
                {selected.title}
              </div>
              <p class="t3ext-split-description">{selected.description}</p>
            </div>
            {!selectedEnabled ? (
              <p class="t3ext-split-empty">Disabled</p>
            ) : Settings ? (
              <Settings />
            ) : (
              <p class="t3ext-split-empty">Extension has no settings.</p>
            )}
          </div>
        </div>
        <p class="t3ext-page-footer">
          {path ?? "Offline: changes are saved once the app reconnects"}
        </p>
      </div>
    </div>
  );
}

import { useSyncExternalStore } from "preact/compat";

import { MoveButtons, Row, Section, Segmented, Switch } from "../ui/index.tsx";
import { getUsage, subscribeUsage } from "./limits.ts";
import { REFRESH_MINUTES, usageSettings, type UsageChipStyle } from "./settings.ts";
import { orderProviders, ProviderIcon, UsageBar } from "./UsageBar.tsx";

const CHIP_STYLE_OPTIONS = [
  { value: "percent", label: "Compact", title: "Icon and % left" },
  { value: "bars", label: "Bars", title: "Icon and session/weekly bars" },
  { value: "barsAndPercent", label: "Full", title: "Icon, bars and % left" },
] as const satisfies ReadonlyArray<{ value: UsageChipStyle; label: string; title: string }>;

const REFRESH_OPTIONS = REFRESH_MINUTES.map((minutes) =>
  minutes === 0
    ? { value: "0", label: "Off", title: "Refresh only when a chip is clicked" }
    : { value: String(minutes), label: `${minutes}m` },
);

/** The usage bar's section on the Extensions settings page. */
export function UsageSettings() {
  const settings = useSyncExternalStore(usageSettings.subscribe, usageSettings.get);
  const providers = orderProviders(
    useSyncExternalStore(subscribeUsage, getUsage).filter((provider) => provider.windows.length > 0),
    settings.order,
  );
  const hidden = new Set(settings.hiddenProviders);

  /** Swaps with the neighbour; instances not reporting right now keep their saved place. */
  const move = (index: number, direction: -1 | 1) => {
    const ids = providers.map((provider) => provider.instanceId);
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next]!, ids[index]!];
    usageSettings.update({ order: [...ids, ...settings.order.filter((id) => !ids.includes(id))] });
  };

  const setVisible = (id: string, visible: boolean) => {
    const others = settings.hiddenProviders.filter((other) => other !== id);
    usageSettings.update({ hiddenProviders: visible ? others : [...others, id] });
  };

  return (
    <Section>
      <Row title="Preview">
        <UsageBar />
      </Row>
      <Row title="Chip style" description="What each provider shows in the header">
        <Segmented
          value={settings.chipStyle}
          label="Chip style"
          options={CHIP_STYLE_OPTIONS}
          onChange={(chipStyle) => usageSettings.update({ chipStyle })}
        />
      </Row>
      <Row title="Reset time" description="Time until the session window resets, after its %">
        <Switch
          checked={settings.showReset}
          label="Show reset time"
          onChange={(showReset) => usageSettings.update({ showReset })}
        />
      </Row>
      <Row title="Refresh interval" description="How often limits are re-read while the app is visible">
        <Segmented
          value={String(settings.refreshMinutes)}
          label="Refresh interval"
          options={REFRESH_OPTIONS}
          onChange={(value) => {
            const refreshMinutes = REFRESH_MINUTES.find((minutes) => String(minutes) === value);
            if (refreshMinutes !== undefined) usageSettings.update({ refreshMinutes });
          }}
        />
      </Row>
      {providers.length > 0 ? (
        <div class="t3usage-settings-list">
          {providers.map((provider, index) => {
            const visible = !hidden.has(provider.instanceId);
            return (
              <div
                key={provider.instanceId}
                class="t3usage-settings-row"
                data-hidden={!visible}
                style={{ "--t3usage-color": provider.accentColor ?? "currentColor" }}
              >
                <ProviderIcon provider={provider} />
                <span class="t3usage-settings-name">{provider.name}</span>
                <span class="t3usage-settings-actions">
                  <MoveButtons
                    name={provider.name}
                    index={index}
                    count={providers.length}
                    onMove={(direction) => move(index, direction)}
                  />
                  <Switch
                    checked={visible}
                    label={`Show ${provider.name} in the header`}
                    title={visible ? "Shown in the header" : "Hidden from the header"}
                    onChange={(checked) => setVisible(provider.instanceId, checked)}
                  />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <Row title="Providers" description="No provider reports usage limits yet" />
      )}
    </Section>
  );
}

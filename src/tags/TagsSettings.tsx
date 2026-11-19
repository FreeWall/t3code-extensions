import { useEffect, useState, useSyncExternalStore } from "preact/compat";

import { Row, Section, Switch } from "../ui/index.tsx";
import { DEFAULT_PROMPT, PROMPT_VARIABLES } from "./prompt.ts";
import { useProviders } from "./providers.ts";
import { activePrompt, tagsSettings } from "./settings.ts";

const SEPARATOR = "\u0000";

/** Thread tags' section on the Extensions settings page: auto-tagging. */
export function TagsSettings() {
  const settings = useSyncExternalStore(tagsSettings.subscribe, tagsSettings.get);
  const providers = useProviders();
  const prompt = activePrompt(settings);
  const [draft, setDraft] = useState(prompt);
  useEffect(() => setDraft(prompt), [prompt]);
  const editable = settings.autoTag && settings.customPrompt;
  const savePrompt = (text: string) => {
    if (text !== settings.prompt) tagsSettings.update({ prompt: text });
    // A blank prompt falls back to the built-in one; show that.
    if (!text.trim()) setDraft(DEFAULT_PROMPT);
  };
  /** Turning it on starts from the built-in prompt unless there's an earlier custom one. */
  const setCustom = (customPrompt: boolean) =>
    tagsSettings.update(
      customPrompt && !settings.prompt.trim() ? { customPrompt, prompt: DEFAULT_PROMPT } : { customPrompt },
    );

  const selected = `${settings.model.instanceId}${SEPARATOR}${settings.model.model}`;
  const known = providers.some(
    (provider) =>
      provider.instanceId === settings.model.instanceId &&
      provider.models.some((model) => model.slug === settings.model.model),
  );

  return (
    <Section title="Auto-tagging">
      <Row title="Auto-tag new threads" description="When a new thread's first run ends, a model tags it if it relates to other threads">
        <Switch
          checked={settings.autoTag}
          label="Auto-tag new threads"
          onChange={(autoTag) => tagsSettings.update({ autoTag })}
        />
      </Row>
      <Row title="Model" description="Runs in a hidden thread that is deleted afterwards; a small model is enough">
        <select
          class="t3tags-settings-select"
          aria-label="Auto-tagging model"
          value={selected}
          disabled={!settings.autoTag}
          onChange={(event) => {
            const [instanceId, model] = event.currentTarget.value.split(SEPARATOR);
            if (instanceId && model) tagsSettings.update({ model: { instanceId, model } });
          }}
        >
          {known ? null : (
            <option value={selected}>
              {settings.model.model} ({settings.model.instanceId}){providers.length ? ", unavailable" : ""}
            </option>
          )}
          {providers.map((provider) => (
            <optgroup key={provider.instanceId} label={provider.name}>
              {provider.models.map((model) => (
                <option key={model.slug} value={`${provider.instanceId}${SEPARATOR}${model.slug}`}>
                  {model.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>
      <div class="t3ext-row t3tags-settings-block">
        <div class="t3tags-settings-head">
          <div class="t3ext-row-text">
            <div class="t3ext-row-title">Prompt</div>
            <div class="t3ext-row-description">
              {settings.customPrompt
                ? "Your prompt. Keep the JSON reply format, or no tags are read from the answer."
                : "The built-in prompt. Override it to edit; switching back keeps your version for later."}
            </div>
          </div>
          <label class="t3tags-settings-override">
            Override
            <Switch checked={settings.customPrompt} label="Override the built-in prompt" onChange={setCustom} />
          </label>
        </div>
        <textarea
          class="t3tags-settings-textarea t3tags-settings-prompt"
          rows={20}
          spellcheck={false}
          value={settings.customPrompt ? draft : DEFAULT_PROMPT}
          readOnly={!editable}
          aria-readonly={!editable}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onBlur={() => {
            if (editable) savePrompt(draft);
          }}
        />
        <dl class="t3tags-settings-variables">
          {PROMPT_VARIABLES.map((variable) => (
            <div key={variable.name}>
              <dt>
                <code>{"${" + variable.name + "}"}</code>
              </dt>
              <dd>{variable.description}</dd>
            </div>
          ))}
        </dl>
        {editable && settings.prompt !== DEFAULT_PROMPT ? (
          <button type="button" class="t3tags-settings-reset" onClick={() => savePrompt(DEFAULT_PROMPT)}>
            Reset to built-in
          </button>
        ) : null}
      </div>
    </Section>
  );
}

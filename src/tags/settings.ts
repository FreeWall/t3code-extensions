import { record, string } from "../json.ts";
import { settingsSection } from "../settings.ts";
import { DEFAULT_PROMPT } from "./prompt.ts";

export interface ModelChoice {
  readonly instanceId: string;
  readonly model: string;
}

export interface TagsSettings {
  /** Tag each new thread with the model below. */
  readonly autoTag: boolean;
  readonly model: ModelChoice;
  /** Use `prompt` instead of the built-in `DEFAULT_PROMPT`. */
  readonly customPrompt: boolean;
  /** The user's prompt template, kept while the override is off. */
  readonly prompt: string;
}

export const DEFAULT_MODEL: ModelChoice = { instanceId: "claudeAgent", model: "claude-haiku-5-5" };

function toModel(value: unknown): ModelChoice {
  const raw = record(value);
  const instanceId = string(raw?.instanceId);
  const model = string(raw?.model);
  return instanceId && model ? { instanceId, model } : DEFAULT_MODEL;
}

export const tagsSettings = settingsSection(
  "tags",
  (raw): TagsSettings => ({
    autoTag: raw.autoTag !== false,
    model: toModel(raw.model),
    customPrompt: raw.customPrompt === true,
    prompt: string(raw.prompt) ?? "",
  }),
);

/** The template auto-tagging sends: the user's while overridden and not blank, else the built-in one. */
export const activePrompt = ({ customPrompt, prompt }: TagsSettings): string =>
  customPrompt && prompt.trim() ? prompt : DEFAULT_PROMPT;

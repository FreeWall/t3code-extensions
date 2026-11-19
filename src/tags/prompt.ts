/**
 * The auto-tagging prompt: a template the user can replace in settings, with
 * `${name}` placeholders filled per thread. Unknown placeholders stay as written.
 */

export const MAX_TAGS = 2;

export const PROMPT_VARIABLES = [
  { name: "title", description: "The new thread's title" },
  { name: "firstMessage", description: "Its first message, cut to 2000 characters" },
  { name: "project", description: "The project's name" },
  { name: "threads", description: "Up to 60 other threads of the project, as `number. title [tags]`" },
  { name: "maxTags", description: `Tags kept from the reply (${MAX_TAGS})` },
] as const;

export type PromptValues = Record<(typeof PROMPT_VARIABLES)[number]["name"], string>;

export const DEFAULT_PROMPT = [
  "You group threads in a coding app by tagging related ones. Do not use any tools.",
  "Reply with one JSON object and nothing else.",
  "",
  "NEW THREAD",
  "Title: ${title}",
  "First message: ${firstMessage}",
  "",
  "OTHER THREADS IN THE PROJECT ${project} (number. title [tags])",
  "${threads}",
  "",
  "Rules:",
  "- Tag the new thread only when it clearly works on the same topic as other threads.",
  "- Prefer a tag those threads already have.",
  "- A new tag is 1-2 words naming the shared topic, and must list the numbers of the",
  "  untagged threads that belong with it.",
  '- At most ${maxTags} tags. When nothing is clearly related, reply {"tags":[]}.',
  "",
  'Format: {"tags":[{"tag":"<tag>","threads":[<numbers of other threads to tag too>]}]}',
].join("\n");

const isVariable = (name: string): name is keyof PromptValues => PROMPT_VARIABLES.some((v) => v.name === name);

export const fillPrompt = (template: string, values: PromptValues): string =>
  template.replace(/\$\{(\w+)\}/g, (match, name: string) => (isVariable(name) ? values[name] : match));

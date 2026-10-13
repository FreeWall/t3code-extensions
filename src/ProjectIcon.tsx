import { icons, type IconNode } from "lucide";
import { createElement } from "preact";
import { useEffect, useState } from "preact/hooks";

import { createAssetUrl } from "./connection.ts";
import type { Project } from "./store.ts";

/** Tailwind -400 shades, matching the app's dark-theme project icon colors. */
const COLORS: Record<string, string> = {
  gray: "#9ca3af", red: "#f87171", orange: "#fb923c", amber: "#fbbf24", yellow: "#facc15",
  lime: "#a3e635", green: "#4ade80", emerald: "#34d399", teal: "#2dd4bf", cyan: "#22d3ee",
  sky: "#38bdf8", blue: "#60a5fa", indigo: "#818cf8", violet: "#a78bfa", purple: "#c084fc",
  fuchsia: "#e879f9", pink: "#f472b6", rose: "#fb7185",
};
const COLOR_ORDER = Object.keys(COLORS);
const FALLBACK_MARKER = "project-favicon-missing";

/** Same monogram and color the app derives in `projectIdentity.ts`. */
function identity(name: string): { monogram: string; color: string } {
  const normalized = name.normalize("NFKC").trim();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  let monogram = "PR";
  const first = words[0];
  if (first) {
    const glyphs = Array.from(first);
    const second =
      glyphs.slice(1).find((glyph) => /\p{N}/u.test(glyph)) ??
      (words.length > 1 ? Array.from(words.at(-1) ?? "")[0] : glyphs.at(-1)) ??
      glyphs[0];
    monogram = Array.from(`${glyphs[0]}${second}`.toUpperCase()).slice(0, 2).join("");
  }
  const seed = normalized.toLocaleLowerCase("en-US") || "project";
  let index = 0;
  for (const glyph of seed) index = (index * 31 + (glyph.codePointAt(0) ?? 0)) % COLOR_ORDER.length;
  return { monogram, color: COLOR_ORDER[index] ?? "blue" };
}

/** `folder-code` → `FolderCode`, the key `lucide`'s icon map uses (aliases included). */
const lucideKey = (name: string): string =>
  name.replace(/(?:^|-)([a-z0-9])/g, (_, glyph: string) => glyph.toUpperCase());

/** Unknown names fall back to `folder-code`, like the app's DynamicIcon fallback. */
function LucideIcon({ name, color }: { name: string; color: string }) {
  const node: IconNode = (icons as Record<string, IconNode>)[lucideKey(name)] ?? icons.FolderCode;
  return (
    <svg
      class="t3rail-lucide"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      style={{ "--t3rail-icon-color": color }}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {node.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))}
    </svg>
  );
}

const faviconCache = new Map<string, Promise<string | null>>();

function faviconUrl(project: Project): Promise<string | null> {
  const key = `${project.workspaceRoot}\0${project.faviconPath ?? ""}`;
  let cached = faviconCache.get(key);
  if (cached === undefined) {
    cached = createAssetUrl({
      _tag: "project-favicon",
      cwd: project.workspaceRoot,
      ...(project.faviconPath ? { path: project.faviconPath } : {}),
    })
      .then((url) => (url === null || url.includes(FALLBACK_MARKER) ? null : url))
      .catch(() => null);
    // Offline or failed lookups retry on the next render instead of sticking.
    void cached.then((url) => url === null && faviconCache.delete(key));
    faviconCache.set(key, cached);
  }
  return cached;
}

function useFavicon(project: Project, live: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!live || !project.workspaceRoot) return;
    let cancelled = false;
    void faviconUrl(project).then((next) => !cancelled && setUrl(next));
    return () => {
      cancelled = true;
    };
  }, [project.workspaceRoot, project.faviconPath, live]);
  return url;
}

export function ProjectIcon({ project, live }: { project: Project; live: boolean }) {
  const icon = project.projectIcon;
  // As in the app's ProjectFavicon, an icon override always wins over the favicon.
  const favicon = useFavicon(project, live && icon === null);
  const [broken, setBroken] = useState(false);
  const generated = identity(project.title);
  const color = (name: string | undefined) => COLORS[name ?? generated.color] ?? COLORS.blue!;

  if (icon?.kind === "emoji") {
    return <span class="t3rail-emoji">{icon.emoji}</span>;
  }
  if (icon?.kind === "lucide") {
    return <LucideIcon name={icon.name} color={color(icon.color)} />;
  }
  if (icon === null && favicon && !broken) {
    return <img class="t3rail-favicon" src={favicon} alt="" onError={() => setBroken(true)} />;
  }
  const text = icon?.kind === "monogram" ? icon.text : generated.monogram;
  return (
    <span class="t3rail-monogram" style={{ "--t3rail-icon-color": color(icon?.color) }}>
      {text}
    </span>
  );
}

# t3code-extensions

Custom extensions for the [T3 Code](https://github.com/pingdotgg/t3code) desktop nightly, bundled
into one script injected into the app as `/custom.js`.

| Extension | Folder | What it does |
| --- | --- | --- |
| Project rail | `src/rail/` | Discord-style project rail on the left edge |
| Usage bar | `src/usage/` | Provider usage limits in the thread header |

Shared code lives in `src/`: the backend connection (`connection.ts`, `protocol.ts`), the shell
projection of projects and threads (`store.ts`), app DOM helpers (`app.ts`), and settings
(`settings.ts`). Each extension exports an `Extension` (`{ name, styles, mount }`) from its
`index.ts`, and `src/main.ts` mounts the list. An extension that needs the socket registers
with `onSession`.

## Project rail

One icon per project:

- Clicking a project filters the app's sidebar to it (it drives the sidebar's own project picker).
- A red badge counts threads waiting for you (approval, input, a plan ready in plan mode) plus finished
  runs you haven't opened; clicking it opens the first one.
- An amber pen marks a project with an unsent composer draft; clicking it opens the draft.
- A spinning ring shows a project with a running agent.
- Projects can be reordered by drag and drop, or follow the app sidebar's own sort.
- The gear at the bottom opens the rail settings: pick the order, move projects up and down, and
  switch a project off to hide it from the rail. It stays in the app's own project picker.

## Usage bar

A chip per provider instance that reports subscription limits, showing what's left of each window.
Clicking a chip refreshes it; chips can be reordered by drag and drop. Limits are re-probed every few minutes while the window is
visible.

## Settings

All extensions share `~/.config/t3code-extensions/settings.json`, one object per extension:

```json
{
  "rail": {
    "projectSort": "manual",
    "projectOrder": ["<project id>", "..."],
    "hiddenProjects": ["<project id>"]
  },
  "usage": {
    "order": ["<provider instance id>", "..."]
  }
}
```

The file is read through the backend (`projects.readFile` / `projects.writeFile`), since the page
itself can't touch the disk. It is read once when the app starts, so hand edits need a window reload;
unknown keys are kept. A copy in `localStorage` covers the moment before the socket is up, and
changes made while offline are written once it reconnects. Each extension reads its own section
through `settingsSection(key, decode)`.

`usage.order` is the drag order of the provider chips in the header usage bar.

`rail.projectSort` is `"manual"` (the rail's own `projectOrder`) or `"app"`, which mirrors the sidebar's
"Sort projects" choice: last user message, created at, or the sidebar's manual drag order. The rail
reads that from the app's client settings and UI state, rechecking after clicks and key presses.

## How it works

- **Data**: the bundle opens its own WebSocket to the app's backend and subscribes to
  `orchestration.subscribeShell`, the same projects/threads projection the app's sidebar uses. It
  authenticates with the bearer token the desktop preload bridge hands the page
  (`desktopBridge.getLocalEnvironmentBearerToken`), exchanged for a `/ws` ticket, so no pairing is
  needed. In a plain browser tab it uses the session cookie instead.
- **Drafts** never reach the server; the rail reads them from the app's `localStorage`
  (`t3code:composer-drafts:v1`) and re-reads whenever the app writes that key.
- **Layout**: `rail/rail.css` shifts the app's `#root` right by the rail's width.

It reads app internals (wire format, sidebar selectors, storage keys), so a nightly that reshapes those
can break them; the relevant spots are commented in `src/`.

## Build

```bash
npm ci
npm run build       # dist/custom.js
npm run watch       # rebuild on change
npm run typecheck
```

## Install

`scripts/t3code-nightly.sh` in [nixos-share](https://github.com/FreeWall/nixos-share) builds this project
and symlinks `dist/custom.js` into the installed nightly (`--update` or `--inject`). It looks for the
project at `~/projects/FreeWall/t3code-extensions`, or `$T3CODE_EXTENSIONS`.

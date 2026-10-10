# t3code-rail

A Discord-style project rail for the [T3 Code](https://github.com/pingdotgg/t3code) desktop nightly,
injected into the app as `/custom.js`.

The rail sits on the left edge of the window with one icon per project:

- Clicking a project filters the app's sidebar to it (it drives the sidebar's own project picker).
- A red badge counts threads waiting for you (approval, input, a plan ready in plan mode) plus finished
  runs you haven't opened; clicking it opens the first one.
- An amber pen marks a project with an unsent composer draft; clicking it opens the draft.
- A spinning ring shows a project with a running agent.
- Projects can be reordered by drag and drop, or follow the app sidebar's own sort.
- The gear at the bottom opens the rail settings: pick the order, move projects up and down, and
  switch a project off to hide it from the rail. It stays in the app's own project picker.

## Settings

Order and hidden projects live in `~/.config/t3code-rail/settings.json`:

```json
{
  "projectSort": "manual",
  "projectOrder": ["<project id>", "..."],
  "hiddenProjects": ["<project id>"]
}
```

The file is read through the backend (`projects.readFile` / `projects.writeFile`), since the page
itself can't touch the disk. It is read once when the app starts, so hand edits need a window reload;
keys the rail doesn't know are kept. A copy in `localStorage` covers the
moment before the socket is up, and changes made while offline are written once it reconnects.

`projectSort` is `"manual"` (the rail's own `projectOrder`) or `"app"`, which mirrors the sidebar's
"Sort projects" choice: last user message, created at, or the sidebar's manual drag order. The rail
reads that from the app's client settings and UI state, rechecking after clicks and key presses.

## How it works

- **Data**: the rail opens its own WebSocket to the app's backend and subscribes to
  `orchestration.subscribeShell`, the same projects/threads projection the app's sidebar uses. It
  authenticates with the bearer token the desktop preload bridge hands the page
  (`desktopBridge.getLocalEnvironmentBearerToken`), exchanged for a `/ws` ticket, so no pairing is
  needed. In a plain browser tab it uses the session cookie instead.
- **Drafts** never reach the server; the rail reads them from the app's `localStorage`
  (`t3code:composer-drafts:v1`) and re-reads whenever the app writes that key.
- **Layout**: `rail.css` shifts the app's `#root` right by the rail's width.

It reads app internals (wire format, sidebar selectors, storage keys), so a nightly that reshapes those
can break it; the relevant spots are commented in `src/`.

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
project at `~/projects/FreeWall/t3code-rail`, or `$T3CODE_RAIL`.

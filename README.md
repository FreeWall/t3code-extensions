# t3code-extensions

Custom extensions for the [T3 Code](https://github.com/pingdotgg/t3code) desktop nightly, bundled
into one script injected into the app as `/custom.js`.

| Extension | Folder | What it does |
| --- | --- | --- |
| Project rail | `src/rail/` | Discord-style project rail on the left edge |
| Usage bar | `src/usage/` | Provider usage limits in the thread header |
| New thread in filtered project | `src/new-thread/` | Sidebar New thread starts in the project the sidebar is filtered to |
| Thread tags | `src/tags/` | Tag labels on sidebar threads, a filter by tag, and auto-tagging of new threads |

Shared code lives in `src/`: the backend connection (`connection.ts`, `protocol.ts`), the shell
projection of projects and threads (`store.ts`), app DOM helpers (`app.ts`), and settings
(`settings.ts`). Each extension exports an `Extension` (`{ name, title, description, icon,
styles, mount, Settings? }`) from its `index.ts` and is listed in `src/host.ts`, which mounts the ones
switched on. `mount` returns its cleanup, so an extension can be switched off without a reload.
An extension that needs the socket registers with `onSession`, which also returns a stop.

## Project rail

One icon per project:

- Clicking a project filters the app's sidebar to it (it drives the sidebar's own project picker).
- A red badge counts threads waiting for you (approval, input, a plan ready in plan mode) plus finished
  runs you haven't opened; clicking it opens the first one.
- An amber pen marks a project with an unsent composer draft; clicking it opens the draft.
- A spinning ring shows a project with a running agent.
- Projects can be reordered by drag and drop, or follow the app sidebar's own sort.
- The gear at the bottom opens the rail's section of the Extensions settings: pick the order, move
  projects up and down, and switch a project off to hide it from the rail. It stays in the app's
  own project picker.

## Usage bar

A chip per provider instance that reports subscription limits, showing what's left of each window.
Clicking a chip refreshes it; chips can be reordered by drag and drop. Limits are re-probed every few minutes while the window is
visible. Its settings section picks the chip style (compact %, bars, or both), whether the reset time
shows, the refresh interval, and which providers appear.

## New thread in filtered project

A plain click on the sidebar's New thread button opens the app's "New thread in..." picker. While
the sidebar is filtered to a project, the extension picks that project in the (hidden) picker, so the
thread starts there instead of in the viewed thread's project
([t3code#11895](https://github.com/pingdotgg/t3code/issues/11895)). With "All projects" the picker
shows as usual. Shift+click does the same while filtered; unfiltered it keeps the app's behavior.

## Thread tags

The server already stores free-form tags on threads (`thread.tag.set`), but the app shows none.
This extension shows them as colored chips on the sidebar rows, next to the time, and puts a bar of
tags (with counts) under the sidebar search. The bar follows the sidebar's project filter: with a
project picked it lists only that project's tags, with "All projects" every tag. Clicking a tag, in
the bar or on a row, shows only the threads that carry it; clicking it again shows all. The filter
is remembered per window (`localStorage`) and only applies while the shown project has that tag,
so switching projects never leaves an empty list. Search results are never filtered.

To tag a thread, right-click one of its tags in the sidebar (or Shift+right-click anywhere on the row), or use **+** in the bar for the open thread. To rename a tag, right-click it in the bar (renames it in the shown project, or everywhere for "All projects"), or hover it in the tag popover and click the pencil; renaming to an existing tag merges them. The bar's right-click popover also removes a tag from all those threads.
The popover offers the tags of the thread's project and adds new ones (Enter). The app's native context menu can't
be extended (`desktopBridge` is frozen), so a plain right-click keeps the app's menu. Tags live on
the server, so they sync across devices and don't bump the thread's `updatedAt`.

### Auto-tagging

When a new thread's first run finishes, auto-tagging asks Claude Haiku whether it belongs with other
threads of its project, and tags it (and the threads it relates to) if so. It prefers existing tags
and only makes a new one when at least one other thread shares it. Threads created before it was
first switched on are left alone, and a thread you tag yourself first is skipped. Side chats and
subagents are never tagged.

It asks through T3 Code itself: it launches a thread titled `Auto-tag` on the chosen model
(approval-required, so it can't act), reads the JSON reply and deletes the thread. The sidebar hides that thread, but it is a real run, so anything hooked to finished runs
sees it, e.g. a t3code-listener hook can skip it with `"match": { "titlePattern": "^(?!Auto-tag$)" }`.
It only runs while an app window is open; a Web Lock keeps windows from doing the same thread twice.
Applied tags are logged to the console as `[t3ext] auto-tag`.

Its settings (Extensions → Thread tags, or `tags` in the settings file):

- **Auto-tag new threads**: on by default. Switching it back on doesn't tag the threads made while it was off.
- **Model**: any model of an enabled provider; defaults to `claudeAgent` / `claude-haiku-5-5`.
- **Custom prompt**: off uses the built-in prompt, shown read-only. On, the prompt is editable, with
  `${title}`, `${firstMessage}`, `${project}`, `${threads}` and `${maxTags}` filled per thread; switching
  it off keeps your text for later.

## Settings

The app's Settings gets an **Extensions** item in its nav (`src/settings-page/`). It switches
extensions on and off, live, in a list beside the picked extension's own `Settings`, laid out
like the app's Providers page. The app's settings
routes are fixed, so the page is drawn over the current section rather than being a route of
its own.

All extensions share `~/.config/t3code-extensions/settings.json`, one object per extension:

```json
{
  "extensions": {
    "disabled": ["<extension name>"]
  },
  "rail": {
    "projectSort": "manual",
    "projectOrder": ["<project id>", "..."],
    "hiddenProjects": ["<project id>"]
  },
  "usage": {
    "order": ["<provider instance id>", "..."],
    "hiddenProviders": ["<provider instance id>"],
    "refreshMinutes": 6,
    "chipStyle": "barsAndPercent",
    "showReset": true
  }
}
```

The file is read through the backend (`projects.readFile` / `projects.writeFile`), since the page
itself can't touch the disk. The server only writes inside registered projects, so
`~/.config/t3code-extensions` has to be added as a project once; the rail leaves it out. It is read once when the app starts, so hand edits need a window reload;
unknown keys are kept. A copy in `localStorage` covers the moment before the socket is up, and
changes made while offline are written once it reconnects. Each extension reads its own section
through `settingsSection(key, decode)`.

`usage.order` is the drag order of the provider chips in the header usage bar. `usage.refreshMinutes`
is one of 6, 15, 30, or 0 (off: refresh only on click); the default 6 is just over the server's
5 minute Claude probe cache. `usage.chipStyle` is `"percent"`, `"bars"`, or `"barsAndPercent"`.

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

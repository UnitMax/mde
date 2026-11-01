# Architecture and behavior

How MDE is put together and what its main features do. For setup and build commands,
see the [README](../README.md).

## Process boundaries

```
src/
  main/      owns every node-pty instance, all filesystem access, all wsl.exe invocation
  preload/   contextBridge only — contextIsolation on, nodeIntegration off, sandbox on
  renderer/  React UI with no Node access whatsoever
  shared/    IPC channel names + payload types, imported by both sides so they cannot drift
```

Every renderer-to-main call is authenticated and validated centrally; see
[`security.md`](security.md).

## Projects and terminal sessions

Projects are groups that contain sessions. Sessions own the name, path, platform, distro and
optional shell override. Each session persists an ordered set of terminal tabs. Every tab owns an
independent layout of one to nine panes, chosen from ten arrangements (Ctrl+1–9; the seven-terminal
grid has no shortcut), including three terminals side by side, a six-terminal 3 × 2 grid and a
nine-terminal 3 × 3 grid; new tabs start with one fresh terminal. The
renderer keeps one `xterm` instance per runtime terminal identity in a plain Map outside React.
Switching sessions or tabs re-parents terminal containers rather than disposing them, so each
process, its scrollback and its cursor position survive. Unvisited persisted tabs create their PTYs
lazily; the PTYs themselves do not survive application restart.

The workspace is stored as `workspace.json` in Electron's user-data directory with separate
`projects`, `todoProjects`, `todoTasks` and `sessions` arrays. Session array order is the persistent
sidebar order within each project; tab names, order, active tab, pane order, layouts and resize
ratios are stored inside each session. Legacy sessions without tab data are normalized to a single
`Tab 1` on load. Terminal and agent-command preferences live in the renderer's `localStorage`
instead (`mde.terminal-settings`).

Keyboard shortcuts are listed in the app under Settings → Keyboard Shortcuts; that list is defined
in `src/renderer/terminal/keyboard-shortcuts.ts`.

### Settings

The Settings dialog's Terminal section controls terminal behavior, including whether Escape exits
the temporary fullscreen view; it is enabled by default. Ctrl+Shift+F toggles fullscreen for the
focused terminal pane. The Sidebar section controls whether ordinary terminal pane entries appear
beneath each session; this preference is global and stored with the local terminal settings. The
Agents section configures the launcher commands described below. The application theme (Slate,
Ember, Frost, High contrast) and zoom are also adjustable. The Appearance section sets the terminal
font family, size and line height, and separately the font family of the file viewer's source code
preview; both families are chosen from the same list of installed monospace fonts and default to
its first entry.

The expanded Projects sidebar includes a collapsible Agents overview below the sessions, combining
currently reported OpenCode instances from every session with their originating session, tab, and
status.

The Settings dialog is a single dialog mounted by `App` (`src/renderer/components/SettingsDialog.tsx`)
and opened through the workspace store's `openSettings(section)`, so any view can open it at a
given section. The Settings button above the terminals opens it at Appearance.

### Inbox

The Inbox is the third sidebar tab, beside Projects and To Do. It lists OpenCode conversations
("threads") like a mail inbox, the most recent agent action first. Each row shows the time since
that action ("5m ago"), the title, the folder name with the full path as a tooltip, the Git branch,
the model, and a status chip: Needs input or Needs permission, Done, Failed, or Working. Threads
with activity you have not opened are bold with a dot, and the tab shows how many there are. The
list can be searched by title, folder, branch and model, and filtered to All, Unread, Needs input
or Archived. The context menu marks a thread read or unread, archives it, or deletes it.

The Inbox is locked until Settings → OpenCode status reporting is on, and on platforms where the
status plugin cannot run (anything but macOS and Windows with WSL). The locked view explains why
and opens Settings → OpenCode. The main area shows the selected thread's conversation (see Inbox
chat), or the new-thread page when nothing is selected.

Threads come from two places and are never imported from OpenCode's history: conversations
started in the Inbox itself, and conversations run in MDE terminals, which the status plugin
(version 2.1.0 or newer) reports for each root conversation the terminal has shown (see OpenCode
integration). In the main process `src/main/inbox/recorder.ts` applies those reports, and the
service events of threads it already holds:

- A conversation that has only been looked at, never run, is not recorded.
- Finishing, failing, or asking for input or permission moves the thread to the top, marks it
  unread, and brings it back from the archive, as a reply does in mail. Starting work changes only
  the status chip, so a busy thread does not keep moving.
- When the terminal's OpenCode exits, its threads that were still working become idle.
- The branch is read with the same background Git query as the terminal header, for the thread's
  folder, when the thread is first recorded and after each activity. A failed read keeps the
  previous branch.
- Deleting a thread removes only MDE's record; it comes back if OpenCode reports new activity.

`src/main/inbox/store.ts` keeps the threads, the Inbox folders and the last composer choices in
memory and in `inbox.json` in the user-data directory, written at most every 500 ms with the same
temporary-file-and-rename write as `workspace.json`, and once more on quit. The file is at
version 2; a version 1 file loads with no folders. Loading validates every record, drops
malformed ones, shows threads that were working when MDE closed as idle, and keeps the 1,000 most
recent threads and 200 most recently used folders. The
renderer loads the list once at startup (`inbox:list`) and then follows `inbox:changed` pushes,
so opening the Inbox never waits for OpenCode or Git.

### Inbox chat

MDE has two modes that do not touch each other. The Projects tab ("legacy" mode) works with
projects, sessions and terminals in `workspace.json`. Inbox mode keeps its own list of folders in
`inbox.json` and never reads or changes projects or sessions. An Inbox folder is a directory and a
target: the Mac, or a WSL distro on Windows, where only WSL paths are accepted because OpenCode
runs there.

**New thread.** "New thread" at the top of the Inbox, or selecting nothing, shows "What should we
build in ‹folder›?". The folder name opens a menu of the Inbox folders with Add folder… and
remove buttons. Below it is the composer: a prompt box, a model picker (searchable, grouped by
provider, enabled and non-deprecated models only), an agent picker (Build, Plan, then any other
primary agent that is not hidden), and a send button. Enter sends and Shift+Enter adds a newline.
The folder, model and agent last used are remembered in `inbox.json`; otherwise the composer
starts with OpenCode's default model and the Build agent. Sending creates the OpenCode session in
the folder, records it as a chat thread, selects it, and sends the prompt.

**Conversation.** The thread view shows the newest 50 messages and loads older ones when you
scroll up. User messages are bubbles; assistant text is Markdown rendered read-only with the
preview's extensions (raw HTML off, links opened through the external-link validator); reasoning
is a collapsible "Thought" block; each tool call is a row with a status icon and a summary such as
"Read src/app.ts" or "Ran npm test" that expands to its full input and output, each cut at 64 KB.
Subagent calls (OpenCode's `subagent` tool, or `task` in older versions) are shown as cards instead: the agent type, the title, its state (Working, Done, Stopped, Failed) and a one-line preview of the task. Subagents started together are grouped under one heading, and a card expands to the full task and the answer rendered as Markdown. The subagent's own steps are not shown, since MDE only follows sessions it recorded. Agent and model switches, failures and stops appear as small notes. Text streams in as OpenCode
produces it. Permission requests (Allow once, Always allow, Reject) and questions (option buttons,
checkboxes, free text) are answered inline as cards; a question with field types MDE cannot show
asks you to answer it in a terminal. While the thread works, the send button becomes Stop. A
follow-up switches the session's agent or model first only when you changed them. The renderer
keeps the last ten opened threads in memory so going back to one is instant; MDE never writes
messages to disk.

**Transport.** OpenCode 2 runs one background service per machine, which its terminal UI also
uses, so a thread can be continued in a terminal (`opencode --session ses_…`) and both stay in
sync. `src/main/opencode/service/discovery.ts` finds the service for a target by running a fixed
script through the same login-shell launch as the session picker: `opencode service start`
(which does nothing when the service is already running), then printing
`${XDG_STATE_HOME:-~/.local/state}/opencode/service.json` between random markers on standard
output. The file's `url` must be plain HTTP on a loopback address with a port, and its password
1–256 printable characters. The endpoint is cached in memory per target and rediscovered once
when a request gets a 401 or cannot connect, or when the OpenCode executable in Settings changes.
On Windows, MDE reaches the WSL service at `127.0.0.1`, which needs WSL's localhost forwarding
(on by default); the error says so when it is off.

`src/main/opencode/service/client.ts` sends requests with Electron's `fetch` and HTTP Basic auth
(user `opencode`). Only a fixed list of OpenCode operations can be called, path parameters must
match OpenCode's ID patterns, requests time out after 30 seconds and responses are capped at
16 MB. `parse.ts` turns every response into MDE's own narrow types and drops unknown fields.
`events.ts` keeps one server-sent-event stream (`/api/event`) per target that has an active chat
thread, from the first request until status reporting is turned off or MDE quits. A dropped
stream reconnects with backoff and gives up after five failures in a row until the next request;
after a reconnect, open threads refetch. Events are matched to threads by session ID: text and
reasoning deltas, message and request changes, and run state go to the renderer for threads that
are open (`chat:subscribe`), and run starts, finishes, failures, renames and pending permissions
or questions update the thread's status in the Inbox. Events for sessions the Inbox does not
hold are ignored.

### Window chrome

The OS title bar is hidden (`titleBarStyle: 'hidden'`) and the renderer draws its own bar,
`TitleBar`, across the top of the window in both the full and the mini view. It is the window's drag
handle (`-webkit-app-region: drag`; buttons inside it opt out with `app-no-drag`) and hosts the
button that opens the mini window. On Windows and Linux the OS still draws the minimize, maximize
and close buttons over the right edge (Electron's Window Controls Overlay), so snap layouts and
resize borders keep working; the bar's content is confined to the area left of them with
`env(titlebar-area-x)` and `env(titlebar-area-width)`. macOS keeps its traffic lights and the bar
leaves room for them.

`src/main/window-chrome.ts` keeps those native buttons matching the app. The renderer sends the
current theme's panel and muted-text colors over `window-chrome:set` at startup and whenever the
theme changes, and the main process re-applies them with `setTitleBarOverlay`. The buttons are a
constant 32 device pixels tall. The bar does not hard-code a height: `.title-bar` reads it back
from `env(titlebar-area-height)`, which is that height as a CSS length at the current page zoom, so
the bar and the buttons stay level at any zoom. This also covers a zoom Chromium restores at
startup or that changes by mouse wheel, which the main process never sees. Do not scale the overlay
height by zoom in the main process: if its idea of the zoom differs from the page's, the buttons
overhang the bar and the bar's bottom line no longer meets them.

The hover and pressed backgrounds of the minimize and maximize buttons are a fixed wash of the
OS's own caption color, not something the app can set, and that color follows the OS light or dark
setting. On a dark bar under a light OS theme the wash is black and the hover is invisible, so the
main process sets `nativeTheme.themeSource` to match the brightness of the bar color. The close
button keeps its fixed red.

### Mini agents window

F12 shrinks the main window into a small always-on-top list of the same OpenCode agents, grouped by
session, with a status summary and a restore button; F12 again restores the full window. It is the
same `BrowserWindow` and renderer, not a second window, so the IPC sender policy is unchanged and
every terminal keeps running. The main process (`src/main/mini-window.ts`) owns the geometry: it
catches F12 in `before-input-event` while MDE is focused (there is no global hotkey, and the key
never reaches the terminal), remembers the previous bounds and maximized or fullscreen state in
memory, lowers the minimum size, and sets always-on-top. It then tells the renderer the new mode
over `window-mode:changed`, and `App` renders `MiniAgentWindow` instead of the sidebar and
terminals. Unmounting the terminals also stops their resize observers, so shrinking the window
never reflows a running TUI; they reattach and refit on restore. The mode event can reach the
renderer before the window has finished growing, so terminals hold off measuring until the
viewport has been quiet for 150 ms (`src/renderer/terminal/viewport-settle.ts`); otherwise a
live TUI would be shrunk to a few columns and straight back, leaving it half repainted. Clicking an agent restores the
full window, focuses that terminal, and plays the pane highlight on it (described under
Notifications) so you can see which one you picked. The mini window uses the same title bar as the full window,
with its title, agent count and restore button in it, and is not maximizable on Windows and macOS
(Linux has no such control). Its position is remembered only until MDE quits and nothing about it is
written to disk.

### To Do projects

A To Do project is a separate kind of project: a board with a name, an uppercase shorthand
(2–10 characters, such as `MDE`) and columns, which default to To Do, In Progress and Done. Tasks
have a title and description, are numbered per project (`MDE-12`), and move between columns by
drag and drop. Ctrl+F (Cmd+F on macOS) searches tasks in the open To Do project. A live terminal can
be linked to a task, and the task then shows that terminal's OpenCode status; these links are
runtime-only and are not saved to `workspace.json`.

### Terminal launcher

In a focused Mac or Windows/WSL terminal, Ctrl+N or Cmd+N opens a launcher for a new shell, OpenCode, Codex, or
Claude pane. It defaults to that terminal's current directory and can switch to the session
directory with Tab; the two directory choices are also clickable. If the terminal has not reported
its current directory yet, the session directory remains available. The session choice is disabled
when both paths are identical. The launcher keeps at most nine panes per tab.
Configure each executable and its shell-style arguments in the Settings dialog's Agents section.
Arguments are passed as literal argv values; shell expansion and command chaining are not supported.
Agent launch identity is runtime-only, so reopening the app restores ordinary shells rather than
relaunching an agent.

### OpenCode session picker

The history button above each Mac or Windows/WSL terminal, or Ctrl+Shift+O
in a focused terminal, opens the OpenCode session picker. It shows the native Mac account's or current distro's complete
history across all directories in compact rows grouped by folder. The terminal's current directory
comes first, with sessions ordered by most recent activity within each folder.
Search by title, directory, session ID, model, or agent. Archived sessions and subagent conversations
are included and labelled; the selected session's details show full dates, token usage,
and reported cost when available.

Click a session or use the arrow keys and Enter to resume it in a new pane in its saved directory.
Shift+Enter resumes it in the terminal the picker was opened from instead. That terminal's running
command or OpenCode task is interrupted, so the picker asks first unless the terminal has exited.
Shift+Enter also works on a full tab, because no pane is added. Escape closes the picker. At nine
panes the picker reports that the tab is full and disables Enter.

History uses the configured OpenCode executable's `opencode api` command, which answers from
OpenCode's local background service: `session.list` is read one page of 120 at a time by following
the opaque cursor (up to 100 pages), and `session.get` re-checks a session before it is resumed
with `--session`. Only a fixed set of operations and parameters is ever passed, each as its own
literal argument. Both require OpenCode 2 or newer; an older OpenCode reports that instead. If
optional metadata is unavailable it is omitted. The selected history and resume command remain runtime-only.
On Mac, agent and metadata commands run through the selected login shell with literal arguments.
Plugin management reads PATH, `OPENCODE_CONFIG_DIR`, and `XDG_CONFIG_HOME` from the native login
shell so Finder launches resolve the same global configuration as terminal launches. The default
config directory is `~/.config/opencode`. These operations have bounded timeouts and output sizes.

### Clipboard

Terminal clipboard shortcuts use the normal system clipboard, including for WSL sessions on Windows.
`Ctrl+C` copies selected terminal text and remains the normal interrupt when there is no selection;
`Ctrl+Shift+C`, `Ctrl+Insert`, `Ctrl+V`, `Ctrl+Shift+V`, and `Shift+Insert` are also supported.
On macOS, use the corresponding `Command` shortcuts. OSC 52 clipboard sequences are accepted, so
copying a selection from the OpenCode TUI updates the system clipboard even while its mouse mode
is enabled. Right-clicking highlighted terminal text copies it to the normal system clipboard.
On Linux, left-dragged text also becomes the desktop's separate PRIMARY selection, which middle-click
pastes without changing the normal clipboard. WSL terminals on Windows provide the same middle-click
workflow within MDE using an in-app transient selection; native Windows terminals do not.

### Files and drag and drop

Drag a file or folder from the Files tree on the right into any terminal to paste its full path.
A floating preview follows the drag, and the receiving terminal highlights where the path will land.
Paths use the source session's folder even when the terminal is in a different working directory.

Files can also be dragged from Finder, Explorer, or another file manager into any terminal pane. In a
normal shell MDE inserts target-shell-escaped paths without submitting them. In an alternate-screen
terminal agent, MDE pastes each target-side path separately so agents that support image paths can
create their native attachments immediately. Native sessions accept files from their host filesystem;
Windows WSL sessions translate accessible host paths into the active distro and explain why paths
cannot be reached there. File drops do not copy file contents or stage clipboard image bytes.

Open a Markdown file from the Files tree to preview it, or switch to Source to read its code.
The preview is a centered column by default; the width control beside Preview and Source makes it fill the
whole page instead, and the choice is remembered for every file.
The file viewer covers the terminal view while terminals stay mounted at their existing size.
The terminal view has its own stacking context so resize handles and pane overlays stay beneath the viewer.
Fenced `mermaid` blocks render with selectable text and follow the application's color theme.
Wide diagrams scroll horizontally to keep their labels readable. Diagram HTML labels, interactive links,
configuration directives, and frontmatter are disabled. Diagrams are limited to 16,000 characters
and 200 edges; invalid or oversized diagrams show their source instead.

## Git

Sessions whose folder is a repository show their branch, line change counts and commits ahead in
the sidebar. Each terminal header also shows the branch and worktree root for that terminal's
current directory when Git can read them. MDE polls that automatically through `src/main/git.ts`,
which runs read-only Git commands over the native, Windows and WSL transports.

Every Git process goes through one shared pool of three slots (`src/main/spawn-limiter.ts`), and the
polled readers queue behind requests you make yourself, such as opening the Git dialog. The sidebar
refreshes every session at once, and each refresh starts several processes (one `wsl.exe` each for
WSL sessions).

Git and `wsl.exe` processes are started on a worker thread (`src/main/exec-host.ts`), not on the main
thread. Starting a process is a blocking call, and on Windows it occasionally takes over 100 ms (about
one launch in eight on the machine this was measured on, whatever the executable, options or console).
The main thread also runs the window-drag loop and relays terminal input and output, so each slow
launch used to freeze dragging and terminal output; with a refresh every few seconds that was a
stall roughly every five seconds. A CPU profile of the main process showed every one of those stalls
was a single `spawn` call. On the worker, the same 120 launches caused no main-thread stall over
40 ms. The launcher has the same callback shape as `child_process.execFile`; other callers still use
that directly, because they run rarely.

Because those queries run without you asking for them, MDE treats the folder as untrusted input. A
complete working tree — one that arrives as an archive or copy with its own `.git` directory, rather
than a fresh `git clone` — can carry configuration that names programs Git would otherwise run
during a plain `status` or `diff`, so every Git call disables hooks, `core.fsmonitor`, external
diff and textconv helpers, credential helpers and in-tree attributes. Opening a terminal in such a
folder and running its commands yourself remains ordinary code execution: the hardening covers only
MDE's own automatic queries.

## WSL

- On Windows, `src/main/windows-executable.ts` resolves WSL to the canonical
  absolute executable under the Windows installation directory. Short-lived
  queries, PTYs and history queries share this resolver and an explicit host
  working directory; WSL's `--cd` selects the Linux working directory separately.
  Lookup is lazy and missing WSL never prevents native terminals from opening.
- Short-lived `wsl.exe` queries and path conversions go through `runWslCommand()` in
  `src/main/wsl/distros.ts`, which sets `WSL_UTF8=1`.
- WSL sessions launch the distro user's configured login shell, with an optional per-session
  override. MDE uses `wsl.exe -e` and a non-interactive `/bin/sh` bootstrap to preserve exact
  argument and environment handling; the visible terminal is the configured shell. MDE never uses
  `wsl.exe --`: `--` hands the rest of the command line to the distro's default shell, which
  re-parses it and mangles anything containing quotes, `$`, or `;`. The login shell is required
  because nvm/mise/bun/asdf put their shims on `PATH` from the login profile.
- The per-terminal Open in VS Code and File Explorer buttons follow the terminal's current
  directory. They start out pointing at the session's configured path, and supported shells then
  correct them at every prompt by reporting their working directory through OSC 7. MDE installs
  process-local prompt hooks for Bash, Zsh, and Fish; other custom shells need to emit OSC 7
  themselves or those buttons keep opening the configured path.
- Session paths are stored in the target's own format. `wslpath` is used only at the UI
  boundary — when the Windows folder picker returns a `\\wsl$\` / `\\wsl.localhost\` UNC path,
  when translating a dropped file, and when revealing a folder in Explorer.
- A session whose files sit under `/mnt/c` gets an inline warning about 9p performance. It is
  a warning, not a block.

Native Windows shells also resolve before PTY creation: the default PowerShell
and built-in PowerShell/cmd aliases use system locations. Custom Windows shells,
including PowerShell 7, need a full drive-qualified `.exe`/`.com` path; ambiguous
bare names fail with a configuration error. Native shells still start in the
project directory. Linux shell overrides and agent commands inside WSL retain
their existing target-shell behavior.

## OpenCode integration

All integrations are optional and read-only with respect to prompts and project files.

- **TUI status** is disabled by default for Mac and WSL terminal sessions. Open Settings → OpenCode, enable
  global status reporting, and install MDE's small plugin for the native Mac target or each WSL distro;
  restart OpenCode after installing or updating it. It requires OpenCode 2 or newer. The plugin is
  an OpenCode 2 terminal (CLI) plugin installed as `plugins/mde-status/` in the OpenCode
  configuration directory, with `tui.js` holding the logic and a no-op `index.js` completing the
  directory. It is discovered automatically, so no OpenCode configuration file is edited, and it runs
  inside the terminal's own `opencode` process, which is why it sees the `MDE_OPENCODE_STATUS_*`
  variables (OpenCode's shared background service does not). It is inert outside MDE terminals,
  writes only a short runtime snapshot under `/tmp/mde-opencode` in WSL or a private `mde-opencode`
  directory beneath the macOS user temporary directory, and does not modify project files
  or OpenCode configuration. MDE reads that snapshot locally on Mac or through the distro's `\\wsl.localhost\...`
  path and falls back to normal shell status when it is absent. Each terminal pane with a live
  OpenCode TUI appears in the global Agents overview below the Projects sessions, with its
  originating session, tab, and current status. Instance labels can use privacy-safe numbering or
  the current top-level OpenCode session title; prompts, messages, tool data, credentials, and
  filesystem contents are never included in the snapshot.
  Snapshots carry a PID and process start identity: Linux `/proc` start ticks for WSL, or
  `/bin/ps` start time with a fixed locale on Mac. After missed heartbeats, MDE checks this identity
  before clearing an exited instance; an inconclusive probe preserves the last status. Mac status
  directories have mode 0700 and snapshots mode 0600. Disposal removes a pane's snapshot;
  startup removes matching artifacts older than 24 hours. Plugin protocol 1 is unchanged, so older
  snapshots stay readable; plugin version 2.0.0 is the first for OpenCode 2.

  Plugin 2.1.0 adds an optional `threads` list for the Inbox: one entry for each root conversation
  the terminal has shown (at most 16, the current one first) with its session ID, title, folder
  (`location.directory`, or the terminal's working directory when OpenCode does not report one),
  model and provider identifiers, and its own status, worked out the same way as the pane status.
  A change to this list rewrites the snapshot without a new revision, so the pane highlight still
  fires only on status changes. MDE validates every entry and drops an invalid list rather than
  the whole snapshot. Older plugins keep working without the Inbox; Settings → OpenCode offers
  the update.

  The plugin subscribes to the terminal's event feed: `session.execution.started` marks work,
  `succeeded`/`interrupted` marks completion and `failed` marks an error that stays until that session
  runs again; `permission.asked`/`replied` and `form.created`/`replied`/`cancelled` (OpenCode's
  question prompts) mark attention. The feed carries every session of the shared background service,
  including those of other terminals in the same directory, so only sessions this terminal has
  displayed, and their subagents, count. The session shown in the terminal also supplies the
  title. The tab list is deliberately not used, because it holds every root session of a directory.
  Once a second the plugin drops work, permission and question entries that OpenCode's own state no
  longer shows, so a missed event cannot leave a pane stuck.
- **Notifications**: session rows and the Ctrl+O session switcher show a count for OpenCode
  agents that finished with unread results, or are waiting for permission or an answer;
  selecting the session clears completed-result counts while unresolved requests remain visible.
  The terminal pane itself also plays a one-shot highlight, about 1.5 seconds long, when its agent
  starts waiting for permission or an answer (accent color), finishes (green), or fails (red): a
  bright streak travels once around the pane's border while a soft inner glow fades in and out. It
  is triggered by a changed per-pane status revision, so title updates and the first report after
  launch stay quiet, and it is drawn from the theme colors. Under the OS reduced-motion setting
  the streak is replaced by a still fade. The state is renderer-only and is never persisted.
- **Desktop alerts** request Dock attention on macOS or flash the taskbar on Windows, and play
  the system sound when an agent completes, needs input, or fails while MDE is unfocused.
  Focusing MDE or disabling alerts clears attention. Native notification banners are not used.

## Upgrade notes

### Upgrading to OpenCode 2

MDE supports OpenCode 2 and newer; OpenCode 1 no longer shows status or session history.

- **Status plugin.** OpenCode 2 cannot load the old loose `plugins/mde-status.js` and logs a load
  error for it on every start. Settings → OpenCode shows "Update available" for it; installing
  replaces it with `plugins/mde-status/` and removes the old file, but only if it carries MDE's
  marker. A file of the same name from anyone else is left alone.
- **Token rate.** The separate token-rate plugin has been removed, because OpenCode 2 shows tokens per
  second itself. MDE no longer installs, updates, or removes it, and does not clean up after it.
  If it was installed, delete `plugins/mde-token-rate.tsx` from the OpenCode configuration directory
  and remove its `file://` entry from the `plugins` list in `cli.json` (and from `plugin` in the old
  `tui.json`, if you keep OpenCode 1 around). Until then OpenCode 2 reports a plugin that fails to load.

### Removing previously installed Codex hooks

Codex hook reporting has been removed. The Codex launcher and its command settings remain
available, but status, Agents overview entries, notifications, and desktop alerts are provided
only by OpenCode. Existing workspace and launcher settings remain compatible.

Previously installed hooks are not removed automatically. Restart MDE after upgrading; new
terminals no longer receive the `MDE_CODEX_STATUS_*` environment variables, so the old MDE hook
does not report status. To remove the unused hooks, repeat these steps in each WSL distro where
you installed them:

1. Close MDE and the Codex terminals that were launched before the upgrade.
2. Locate the Codex configuration directory: use the configured `$CODEX_HOME` if set, otherwise
   `~/.codex`. Back up its `hooks.json` before editing it.
3. In `hooks.json`, remove only command handlers whose `command` contains
   `mde-codex-status-hook-v1`. Preserve unrelated handlers, event groups, and configuration.
   A group containing both MDE and other handlers must retain the other handlers; remove a group
   only if removing the MDE handlers leaves it empty.
4. Check that `hooks/mde-status.sh` in the same directory contains the
   `mde-codex-status-hook-v1` marker, then delete that MDE-owned script.

The old `codex-status.json` in MDE's user-data directory is ignored and can optionally be
deleted. After closing the old terminals, the unused `/tmp/mde-codex` runtime snapshots in the
affected distro can also be deleted. Codex itself and unrelated Codex configuration remain intact.

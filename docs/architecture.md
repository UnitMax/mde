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

## Terminal sessions

Sessions own the name, platform, distro and optional shell override. Each session persists an
ordered set of terminal tabs. Every tab owns an
independent layout built by splitting individual panes; new tabs start with one fresh terminal.
Hold Ctrl to reveal + controls on the left, right, top and bottom of each pane. Clicking an edge
splits that pane in half and focuses a fresh shell on the chosen side. Each split has its own
ratio and draggable divider; focused dividers also accept arrow keys. Closing or exiting a pane
collapses only its parent split, so the rest of the arrangement keeps its proportions. Layouts
support up to 64 panes per tab as a resource bound, independent of their arrangement. The
renderer keeps one `xterm` instance per runtime terminal identity in a plain Map outside React.
Switching sessions or tabs re-parents terminal containers rather than disposing them, so each
process, its scrollback and its cursor position survive. Unvisited persisted tabs create their PTYs
lazily; the PTYs themselves do not survive application restart.

Creating a session requires a name and environment. New shells start in the user's home
directory: the native home directory or `~` in the chosen WSL distro. Each terminal pane remembers
its own last reported directory across MDE restarts. The main process stores these records in
`terminal-directories.json` under Electron's user-data directory, keyed by terminal identity, owning
session and native/WSL target. Layout edits cannot overwrite them. A restored directory is checked
before launch; missing, invalid or unavailable folders fall back to home. The reopened process is
a fresh shell; running commands and scrollback are not restored.

The same records cover the shared Inbox terminal. Inbox conversation terminals continue to use
the API thread's recorded folder. Directory reports are saved during use and flushed before MDE
quits; removing a pane clears its record. Custom shells must emit OSC 7 for directory changes to be
remembered. Bash, Zsh, Fish and Windows PowerShell have built-in reporting hooks.

Session-level directories remain removed. Old workspace path fields are ignored and omitted on the
next save; existing layouts need no migration and start at home until a pane directory is recorded.

The Sessions sidebar lists all sessions in one reorderable list. Each row shows its name with a
compact Native or WSL badge below it; WSL rows also show the distribution. Collapsed rows show
icons or initials, with environment details in their tooltip.
Optional terminal entries show pane names, tabs and current folders.

Each pane has a header (`TerminalPaneHeader`) that puts its name first. The title is the pane's
custom name, else the last folder of the terminal's current
directory (so four shells in four folders read differently), else `terminal`; hovering it shows the
full path. Double-clicking the title, or Rename in the menu, edits it, and keeping the derived name
stores nothing so it goes on following the folder. The header also carries the Git chip described
below. The actions stay out of the way: fullscreen, the ⋯ menu and Close
appear over the right edge of a hovered or focused pane (and always in fullscreen) without moving the
title. The menu holds Rename, Split right and Split down,
Open in VS Code and Show in File Explorer (WSL on Windows),
and Restart, which still asks for confirmation. When a tab has several panes, the focused one gets an
accent line under its header. The tab strip sits directly above the panes (`SessionTabStrip`); session and
environment details live in the sidebar. A tab is a quiet pill, and the one being shown is lifted off the
bar. A tab's close button appears when the pointer or
focus is on it (always on the tab being shown) in a slot the tab keeps for it, so tabs never change width
under the pointer; the only tab of a session has none. Double-click or F2 renames a tab. When there are
more tabs than fit, they scroll sideways (the mouse wheel included) under a fade at the ends that have
more, and the tab being shown is brought into view, so a new tab is never added out of sight.

The workspace is stored as `workspace.json` in Electron's user-data directory with separate
`todoProjects`, `todoTasks` and `sessions` arrays. Session array order is the persistent
sidebar order; tab names, order, active tab, pane order, layouts and resize
ratios are stored inside each session. On load, old project links are discarded while sessions keep
their former sidebar order and tab identities. Project groups are omitted on the next save; there
is no versioned migration. A layout contains an ordered pane list and a binary tree of
pane identities and splits (stable split ID, axis, ratio and two children). IPC and stored layouts
share strict validation of that tree, including unique IDs, matching pane order and bounded node
counts. The renderer positions panes in flat slots derived from the tree, keeping existing terminal
components mounted as splits are inserted, removed or reordered. Legacy sessions without tab data
are normalized to a single `Tab 1` on load. Older preset layouts reset to one pane while tab names,
identities and selection are retained; no layout migration is provided. Terminal and agent-command
preferences live in the renderer's `localStorage` instead (`mde.terminal-settings`).

The last active top-level tab (Sessions, To Do or Inbox) and selected Inbox thread ID are saved
in the renderer's `localStorage` (`mde.workspace-navigation`) whenever navigation changes after
startup. Initialization restores the tab after loading the workspace and Inbox, and restores the
thread only when it exists in the loaded Inbox (including newer thread events received during
startup). A missing thread opens the Inbox's new-thread page; that page's empty selection is also
remembered. Missing, malformed or unavailable storage defaults to Sessions. No existing workspace
or Inbox records are changed to store this preference.

Keyboard shortcuts are listed in the app under Settings → Keyboard Shortcuts; that list is defined
in `src/renderer/terminal/keyboard-shortcuts.ts`.

### Settings

The Settings dialog's Terminal section controls terminal behavior, including whether Escape exits
the temporary fullscreen view; it is enabled by default. Ctrl+Shift+F toggles fullscreen for the
focused terminal pane. The Sidebar section controls whether terminal pane entries appear
beneath each session; this preference is global and stored with the local terminal settings. The
Agents section configures the launcher commands described below. The application theme (Slate,
Ember, Frost, High contrast) and zoom are also adjustable. The Appearance section sets the terminal
font family, size and line height, and separately the font family of the file viewer's source code
preview; both families are chosen from the same list of installed monospace fonts and default to
its first entry. The code preview font family also applies to Inbox tool input, output and error
blocks, edit/write diffs (including line numbers and change markers), and their file paths and
change counts. Changes take effect immediately in the open conversation, including content
expanded or streamed afterward; code preview font selection is independent of the terminal font.

The Settings dialog is a single dialog mounted by `App` (`src/renderer/components/SettingsDialog.tsx`)
and opened through the workspace store's `openSettings(section)`, so any view can open it at a
given section. The Settings button in the title bar, next to the mini Inbox button, opens it at Appearance and is available in every mode.

### Inbox

The Inbox is the third sidebar tab, beside Sessions and To Do. It lists OpenCode conversations
("threads") like a mail inbox, the most recent agent action first. Each row shows the time since
that action ("5m ago"), the title, the folder name with the full path as a tooltip, the Git branch,
the model, and a status chip: Needs input or Needs permission, Done, Failed, or Working. Threads
with activity you have not opened are bold with a dot, and the tab shows how many there are. The
list can be searched by title, folder, branch and model, and filtered to All, Unread, Needs input
or Parked. A clear button appears inside the search field when it contains text; clicking it clears
the query and returns focus to the field. Hovering or focusing a row shows a car icon and a "Park" label; parked threads offer
"Move to Inbox" instead. The context menu pins or unpins a thread, marks it read or unread, parks
it, forks it, or deletes it. Pinned threads appear first in the same list with a small pin icon and
no separate heading; each group keeps the most recent activity first. Pins respect the search and
filter tabs, so parked pinned threads stay under Parked. The optional `pinned` flag is saved in
`inbox.json` through `inbox:set-pinned`; older records without it are unpinned.

The gear at the end of the filters opens the Inbox's display settings. One of them adds a
**Working** section to the sidebar, under the list rather than as another filter tab. Turned on, the
unpinned threads that are working right now move out of the list into it, the run that began last first, each
with the same row, menu and elapsed time, and they go back to the list (at the place their last
activity gives them) as soon as they stop. A thread that is done, failed, waiting for an answer or a
permission, not yet started or parked is not in it. A parked thread that is still working therefore
stays under Parked. Pinned working threads stay at the top of the main list and are left out of the
Working section and its count. Unpinning one moves it into Working while that section is enabled.
The section ignores the filter tabs, but the search narrows it along with the list. Its
header (an arrow, the name and a count) folds it up, leaving the count; while it is folded those
threads are not listed anywhere else. It takes at most 45% of the sidebar's height and scrolls beyond
that, and the list above keeps a small minimum height. Both choices are kept in the renderer's
`localStorage` (`mde.inbox-working-section`, off by default, and `mde.inbox-working-collapsed`, open
by default; `store/inbox-view.ts`).

The same menu has a **Project icons** switch (`mde.inbox-title-icons`, off by default, also in
`store/inbox-view.ts`). Off, a row shows its project's icon beside the project's name on the line
below the title. On, the icon moves in front of the title, ahead of the unread, fork and pin marks, and
the lines below start under the title instead. It applies to every row of the thread list, to the rows
of the Working section, and to draft rows (where the icon comes before the pen mark). A project
without an icon, or one removed from the Inbox, shows the plain folder, so every row has something in
front and the titles stay lined up. The switch takes effect at once.

**Drafts.** A new thread that was started and not sent is a draft, listed in a **Drafts** section
directly above Working. The section is not there at all while there are no drafts. A draft joins it
when its page is left with something in it, whether by choosing New thread, opening a thread or
leaving the Inbox, and it stays until it is sent or deleted, so there can be any number of them, each
for the folder it was written for. Rows look like thread rows: the first line of the text (or the
first file's name), the folder, a paperclip with the file count, and how long ago it changed, newest
first. Hovering a row says **Delete draft** where a thread says Park; a draft has nothing to park, so
the button asks first ("Delete this draft?") and then deletes the text and the files saved with it.
Opening a draft puts it on the new-thread page in its own folder to carry on with, and the row stays
in the list, marked as the open one, while New thread is not; choosing New thread then sets the
open draft aside and shows a blank page. Choosing New thread on a blank page, or one nothing was
typed on, does nothing. A thread started from a draft removes it. The section takes at most 35% of the
sidebar's height and folds up like Working (`mde.inbox-drafts-collapsed`); the filter tabs do not
apply to it, the search does (text, file name and folder). A draft whose folder was removed from the
Inbox is kept, labelled "Removed folder", and opens in whichever folder the page shows. Unsent
text in an existing thread is not listed here: it stays in that thread's box, as before, but the
thread's row in the sidebar carries a **Draft** chip while that box holds a message or a file and the
thread is not the open one (the open thread shows the text itself). A draft also remembers how it
would start: the agent, the model and, when **New worktree** is chosen, the branch it is cut from and
the branch name typed so far. Opening the draft brings them back, whatever was chosen last elsewhere;
a draft written before this, or one whose agent or model OpenCode no longer offers, falls back to the
last choice made (or the default). A row with a worktree shows a branch icon ("Starts in a new worktree cut from ‹branch›").
**Save as draft** (the pen button before Send in the new-thread composer, or Cmd+S / Ctrl+S in its
box) sets what was typed aside and shows a blank page, without leaving it; a note under the composer
says where the draft went and fades after four seconds. It is offered only on the new-thread page and
only once there is text or a file.

Opening a thread counts it as read, and so does something new happening in the thread you are
looking at (the Inbox showing and the window in front), as with an open mail. Since that leaves no
dot to see, the row glows and its status chip, in the list and in the thread's header, pops for
about two seconds (`inboxCues` in the workspace store, `.inbox-cue` in `index.css`; with reduced
motion only the glow remains). Only new activity counts: something that happens while the window is
in the background leaves the thread unread until the window comes back to the front. A thread you
mark unread by hand stays unread, even while it is the open one and after the window loses and
regains focus, until you open it again (its row, or returning to the Inbox) or something new
happens in it (`inboxMarkedUnread`).

The Inbox talks to OpenCode's background service directly (see Inbox chat). It is locked, with an explanation, anywhere MDE
cannot reach that service: everywhere except macOS and Windows with WSL. The main area shows the
selected thread's conversation, or the new-thread page when nothing is selected.

The new-thread page offers **GUI** (the default for every fresh page) and **Terminal**, as a menu chip
in the strip under the message box (`ThreadModePicker`), the first chip of the strip, in front of the
choice of where to run (see Git worktrees below); it is there for every folder, Git or not. The
choice belongs to the page, so a fresh page starts as GUI again and a draft remembers it. Both
create the same OpenCode API session with the selected folder or worktree, agent, model and variant,
then submit the same first message, attachments and skill mentions through the API. Terminal mode
opens the native OpenCode TUI in the main conversation area using `--session` and that session ID,
with `--server` pointing explicitly to the service Inbox uses. Its password stays in the main process
and the child environment; WSL receives it through `WSLENV`, never command-line arguments.
The Inbox sidebar, statuses, unread activity, pinning, parking, forks, Files and Changes continue to
use the same thread record and APIs. Background creation starts the agent through the API immediately;
the terminal attaches when the thread is opened. Switching away detaches the terminal view while its
PTY and scrollback stay alive. **Reopen OpenCode** reattaches to the same conversation after the TUI
exits; restarting MDE creates a fresh terminal for the saved conversation. Removing the thread disposes
its terminal too. An unfinished message preserved by a sidebar fork is shown above the terminal as
a saved draft, with an explicit send action; it is never submitted automatically. A failed first
message can likewise be retried without creating another session. The shared shell in the right
sidebar remains independent.

The OpenCode surface of a Terminal chat plays a one-shot border animation when its API status
starts waiting for permission or an answer (accent color), finishes (green), or fails (red).
A bright streak travels once around the border while a soft inner glow fades in and out, for
about 1.5 seconds. New activity can repeat the animation even if the status name stays the same;
title, branch, pin and read updates stay quiet, as does the first report of a thread. Each thread
keeps its own brief animation in renderer memory, so switching threads does not replay an expired
one. Under the OS reduced-motion setting the streak is replaced by a still fade. These animations
use Inbox API metadata only; they do not run in Sessions, GUI chat, or the shared Inbox shell.

Only new terminal threads store `mode: "terminal"`; older threads continue in GUI mode. Drafts
remember the chosen interface and forks inherit it. Each terminal thread has one reserved
`inbox-thread:<sessionID>` terminal/session identity. Main resolves its folder, target and configured
OpenCode executable from trusted Inbox state and refuses renderer launch overrides. Sidebar activity for these terminals comes from OpenCode service events.
The association follows the conversation the thread was created for; switching to another conversation
inside OpenCode's TUI does not relink the Inbox thread.

Threads are only the ones started in the Inbox; conversations run in terminals, and OpenCode's
history, are never imported. In the main process `src/main/inbox/recorder.ts` records each new
thread and applies the OpenCode service events of the threads it holds:

- Finishing, failing, or asking for input or permission moves the thread to the top, marks it
  unread, and brings it back from Parked, as a reply does in mail. Starting work changes only
  the status chip, so a busy thread does not keep moving.
- While a thread is working or waiting for an answer it carries `workingSince`, the time its run
  began on this computer's clock. Asking and being answered does not restart it; stopping, however
  it stops, removes it. It is not trusted across a restart: a thread that was working is shown
  idle on load and the stored value is dropped.
- The branch is read with the same background Git query as the terminal header, for the thread's
  folder, when the thread is first recorded and after each activity. A failed read keeps the
  previous branch.
- Deleting a thread removes only MDE's record; later events for it are ignored. For a thread that
  runs in a worktree MDE made, the delete dialog can also remove the worktree (see "Git worktrees
  for threads").

`src/main/inbox/store.ts` keeps the threads, the Inbox folders and the last composer choices in
memory and in `inbox.json` in the user-data directory, written at most every 500 ms with the same
temporary-file-and-rename write as `workspace.json`, and once more on quit. Loading validates
every record, drops malformed ones, shows threads that were working when MDE closed as idle, and
keeps the 1,000 most recent threads and 200 most recently used folders. A thread started in a
worktree also stores `worktree` (the folder's directory, the worktree's root, the new branch and
the branch it was cut from); like `forkedFrom` it is optional, and a malformed one is dropped
without losing the thread. A thread evicted by the 1,000-thread limit leaves its worktree on disk,
for the user to remove with `git worktree remove`. The renderer loads the list once at startup (`inbox:list`) and then follows `inbox:changed` pushes,
so opening the Inbox never waits for OpenCode or Git.

### Inbox changes

The Git changes in a thread's checkout show up in two places, both as the same view: its
branch, the files and lines added and removed, and the list of changed files. Choosing a file
reviews its diff.

- **The Changes tab** in the right-hand sidebar, beside Files and Terminal, for the thread that is open.
  It is always available, and it shows the number of changed files, so the open thread's
  changes are read while the sidebar is open. A new thread, which has no changes yet, does not
  offer it.
- **The thread list**, under each thread: a line with the number of files and the lines added
  and removed. Resting the pointer on it (or pressing Enter, or clicking, which keeps it open)
  lists the changed files in a popover beside the sidebar. A checkout with no changes, or
  without Git, leaves no line. This is off by default; the gear at the end of the Inbox
  filters has a menu with a **Git changes** switch, kept in the renderer's `localStorage`
  (`mde.inbox-sidebar-changes`). Off, the list itself reads no Git status.

These are uncommitted changes against HEAD: staged and unstaged tracked changes plus untracked
files, across the whole checkout even when the thread starts in a subfolder. Threads and forks
using the same checkout show the same changes. Commits clear the corresponding changes, and
switching branches updates the line and the branch shown on the thread.

The main process reads Git directly through the existing hardened native/Windows/WSL
runner and shared spawn limiter. It does not read conversation history, snapshots, turn
boundaries, or fork metadata. `inbox:changes` accepts a recorded thread ID and an optional
`details` flag (the file list); the main process resolves its directory. `inbox:change-diff`
accepts that ID and a file path, which must still be present in current Git status.
Paths are interpreted literally from the checkout root. Renames, deleted files,
binary files, detached HEAD, unborn branches, and folders without Git are supported.
Untracked files are absent from `git diff`, so each one costs a process to count; only the
first 50 are counted, and the popover says how many were left out of the totals.

Visible rows (when shown), the open thread, and an open popover or Changes tab refresh every
ten seconds and on window focus, and not while the window is hidden. Threads sharing a checkout location use one poller, coalesced
requests, and the same in-memory results. The renderer limits concurrent loads to two and
prioritizes the open popover or tab. Routine refreshes keep the last successful counts, file list,
and open diff visible; a failed refresh marks cached results stale and shows the error.
Git errors never alter read flags or activity order. The popover lists at most 200 files.

Choosing a file loads its current Git diff in a read-only review above the conversation,
in the style of a file opened from the tree; Escape closes it, as does opening a file from
the tree or leaving the thread. Patch previews are capped at 64 KiB and marked when shortened.
Binary files have no text preview. The only thing persisted is the thread-list switch above.
The file tree keeps its open folders while Changes is showing.

### Inbox chat

Right-click a thread and choose **Rename thread** to set a custom Inbox name, or
**Clear custom name** to restore its current OpenCode title. The optional `customTitle`
is saved in `inbox.json` through `inbox:set-custom-title`. It overrides the title in the
Inbox list, header and mini inbox; search matches both names. OpenCode title updates
continue independently, including title regeneration. Setting or clearing the custom
name preserves activity, unread status, pinning and parking and sends nothing to OpenCode.

The open thread's header has a **Regenerate title** button. It asks OpenCode's native title
agent to regenerate the current title (`PATCH /api/session/{sessionID}` with `title: ""`),
including while the conversation is running or parked. OpenCode chooses the title model
and conversation context using its own configuration. It may keep the same title when
generation is disabled, fails internally, or produces the existing title. MDE never sends
a chat prompt or creates another session for this action. Pending state and request errors
are kept per thread in memory. The main process coalesces concurrent requests, follows
`session.renamed`, and reads the title back after completion in case an event was missed.
Newer rename events take precedence over an in-flight readback; deleted threads stay deleted.
Updating a title preserves the thread's status, activity time, read state and parked flag (`archived`).

The Sessions tab works with terminal sessions in `workspace.json`. Inbox mode keeps its own list
of folders in `inbox.json` and never reads or changes workspace sessions. An Inbox folder is a directory and a
target: the Mac, or a WSL distro on Windows, where only WSL paths are accepted because OpenCode
runs there. The Inbox calls these folders projects. In the Add a project form the path can be typed or chosen with Browse. On the Mac that
opens the system folder dialog. On Windows it opens MDE's own folder browser, which lists only the
folders inside the chosen distro (the Windows file dialog cannot show a distro's filesystem). The
browser opens in the folder already typed when it exists, otherwise in the distro's home. It has
home and parent buttons, a breadcrumb, and a "Show hidden folders" switch, and it hands back a plain
Linux path.

**Projects.** The project manager is a dialog, opened from the folder-with-a-cog button beside the
Inbox settings gear in the thread list's filter row, or from "Manage projects…" in the new-thread
page's project menu (`InboxProjectsDialog`). It lists the projects by name with their folder, the WSL
distro and how many threads each has (a thread in a worktree counts for the project the worktree was
cut from), and offers Add project, Edit and Remove. Worktrees MDE made for threads are folders too
(`InboxFolder.worktree`) but are not projects and are not listed; they go with the thread's Delete.
Adding uses the same form as the new-thread page's "Add project…", with an optional name and icon.
Editing changes the name and the icon only: the folder, its target and when it was last used stay as
they are, so a project keeps its place in the new-thread menu (which is ordered by use) and its
threads are untouched. Another folder is another project. Removing asks first; the project's threads
stay in the Inbox (their rows then fall back to the folder's own name and the plain folder picture)
and the folder on disk is not touched.

A project's icon is either one of 55 built-in pictures (`INBOX_FOLDER_SYMBOLS` in
`src/shared/inbox-folder-icons.ts`, drawn with Lucide icons in `ProjectIcon.tsx`) with an optional tint
from nine colors, or a single emoji (typed, pasted or chosen from a short list; the system's own picker
works too). It is stored on the folder as `icon` (`{ kind: 'symbol', id, color? }` or
`{ kind: 'emoji', emoji }`) and shown in place of the plain folder picture on each thread row in the
Inbox sidebar (with the project's name, so a rename is seen there), on draft rows, on the mini Inbox
window's group headings, in the new-thread page's heading and project menu. A worktree thread or draft
takes the picture of the project it was cut from. There are no image files: nothing is read from disk
or fetched, an emoji is only ever drawn as text, and a stored icon that does not validate is dropped
when `inbox.json` is read, leaving the plain folder.

The Inbox also shows a right-hand sidebar with three tabs, Files, Changes and Terminal (a new thread, which has no changes yet, offers Files and Terminal). The Files tab shows the open thread's folder, or the folder a new thread starts in. It is the same tree and viewer as in Sessions mode, but browse-only: the VS Code and File Explorer buttons are hidden. The renderer passes the thread's or folder's own ID to `files:list` and `files:read`; the main process looks it up in the Inbox store when no workspace session has that ID.

**Resizing.** Dragging the sidebar's left edge makes it wider (up to 70% of the window) or narrower (never under 260 px). The edge is a keyboard-operable separator: Left and Right arrows change the width by 16 px (64 with Shift), Home and End go to the limits, and a double-click restores 260 px. One width serves all three tabs and is kept in the renderer's `localStorage` (`mde.inbox-sidebar-width`).

**Terminal tab.** The Inbox has one terminal, shared by every thread: it is the same whichever thread (or the new-thread page) is open, and it keeps running while the sidebar shows another tab or the Sessions view is open. It reuses the Sessions view's terminal layout (`TerminalView` in its embedded mode: no tab strip or session header, and Ctrl split controls, Ctrl+Shift+F and the pane-switch shortcuts acting only while the keyboard is inside it, so typing in the composer is never intercepted). Splitting any pane on any side, resizing the dividers, reordering panes, pane titles, fullscreen, restart, and the terminal launcher work as in Sessions. Each pane reopens in its last reported directory, falling back to home: `~` in the default WSL distro on Windows, the home directory on the Mac. The layout and its dividers are kept in `localStorage` (`mde.inbox-terminal-layout`) and come back as fresh shells on the next run; the shell processes themselves are not restored. Directories are saved separately in the main-process terminal records. The layout edits shared with the Sessions view live in `src/renderer/terminal/layout-edits.ts`, and the Inbox's copy of the state in `src/renderer/store/inbox-terminal.ts`.

The terminal is not a workspace session and is never stored. Terminal requests name it with the reserved session ID `inbox-terminal` (`src/shared/inbox-terminal.ts`), which the main process resolves on demand (`src/main/inbox/terminal.ts`) for terminal requests. File and Git requests can also name a live terminal ID and its expected directory; naming `inbox-terminal` as a saved file-root session still fails.

**New thread.** "New thread" at the top of the Inbox, or selecting nothing, shows "What should we
build in ‹project›?". The project name, with its icon, opens a menu of the Inbox projects with
remove buttons, then Add project… and Manage projects…. Changing the folder keeps what was typed; the draft moves to the new folder. Below it is the composer: a prompt box, a model picker (searchable, grouped by
provider, enabled and non-deprecated models only), an agent picker (Build, Plan, then any other
primary agent that is not hidden), and a send button. Enter sends; Shift+Enter and Ctrl+J add a newline.
On the new-thread page, Ctrl+Enter (also Cmd+Enter on macOS) starts the thread in the background
and leaves a blank, focused composer for the next thread. The folder, agent, model and worktree
mode and base stay selected; a custom worktree branch name is cleared for the next thread.
The send button's hover hint shows the shortcut. Enter and clicking Send open the created thread.
If the first message cannot be sent after creation, the thread opens with its saved draft and an error for retry.
Both the new-thread and follow-up inputs show Markdown bullet markers (`-`, `*`, or `+` followed
by a space) as formatted bullets while typing. A newline continues the current bullet list;
on an empty item it leaves the list.
`ChatInput` uses the existing CodeMirror Markdown parser and text editor. It decorates bullet
markers rather than rendering HTML, so pasted HTML, links and images remain literal text.
Code fences stay literal, and drafts, skill positions and sent messages keep plain Markdown
without converting it through HTML. Clipboard images still go through the attachment controls.
In an existing thread, Up in an empty message box recalls the user's earlier nonempty messages,
newest first; Down moves forward and returns to the empty box after the newest recalled message.
Editing a recalled message ends history navigation. Recall uses this thread's visible conversation
and pending messages, loads older pages when needed, and restores only text, leaving attachments
as they are. Recalled text uses the normal draft saving path; there is no separate stored history.
The model picker shows the selected provider and model as “Provider / Model”, with a muted provider prefix.
The folder, model and agent last used are remembered in `inbox.json`; otherwise the composer
starts with OpenCode's default model and the Build agent. Sending creates the OpenCode session in
the folder (or in a new worktree, below), records it as a chat thread, selects it, and sends the
prompt.

**Right-click menus.** Right-clicking the conversation opens a menu that depends on what is under
the cursor. **Copy** copies the selected text, but only when the click lands on the selection;
right-clicking elsewhere does not copy text the pointer has left. **Quote**, next to it, adds the
selection to the message box (see Quoting, below). **Copy code** appears over a
code block or the input and output of an opened tool call. **Copy link address** and **Open link**
appear over a link; Open link is offered only for `http:` and `https:` links and uses the same
`noopener,noreferrer` window as clicking one, and the main process still decides what may be
opened. **Copy message as Markdown** appears over a message that has text. For a reply it copies
the text parts as Markdown source, so code fences and lists survive, and leaves out reasoning and
tool calls. **Select all** selects the conversation, and **Copy conversation as Markdown** copies it
as `## You` and `## Assistant` sections (notes, reasoning and tool calls are left out); while
earlier messages have not been loaded the item reads "Copy loaded messages as Markdown". One menu
serves the whole transcript, so a selection that runs across several messages can be copied. What
was clicked is recorded when the menu opens, so a reply that is still streaming cannot change what
is copied. A copy that fails (the clipboard channel accepts 2 Mi code units) shows a message under
the conversation until the next copy works.

Right-clicking the message box offers **Cut**, **Copy**, **Paste** and **Select all**. Cut removes
the text only after it is on the clipboard. Paste asks the main process (`clipboard:paste`) to paste
into the focused field, exactly as Ctrl/Cmd+V does, so pasted images take the usual attachment path.
The menu closes first and the box gets the focus back before the paste is requested. The page never
reads the clipboard. Cut and Paste are unavailable while the box is disabled. The menus add no
shortcut of their own, so the shortcut list has no entry for them.

**Quoting.** Text selected in a conversation can be quoted into the message box, from a **Quote**
button that shows beside the selection or from **Quote** in the right-click menu (which, like Copy, is
offered only when the click lands on the selection, and not for a selection of blank space). The button
(`ChatQuoteButton`) waits until the pointer is let go instead of chasing a selection that is still being
made. It sits below the end of the selection, centered on where the pointer was let go; for a selection
made upward, or when there is no room below, it sits above (`quoteButtonPlace`, kept inside the
visible conversation). It follows the selection as the conversation scrolls, goes when the selection
collapses or scrolls out of view, and steps aside while a right-click menu is open. Pressing it does not
take the selection or the focus, and it clears the selection once the quote is asked for. The menu's item
attaches the quote after the menu has closed, so that the box is free to take the focus.

A quote is attached to the message like a file, not typed into it: it shows as a card above the box
(`ChatQuoteCard`), and the box stays free for what the person writes, however much was quoted. A card
is a bar beside the quoted text, cut to two lines (with an ellipsis), with a chevron to open all of a long
quote (up to a height, then it scrolls) and an X to take it off the message. Whether a quote is long
is measured, since it depends on the width: a single line that wraps past two lines is long too. Taking
a card off, or attaching one, gives the focus back to the box. The cards scroll inside a fixed height when
there are many, and the one just added is brought into view. The same quote is not attached twice. The
text of the selection is its plain text, tidied (`lib/chat-quote.ts`): no space at the ends of lines, no
blank lines around it, and no run of more than one blank line. While the draft is still loading or a
send is under way, a quote waits for the box, since a send empties it; one that would take the message
past the 100,000 characters the main process accepts is refused with a message under the box. A message
may be sent with quotes alone.

Written down, a quote is a Markdown block quote: `> ` before each line and a bare `>` for a blank line.
The draft is kept, and the message is sent, as the quotes written that way, each followed by a blank
line, and then the text (`joinQuotes`), so the agent reads ordinary Markdown quotes and no main-process
or IPC change is involved. When the draft is read again (the box opening, a revert or a fork adding text
to it, Up recalling the last message) the quotes at its start become cards again and the rest is the text
(`leadingQuotes`); a place in the draft, such as where the caret goes, is moved by the length of what
was taken. Up does not recall over quotes that are attached. A quote that is not at the start of the text,
or a `>` typed by hand, stays in the text, and the box draws lines that start with `>` (up to three spaces
in, not in a code fence) with a bar and muted text; a line without the mark is not part of the quote, so a
new line (Shift+Enter) ends it. One scanner in `lib/chat-quote.ts` decides what is a quote for all of this.

In the conversation, the quotes of a sent message are shown as quote cards among the text, without
their marks and in the same style, cut to three lines with **Show more** / **Show less** under a long
one. **Copy message as Markdown** still copies the message as written, marks included, and the prompt
timeline names a message by what was written, not by what it quoted. There is no keyboard shortcut for
quoting, so the shortcut list has no entry for it.

**Git worktrees for threads.** The strip under the new-thread composer (`ComposerBar`) always holds the
GUI / Terminal chip. When the folder is a Git repository it also chooses where the thread runs
(`WorktreeBar`, which puts that chip first and a divider after it, so the chip keeps its place when Git's
answer arrives; for a folder without Git, or when Git cannot be asked, the strip holds the chip alone).
**Current directory**, the default, runs it in the
folder as it is and shows the folder's current branch (or "Detached HEAD"), read-only; MDE never
switches a branch. **New worktree** replaces the branch label with a "From ‹branch›" picker: a
searchable list of local branches and then remote-tracking branches that already exist (for example
`origin/main`), starting from the current branch, else `main`, `master` or the first local branch.
Next to it is a **New branch name** field. Left empty, which is the default, MDE names the branch
`mde/‹id›`; typed in, the name is used as it is. The page checks the name as you type (plain ASCII
letters, digits and `. _ - / +`, Git's other branch-name rules, at most 100 characters, and not a
local branch that exists or one that would sit inside or on top of another, since `feature` and
`feature/login` cannot both exist) and disables sending while it is invalid. MDE never runs `git fetch`, so a remote branch is as current as the last fetch. Every visit and
every folder change starts in **Current directory**, so a worktree is always a deliberate choice;
the choice is not remembered between visits, only with a draft, which opens with it again (but not in
another folder, whose branches differ). The strip is absent when the folder is not a repository or Git cannot
be run, and **New worktree** is disabled in a repository with no branches yet. The renderer asks
for the branches with `inbox:git-info` (a folder ID) and starts the thread with
`chat:create { …, worktree: { base, branch? } }`; it never names a path.

`src/main/inbox/worktree.ts` does the work in the main process. It re-lists the refs and accepts
`base` only if it is one of them, passes the full refname (`refs/remotes/origin/main`, never the
bare name) so it cannot be taken for a tag or a path, and runs
`git worktree add --no-track -b ‹branch› -- ‹path› ‹refname›` from the folder, where `‹branch›` is
the chosen name or `mde/‹id›`, and `‹id›` is eight random hex digits. A chosen name is validated
again here (`src/shared/worktree-branch.ts` holds the rules both sides use) and checked against the
local branches and with `git show-ref`, so an existing branch is refused with a message instead of
reused. `--no-track` keeps the new branch from tracking its base, so a push does not
target it. The worktree goes to `~/.mde/worktrees/‹folder name›-‹folder id›/‹id›`, in the home
directory of the folder's own target (a WSL distro's `$HOME` on Windows), so the repository itself
stays clean and nothing needs ignoring. A folder inside a repository (`packages/app`) gets the
thread running in the same subfolder of the worktree when the base branch has it, and in the
worktree root otherwise. The session is then created in that directory, so the thread, its file tree,
its branch label and any fork of it all follow the worktree. If the session cannot be created, the
new worktree and its branch are removed again; if only the first message fails, they are kept with
the thread and its draft, like any new thread. A clash with an existing generated branch or folder
retries with a new id up to three times; a chosen name is never retried, and a branch that appears
under that name in the meantime is left alone, not cleaned up. The folder under `.mde/worktrees`
is always named from the random id, never from the branch name.

**Worktrees in the folder chooser.** When a thread is started in a new worktree, MDE also adds the
worktree to the Inbox folders (`InboxFolder.worktree` holds the same record the thread carries, and
`directory` is the thread's directory, so a monorepo subfolder is kept). The folder menu then lists
real folders first and a **Worktrees** group below them. A worktree shows its branch with a
WORKTREE tag and "Based on ‹base branch› in ‹original folder›", which is the Inbox folder with the
repository's directory, or that directory's last segment once the folder has been removed. The
heading reads `‹folder› · ‹branch›` and its tooltip names the same. Choosing one starts threads in
it: the strip shows "Worktree" instead of the where-to-run choice (the branch it is on is still
shown), no worktree request is sent, and the thread runs in that directory with the folder's
worktree record, so the header marker, the delete dialog and forks behave as for the thread that made
it. A worktree cannot be cut from a worktree: the main process refuses a `worktree` request for such
a folder. Worktree folders have their own limit of 100, apart from the 200 real folders, so a run of
worktrees cannot push the folders out, and without a remembered choice the page starts on a real
folder. The menu's remove button forgets the entry only, and the worktree stays on disk. Removing a
worktree through the delete dialog also drops its entry and its draft, and a worktree deleted by hand
stays listed until it is removed from the menu. Threads started in a worktree before this existed are
not listed.

The sidebar and thread header name the folder the thread was started in rather than the worktree's
random directory, and the header shows a WORKTREE marker with the worktree's path and base branch
as its tooltip. A fork of a worktree thread shares the worktree, as it shares the directory.

**Removing a worktree.** The delete dialog for a thread whose worktree no other thread uses has an
unticked "Also remove the worktree" box. Ticking it runs `git worktree remove` (never `--force`)
before the thread is forgotten, so Git refusing because of uncommitted changes leaves the thread in
place with Git's reason shown, and unticking the box deletes the thread alone. The branch is always
kept. The main process checks again that no other thread shares the worktree and that its root is
inside `~/.mde/worktrees`, and a worktree already deleted by hand counts as removed.

**Conversation.** The thread view shows the newest 50 messages and loads older ones when you
scroll up. User messages are bubbles; assistant text and reasoning are Markdown rendered read-only
with the preview's extensions (raw HTML off, links opened through the external-link validator).
Reasoning is a collapsible "Thought" block and updates as it streams, using the same Markdown
renderer as replies; each tool call is a row with a status icon and a summary such as
"Read src/app.ts" or "Ran npm test" that expands to its full input and output, each cut at 64 KB.
Subagent calls (OpenCode's `subagent` tool) are shown as cards instead: the agent type, the selected model and variant, the title, its state (Working, Done, Stopped, Failed) and a one-line preview of the task. The model uses the same display name as the composer; hovering reveals the full provider/model ID. MDE reads the child session named by the tool's metadata (or its result/error wrapper), checks that it belongs to the recorded parent, and returns only its model. Reads are deduplicated per page, limited to four at once, and time out after two seconds; unavailable models do not prevent the conversation from loading. Model and agent selection events in these child sessions refresh the open parent. Subagents started together are grouped under one heading, and a card expands to the full task and the answer rendered as Markdown. The subagent's own steps are not shown. Agent and model switches, failures and stops appear as small notes. Text streams in as OpenCode
produces it. Permission requests (Allow once, Always allow, Reject) and questions (option buttons,
checkboxes, free text) are answered inline as cards; a question with field types MDE cannot show
asks you to answer it in a terminal. While the thread works and the box is empty, the send button becomes Stop. A
follow-up switches the session's agent or model first only when you changed them. The renderer
keeps the last ten opened threads in memory so going back to one is instant; MDE never writes
messages to disk.

**Timeline and scrolling.** From the second prompt on, a slim rail at the right edge of the
conversation has one short mark for each of the user's prompts (`ChatTimeline`, with the pure
logic in `lib/chat-timeline.ts`). The marks follow the reading position: the turn being read, the
last prompt to reach about a third of the way down the view (the last one once scrolled to the
end), is brightest, other prompts on screen are lit, and the rest are dim. A long conversation draws
the 18 marks around the turn being read and fades the ends. Hovering the rail grows it into a card
listing the prompts (their first line, or the attachment or skill names when there is no text), opened
on the turn being read; clicking one scrolls the conversation to it, smoothly unless the system asks
for reduced motion, and a prompt near the end stops at the end. From the keyboard the rail is one tab
stop (Shift+Tab from the message box reaches it): Up, Down or Enter opens the card and focuses the
current prompt, Up, Down, Home and End move, Enter jumps, Escape closes it. Only the loaded
messages are listed, and held (steered or queued) messages are not prompts yet. While the view is
scrolled up (more than 80 px from the newest message), a **Scroll to bottom** button floats above the
message box; it takes the reader to the newest message and following new output again. In a pane narrower than 50 rem the conversation and the message box keep a wider
right margin while the rail is there, so that it does not touch the text.

**Steering or queueing a message.** With the agent working and something typed, the round send
button grows into a pill (`ChatSendButton`): an arrow and **Steer**, and a chevron that opens a menu
with **Steer** (the agent reads it at its next step) and **Queue** (sent when the agent is done).
Choosing in the menu does not send; it changes what the button says and what Enter does, so the box is
given the focus back. The choice holds for the rest of that run and starts as Steer again with the next.
Send with the agent idle is the plain round button and sends no choice, since an idle agent takes the
message up at once either way. The choice goes with the message as `delivery` on `chat:send`, which puts
it in the prompt body (`POST /api/session/{id}/prompt`); the first message of a thread has none. In a box
narrower than 30rem the word is left to screen readers and the tooltip, so the pickers keep their room.
(There is no keyboard shortcut for the other way; a held message can be switched afterwards, below.)

**Messages held for the agent.** A message sent while the agent is working is not added to the
conversation at once. OpenCode accepts it into the session's *inbox* and hands it to the agent later:
a `steer` message at the agent's next step, a `queue` message when the agent would otherwise stop. The
send button chooses which (below); a message queued from OpenCode's own interface is shown as queued
too. Until it is delivered the message is not in the message list, so the thread shows it
apart, after the conversation and above the "Working for" line, which is where the delivered message
lands (`ChatPendingView`). It is drawn like the user's message it will become (text, files, skills) with a
dashed outline and a line saying what happens to it (Steering, Queued), and **Remove** takes it back
(`chat:discard-pending`, `DELETE /api/session/{id}/inbox/{id}`; one already delivered stays, and the next
read shows it in the conversation). While the agent runs, a second button switches the message between
the two ways, **Queue instead** on a steered one and **Steer now** on a queued one (`chat:set-delivery`,
`PATCH /api/session/{id}/inbox/{id}` with `{ delivery }`). The switch shows at once, a refusal puts the old
way back and says why, and a second click on the same message waits until the first is answered. The
service answers 409 for a message it no longer holds (the agent took it up), one that already has that
delivery, and one it never had, so a refusal is told as "the agent may already have taken it up"; the next
refetch shows where the message went. The button is not offered when nothing is running, because then both
ways wait for the next run. (Steering a message held after a Stop would start the agent and deliver
everything held, which MDE does not offer.) A message keeps its ID when it is delivered, so the delivered
one replaces the pending one in the same place. After a Stop nothing is running, but OpenCode keeps the held
messages until the next message starts the agent again and then delivers them all; the line then says
"Not sent yet" and Remove is the way to drop them.

The held messages come with the newest page of messages as `pending` (`GET /api/session/{id}/inbox`,
`parsePendingMessages`, user messages only, at most 50, read *before* the message list so that a message
delivered between the two reads is in both rather than in neither). A page without `pending` means the
service did not say and the thread keeps what it had; `pending: []` means none. The
`session.inbox.enqueued`, `.delivery.changed`, `.cancelled` and `.delivered` events make the thread
refetch. A message sent to a busy thread is shown at once from the prompt's own answer (`chat:send` returns
the held message, `parsePromptAnswer`), not after the next refetch; one sent to an idle thread is not set
aside, since it goes straight into the conversation. The store notes when it last changed what is held
(`pendingChangedAt`), and a refetch that began before that is not allowed to undo the change, so a message
neither blinks out when a read from just before the send comes back, nor returns after being removed, nor
switches back after being switched.

**Skills.** A skill is a folder of instructions (a `SKILL.md`) that OpenCode finds in the project
(for example `.claude/skills/<name>/SKILL.md` in the folder) and in the user's own configuration, plus a
few it ships with; where OpenCode looks is up to OpenCode, and MDE shows whatever it lists. A word that starts with `$` in either composer
opens a list of the skills that fit it, above the box (`SkillPicker` in `ChatComposer.tsx`; the
rules for what counts as a `$word` are in `src/shared/skills.ts`, shared with the sender). Up and Down
move, Tab or Enter write `$name ` over the word, Escape closes the list until that word is gone, and a click
does the same as Enter without moving the caret out of the box. The list only opens when something
matches, so `$HOME` or `cost$5` never takes over Enter. The skills come with the composer's options
(`ChatOptions.skills`, from `GET /api/skill`, cached for a minute with the agents and models): only the
id, name and one line of description reach the renderer, never a skill's text or path. OpenCode answers
the first request for a folder it has not loaded with an empty list, and its built-in skills are always
present, so an empty answer is asked for again a few times; a failure leaves the list empty and the
pickers working.

When a message is sent (a new thread's first message or a follow-up), the main process looks for `$name`
in the text where the name is a skill's id, exactly, at the start of a word, and sends each skill once as
`skills: [{ id, mention: { start, end, text } }]` next to the unchanged text; OpenCode then gives the
model the skill's instructions with the message. The skills are listed for the directory the session
runs in (the worktree, for a thread started in one), because OpenCode refuses a skill its session cannot
see. `$text` that is not a skill is plain text, a message without a `$` costs no extra request, and if
the listing fails the message goes without the skill rather than not at all. The offsets are UTF-16
indices; OpenCode stores them as given and does not check them. In the conversation, the user's message
shows a chip for each skill it used. When the model loads a skill itself (OpenCode's `skill` tool) the
call is a "Loaded the demo skill" row that expands to the skill's instructions and the files that
come with it, without OpenCode's wrapper and its note about the skill's directory; a skill that cannot be
found says so on that row. A skill activated by other means appears as a note whose details are the
skill's text, and the `session.skill.activated` event refreshes the conversation.

**Slash commands.** In a conversation's message box, a message that starts with `/` and the name of a
command is that command, not a message for the agent. (The new-thread page has no commands, because a
command acts on a thread, so a slash there is plain text.) Typing a `/` as the first character opens a
list of the commands that fit (`CompletionPicker`, the same list the `$` skills use; the rules are in
`lib/slash-commands.ts`): Up and Down move, Tab writes `/name ` over the word (without the space for a
command that takes nothing), Enter does the same, or runs a command that takes nothing more, Escape closes
the list until that word is gone, and a click does what Enter does without moving the caret. Names match
by prefix, then by containing the text, then by a word of the description, and an alias counts as the
name. Once the message is a command its name is marked in the text (a CodeMirror mark in `ChatInput`),
and the send button becomes the command's own round button ("Run /btw") instead of Send, or Steer /
Queue while the agent works: a command is not delivered to the agent. Enter runs it with what follows
the name (trimmed, over several lines if need be): the box empties at once and the command works on its
own, so the person can go on typing; a command that fails gives the text back with the reason under
the box, and one whose required argument is missing says what to add and runs nothing. So does text
after a command that takes none (`/fork and fix it`), which would otherwise be dropped unread. The name
is read in any case, as a whole word at the very start. Everything else that starts with a slash, such
as `/etc/hosts is wrong` or `/btwx`, is an ordinary message and is sent as written. The commands are MDE's
own and are defined in one place, `slashCommands()` in `lib/slash-commands.ts`: a name, aliases, a
description, an optional argument (a hint and whether it is required) and `run`. A new command is one
more entry there, with whatever it needs from the thread added to `SlashActions`. The entry points
(typing `/`, the list keys, Escape) are in the keyboard shortcut list.

**Side questions (`/btw`).** `/btw <question>` asks something about the conversation without becoming
part of it, as OpenCode's own `/btw` does: the answer is written from the conversation as it stands, no
message is added to the thread, and the agent is neither interrupted nor told, so it also works while the
agent is busy, which is what it is for. The main process (`InboxChatService.aside`, the `chat:aside`
channel) sends OpenCode's `POST /api/session/{sessionID}/generate`, which generates text from the session's
context without writing to its history, with OpenCode's own preamble in front of the question ("a quick
side question about the conversation so far; answer directly and concisely in markdown; do not call any
tools and do not take any actions"). The model that answers is the one set on the session, not the
service's default (a session whose model is unavailable fails with that model's own error). A model
call over the whole conversation takes longer than a read of the service, so this request waits up to
three minutes instead of thirty seconds. A service without the route says to update OpenCode, and an
empty answer says that OpenCode gave none.

**Compaction.** Compacting summarizes the conversation so far to free up context: OpenCode replaces
the older messages, from the model's point of view, with a summary and keeps the latest ones as they
were. It is asked for in two places: the `/compact` command (alias `/summarize`, no argument) and a
**Compact conversation** button under the breakdown in the context pill's menu. Both end in
`compactThread` in the Inbox store and the `chat:compact` channel (`InboxChatService.compact`), which
sends OpenCode's `POST /api/session/{sessionID}/compact` with `{ delivery: 'queue' }`. OpenCode answers
at once and does the work in the background (about ten seconds for a small conversation, as a model call
over the whole of it), so the request only says whether it was taken; the work shows up in the
conversation. `queue` means that a request made while the agent is working waits for the turn to end
(OpenCode holds it in the session inbox, where it is not one of the user's messages), so a turn is not cut
in the middle; an idle thread starts at once. A route the service lacks says to update OpenCode.

OpenCode writes the compaction into the conversation as a message that goes from *running* to
*completed* (with the summary, which is Markdown, the model, and the tokens the summarizing call used)
or *failed* (with the reason: nothing to compact yet, a provider error). `parseMessage` maps these to
notes that carry a `compaction` status, and the service events `session.compaction.started`, `ended` and
`failed` refetch the conversation so the note changes as it goes. A running note shows a spinner
("Compacting the conversation…"); a completed one is a row that opens to the summary rendered as
Markdown, with the size of the summary beside it (the tokens the call wrote, which is about what the
summary takes); a failed one is an error row with the reason, without the provider's response body.
A compaction OpenCode starts itself when the window is full is told the same way ("automatically").

A compaction asked for while the agent works is held by the service, and the newest page of messages says
so (`compactionHeld`, read from the same inbox list as the held messages), which shows as a line under
the conversation: "Compaction is waiting for the agent. It starts when the agent finishes." The renderer
refuses to ask for one that would only fail: while one is running (the newest compaction note says
running and the thread is working; a note left running by a service that stopped does not count), while
one is held, while no step has finished yet, and straight after one completed with nothing new since
(`compactAll` in `ChatThreadView`; OpenCode would write a failed note for each of these, such as "Nothing to
compact yet", and also for a second request made while the first runs). The refusal is a reason: under the
box for `/compact`, which gets its text back like any failed command, and under the conversation for the
menu button. The menu button says what it will do (waiting for the agent, compacting, just compacted) and
is switched off in those states.

What the context holds after a compaction is not known until the next reply reports its tokens, and the
old count would be wrong, so `contextUsage` marks it `compacted`: the pill reads "Compacted" with the gauge
dark and calm, and the breakdown shows the size before and the summary's size instead of the old
composition. The first finished reply after the compaction measures it again.

The question and its answer are held per thread in `store/inbox-aside.ts` (memory only: nothing is
stored, and they are gone when the app is closed). A thread shows one side question; asking another
replaces it, and an answer that arrives for a question that has since been replaced or dismissed is
dropped. It is shown as a card of its own above the message box (`ChatAside`), not in the conversation:
a `btw` mark and the question (two lines, the rest in the tooltip), a thinking state while the answer is on
its way, then the answer as Markdown with the same renderer as the agent's messages (it scrolls when it is
long), a Copy button and a dismiss button, and a line saying that it is not added to the conversation. A
failure shows the reason and a Retry that asks the same question again. The card stays until it is
dismissed or replaced, and an answer that arrives while another thread is open is there when the thread is.
Escape dismisses it (the first Escape only closes an open command list; from inside the card, the caret
goes back to the box), and a conversation that is following its end stays at its end when the card
appears.

**Goals (`/goal`).** A goal keeps the agent working on an objective until a reviewer decides it is met.
It is OpenCode's own `opencode.goal` plugin; MDE only starts, controls and shows it, and keeps no goal
state of its own. `/goal <objective>` sets one, and `/goal pause`, `/goal resume` and `/goal clear` (in any
case, with or without quotes, which is how OpenCode reads them) act on it, so those three words cannot be
an objective on their own. The objective is checked in the renderer before it is sent
(`goalObjectiveProblem` in `shared/goal.ts`, which the main process and the IPC validator use too): it must
not be blank, one of those words, or longer than OpenCode's 4,000 characters, and the reason is shown
under the box like any failed command. The command is defined in `slashCommands()` and ends in
`setGoal` in the Inbox store and the `chat:goal-set` channel (`InboxChatService.setGoal`), which runs
OpenCode's command with `POST /api/session/{sessionID}/command` and `{ name: 'goal', text }`. Setting a goal
also applies the agent and model the box shows to the session, as a message would (`applyChoice`, shared
with `send`), so the goal does not run on a model the person did not choose. A service without the
command says to update OpenCode; OpenCode's own refusals (pausing a goal that is not active, for one) are
passed on in its words.

The state is read with the plugin's RPC, `POST /api/rpc/opencode.goal/get` (`chat:goal`,
`InboxChatService.goal`), when a thread is opened and when the event stream reconnects, and is pushed by
the plugin's `rpc.opencode.goal.changed` event, which `onEvent` forwards as a `goal` chat event. A service
without the plugin answers 404 or an RPC error, which means "no goal". A goal is `{ id, objective, status
(active, paused or complete), reason?, rounds, maxRounds (50), stalls?, updatedAt }`; `reason` is the
reviewer's last finding while it runs, the evidence when it is met, and why it stopped when paused. A read
that was started before a newer event arrived is dropped (`goalChangedAt`), so a slow answer cannot put an
old state back.

While a goal exists the thread shows **`ChatGoalCard`** above the message box (in the same slot as the
`/btw` card, which stacks below it). It has a target mark and the word GOAL, a status line, the round, the
objective (opening to the whole of a long or multi-line one with "Show all"), the reviewer's reason, and the
actions that fit: Pause while it is active (Resume while paused, Dismiss once it is met) and a clear
button. The status line says what an active goal is doing (`goalPhase` in `lib/chat.ts`, from the
messages and whether the agent runs): "Working toward the goal"; "Checking whether the goal is met…" when
the agent is idle after a finished reply, which is the reviewer's turn (it runs inside the agent's
execution, so the thread stays *working*); "Waiting for background work" when nothing runs and no reviewer
is expected; and, in the warning color, "Waiting for your answer" when a question or permission is open.
The reviewer and waiting phases are shown only once they have lasted a moment (900 ms and 2.5 s,
`useSettledPhase`), so the card does not flicker through states that last a blink and does not claim
"waiting" on a thread that has just been opened. A paused goal says "Paused by you" when the person paused
it (OpenCode's reason for that, "Paused by the user", is not repeated) or "Paused" with the reason when the
reviewer stopped it, and its Resume starts the agent again. If the agent is still finishing the step it
was on when paused, the card says so. When the last round changed nothing (`stalls`), or five rounds or
fewer are left of the 50, a warning line says that OpenCode will pause the goal. Actions are asked for, not
assumed: a button is busy until the service answers, a refusal is shown on the card, and the new state is
the one the service reports. Another goal (a new ID) is a new card, so nothing of the last carries over.
The card settles in with a short animation, and while the agent works or the reviewer checks, a light runs
along its top edge and the status dot pulses; under reduced motion the animations stop and the light stays as
a dim line.

OpenCode writes a message into the conversation when a goal starts, resumes, and each time the reviewer
sends the agent back to work (a synthetic message marked `source: goal`, told by the `session.synthetic`
event). `parseMessage` turns these into notes with a target icon instead of a "System note": "Goal set" and
"Goal resumed" open to the objective, and "Goal not met yet, working on it" opens to what the reviewer
found missing, as prose. The instructions that OpenCode wraps around them are not shown.

**File changes.** The `edit` and `write` tools are drawn as diffs instead of raw JSON, one card per
file (`ChatFileChange`): a header with the verb ("Edited", "Created", "Overwrote"), the path
relative to the thread's folder, and `+added −removed` counts, then the lines with a line-number
gutter, green and red tints taken from the theme's `ok` and `danger` colors, a mark on the words
that changed within a line, and syntax colors from the same table as the file viewer
(`lib/syntax-style.ts`). Each side of a hunk is colored as its own piece of code, so a comment or
string spanning lines reads right; a language that is unknown or too big shows plain. The card is
open by default and folds from its header; a diff over 40 lines starts at 28 with "Show N more
lines". A whole file written at once is only lightly tinted. For a finished edit the diff is the
one OpenCode reports in the tool's metadata (`filediff`, or `files` when it lists several), kept
by `parse.ts` as a unified diff capped at 64 KB per file and 256 KB per call, which gives exact
line numbers and context. While an edit runs, or waits for permission above the permission card,
there is no such diff yet, so the diff is worked out in the renderer from the call's own
`oldString` and `newString` (`lib/diff.ts`), without line numbers. A write has no diff in
OpenCode's metadata, so its content is shown as additions, and only whether the file already
existed is known (once the tool has finished). A failed edit keeps the plain row with OpenCode's
reason. A script's calls to MCP servers get a card of their own (see **MCP servers**), and every other
tool is unchanged.

**MCP servers.** OpenCode can be given MCP servers (programs or remote services that offer tools to the
model) in its configuration. MDE shows the ones OpenCode lists for the folder or thread, and connects or
disconnects them as OpenCode's terminal UI does; it never reads, writes or starts one itself. A pill
after the agent picker in the composer's toolbar (`McpChip`, on the new-thread page and in a thread)
shows "MCP" and how many servers are connected (`1/2` when some are not), with a dot for the worst
state: a failed server or one that needs a sign-in (both with a warning icon), one still connecting, or
all well. It is not there when OpenCode lists no server, or is too old to have the list. It opens a
list with a switch for each server and its state: Connected, Connecting…, Disabled, Failed (with
OpenCode's error, shortened and stripped of credentials and paths), or Sign-in needed. A switch calls
OpenCode's runtime connect or disconnect (`POST /api/experimental/mcp/{server}/connect` or
`/disconnect`), which lasts until OpenCode restarts; nothing in OpenCode's configuration changes, and a
server disabled in the configuration reads "Disabled" like one disconnected here. MDE does not guess
the result: the row shows a spinner while the change is made, and when OpenCode has answered the list
is read again and shown as it is. A server that needs a sign-in, or whose state MDE does not know, has
no switch (a connect could start a sign-in on the machine running OpenCode); its row says to run
`opencode mcp auth <name>` in a terminal. While the agent works a change is allowed and applies from its
next step. On the new-thread page with a new worktree chosen the list is the folder's and is shown
but cannot be switched, because the worktree loads its own servers. In a thread each row also counts the
calls the shown conversation made to that server ("3 calls", or "3+ calls" when older messages that are
not loaded may hold more).

The list is kept in `store/inbox-mcp.ts` for each service and directory. It is read when the chip
appears and when the list is opened, when the window gets the focus back (at most every five
seconds), when OpenCode reports that a server changed (`mcp.status.changed` or `mcp.tools.changed`,
which carry no session, so they reach the store as a `mcp` chat event for the service) and when the
event stream reconnects, after a switch, and every 1.5 seconds (at most 20 times) while a server is
connecting, because the stream may not be open. A read that began before a switch is thrown away
and made again, so an older answer never undoes the change. In the main process `mcpList` is never
cached. OpenCode answers the first request for a folder it has not loaded with an empty list, so
until a place has answered once, an empty answer is asked for again a few times (six times, 0.75
seconds apart); a place that answers empty after that is taken to have no servers.

By default OpenCode does not give the model one tool per MCP tool. It gives it a single `execute` tool
that takes a JavaScript snippet calling `tools.<server>.<tool>({…})` (Code Mode), and lists the calls the
script made (`server.tool`, status, arguments) in the tool part's metadata. `parse.ts` keeps up to 20
of them, each with its arguments cut at 4 KB, and the time from the tool starting to finishing. The
conversation draws any `execute` with calls as a card (`ChatMcpCall.tsx`), whether or not the server
list has loaded. Closed, a single call is one line: a badge with the server (a plug on the accent colour
for a listed MCP server, a neutral badge for OpenCode's own tool groups such as `browser`), the tool, its
arguments in short and, for a small result, the answer (`→ sum: 12`), with the script's time at the
right; several calls read "Called 2 tools" and the servers. Opened, it shows each call with its
arguments, one result for the whole script (OpenCode reports no result or time per call), the error,
and the generated script behind a "Script" button. The result is laid out and coloured when it is
JSON, shown through the same safe Markdown renderer as replies when it is plainly Markdown (and only
while the card is open), and otherwise as text, cut after twelve lines with a button for the rest. A
tool's output is untrusted: it is only ever text or safe Markdown, with no raw HTML or remote images.
A server whose Code Mode is off exposes direct tools named `<server>_<tool>`; those are recognised by
the longest listed server name they start with and drawn the same way (that form has not been observed
against a live OpenCode). An `execute` without calls, such as one still being written, stays a plain
row, and a lookup of a server's tools reads "Looked up demo_math tools".

**Context usage.** Once a step of the conversation has finished, a pill in the composer's bottom
row, left of the send button, shows how full the model's context window is: a five-segment gauge
and a token count (`ContextMeter`). The count is the newest finished assistant step's own tokens
(new input, cache read and write, output and reasoning), which is what the conversation held after
that step; a step that is still streaming has no count yet. The window is the *chosen* model's
`limit.context` from OpenCode's model list, so picking another model in the composer shows at once
whether the thread still fits. The gauge turns amber from 70% and red from 90%, and its last lit
segment pulses while the thread works. Without a known window the pill shows only the count, and
below about 30 rem of composer width the gauge collapses to an icon. Clicking the pill opens a
breakdown: the count against the window, one bar split by kind of token, the thread's total tokens
and the cost OpenCode reports (many providers report $0), and the model's window and reply limit.
The thread totals come from `session.get`, requested with the newest page of messages only, so
they stay right however many older pages are loaded; if that request fails, the conversation
still loads and the totals are left out. After a compaction the size is not known until the next
step finishes, so until then the pill reads "Compacted" (see "Compaction" below). The pill does not
appear in the new-thread composer, where nothing has been measured yet.

**Time worked.** A line under each turn says how long the agent worked on it (`TurnDuration`,
`ChatTurnTime.tsx`), such as `Worked for 1m 30s`, and while the turn is still going the same line
reads `Working for 1m 30s`, counting up every second, with a spinner and a light moving along its
rule (`WorkingFor`). A turn is a user message with everything after it up to the next user message
(`turnStats` in `lib/chat.ts`); a goal's notes (set, resumed, and each time its reviewer sends the agent
back to work) begin a turn as well, because a goal starts work with no user message, so a goal set a day
after the last prompt is timed from the goal, and each round gets its own line without the reviewer's time
between rounds. It began when the user's message (or the goal's note) was created and ended when
its last step completed, both from the service's own timestamps, so the difference does not depend
on this computer's clock; the line sits under the turn's last step and above any note about how the
run ended. A turn whose user message is in an older, unloaded page, or that has no finished step,
has no line. For the turn in progress the count starts from the thread's `workingSince`, which is
on this computer's clock like the count itself, and falls back to the user message's time only when
there is none; a clock that disagrees with the service's, as WSL's can after the computer sleeps,
therefore cannot skew it. The sidebar's `Working` pill counts from the same `workingSince` (`Working
· 1m 30s`); the pill in the thread's header only names the state, and `Needs input` pills show no
time. The finished line also carries the model's generation speed when OpenCode's numbers give
it, such as `Worked for 1m 30s · 53.1 tok/s`. The service has no such field; OpenCode's own
interface works it out from the same messages, and `tokensPerSecond` in `lib/chat.ts` does the same
sum: the output and reasoning tokens of every step in the turn, divided by the time those steps spent
generating, from the step's `time.created` to its `time.streamed` (the end of the stream). The time a
step then spends running tools lies between `streamed` and `completed` and is not counted. A turn
with a step that lacks those times, or with no tokens, shows no speed. One difference from OpenCode:
when a message is sent while the previous one is still being worked on, OpenCode joins both into one
turn, where MDE shows a line for each. Durations are cut off to whole seconds and shown as `45s`, `1m 30s`, `2m` or `1h 5m`
(`lib/duration.ts`), with the full words in a tooltip. The counters are timers that run only while
they are on screen.

**Reverted messages.** OpenCode can revert a conversation to an earlier point (`/undo` and the
message actions in its terminal UI). That is staged, not done: the session records a `revert` with
the first message to hide and the files whose changes were undone, the files on disk are put back
at once, and every message stays in the session until the next message, a compaction, or a commit
makes the revert permanent by deleting the messages from the boundary on. A redo clears the revert
and puts the files back as they were. `session.get` reports it, so the newest page of messages
carries `revert` (`parseSessionRevert`: the first hidden message and, per file, its path, what the
revert did to it and the line counts, without the diff), and the `session.revert.staged`, `.cleared`
and `.committed` events make the thread refetch. A page without `revert` means the service did not
say, and the thread keeps what it knew; `revert: null` means none. The page still holds every
message. The thread view cuts the conversation before the first hidden message, as OpenCode's own
interface does (message IDs sort in the order the messages were written, `hideReverted` in
`lib/chat.ts`), and so does everything computed from the conversation: the context pill, the turn
times and the agent and model the composer starts from. Where the hidden messages would be, a note
(`ChatRevertBanner`) says how many of your messages are hidden, lists the files that were restored
(Restored, Removed or Recreated, with line counts; a list of more than six starts folded and shows
twenty), and warns that sending a message removes the reverted messages for good. When the revert
reaches back past the pages that are loaded, the thread loads earlier pages, one after another,
until a message before the cut is in view, which also makes the count complete; a page that fails
stops it. Reverted messages are only hidden in MDE; this is also what shows a revert made in a
terminal.

The note has a **Redo** button (`chat:redo`, `InboxChatService.redo`). It sends
`DELETE /api/session/{sessionID}/revert`, which clears the staged revert and makes OpenCode put the
files back as they were when the revert was staged, so any edit you made to those files since then
is replaced. The thread drops its `revert` at once, which shows the hidden messages without waiting
for a refetch, and the `session.revert.cleared` event and a refetch then confirm what OpenCode
holds. While the request runs the button reads "Redoing…" and ignores clicks; a failure keeps the
note and the hidden messages and shows the reason under the summary, so the button can be used
again. OpenCode refuses while the agent is working ("Stop it, then redo"), and a service without
the route (an unknown route answers 404 with no body, where a missing session answers with a named
error) is reported as too old. A redo of a revert that is no longer staged does nothing.

**Reverting to a message.** Each of your own messages has an undo button that appears on hover or
keyboard focus. It opens a dialog (`ChatRevertDialog`, hosted by the thread view because the message
it belongs to is hidden by the revert) that quotes the message, says how many of your messages go,
and offers "Restore file changes", ticked by default, with the warning that changes you made to
those files yourself since then are replaced. It also says when the agent is still working (it is
stopped first) and when the message had attachments (they are not put back), and that a redo is
possible until the next message is sent. Confirming calls `chat:revert`
(`InboxChatService.revert`): it ensures the thread's event stream, always interrupts the session,
then sends `POST /api/session/{sessionID}/revert/stage` with `{ messageID }`, adding
`files: false` only when the box was unticked. OpenCode answers 409 while the session is still
stopping (`interrupt` returns before the work has ended), so a busy answer is retried every 250 ms
up to 40 times and then reported as "OpenCode is still stopping this thread. Try again in a moment."
Any other failure stops at once: a missing message ("That message is no longer in the
conversation."), a service without the route ("…does not support reverting. Update OpenCode…",
told apart from a missing session by the 404 having no named error), or OpenCode's own message. A
failed interrupt means nothing is staged. The result is the same `ChatRevert` the banner shows,
and the thread view hides the messages at once, with the service's events and a refetch
confirming. A folder that is not a git repository has no snapshot, so the revert hides messages
only and lists no files.

The message text then goes into the thread's saved draft **above** whatever is already there,
separated by a blank line (`InboxDraftStore.prepend`, the `prepend` draft action, applied inside
the store's serialized queue so a keystroke saved a moment earlier is kept; a blank text changes
nothing, and a result over the draft's 100,000 characters is refused). The composer then reloads
the draft, focuses the box and puts the caret at the end of the restored text. The revert has
happened by then, so if the draft cannot take the text, the thread shows a notice saying so
instead of failing the dialog; sending or redoing clears the notice. The text is the only thing
put back: attachments are not. The message is not deleted from
OpenCode until the next message is sent, which makes the revert permanent. Only your own messages
can be reverted to for now; stepping back to the middle of a turn is not offered. To keep the
conversation and try another way, fork it instead (below).

**Forking a thread.** A fork is a new Inbox thread that starts with a copy of another's
conversation and goes on from there; the original is not stopped, reverted or otherwise changed.
It is offered in three places. The sidebar's right-click menu has **Fork thread**, which forks the
whole conversation, and so does typing `/fork` in the thread's message box. Each of your own messages
has a fork button beside the revert button, which forks from just before that message and puts its text
in the new thread's box, so you can say it differently without losing the original; there is no
confirmation because nothing is deleted. A sidebar fork that fails shows its reason in the panel, a
message fork in the thread, and a `/fork` under the box, which gets the command back. Each ignores a
second request while its own fork is in progress (a second `/fork` is refused with a reason and gets
its text back).

`chat:fork` (`InboxChatService.fork`) sends `POST /api/session/{sessionID}/fork` with
`{ before: <message ID> | null }`. OpenCode 2.1.4 copies the messages under new IDs inside the
service, with their tokens, costs, timings, agent and model and any attachments (stored a second
time by OpenCode), and starts the new session idle in the same project and directory, with the
session's own cost and token totals at zero. Its title is the original's plus ` (fork #N)`, where N
counts the depth of forks of forks, so forks of one thread share a title; the thread keeps that
title, and the marker below tells them apart. A fork that names a message cuts there. A fork of the
whole conversation sends `null`, except in two cases, which the main process works out first
(`forkBoundary`) because OpenCode would copy what the person is not looking at:

- **A staged revert.** The copy would bring back the hidden messages and carry no revert, so the
  fork is cut at the revert's first hidden message.
- **A working agent.** The message the agent is answering would arrive with no reply. The fork is
  cut before the turn in progress, which starts at the oldest user message after the newest `idle`
  message (OpenCode writes one when the agent stops; `parseTurnMarkers`, `unfinishedTurnStart`),
  reading back up to ten pages of messages to find it. Its text is returned with the thread, so the
  new thread's box offers it again; the original keeps working.

The result is recorded by `InboxRecorder.recordForkedThread`: idle, read, not parked, in the
original's folder, target, directory and branch, and with `forkedFrom` set to the original's ID. It
copies those from the original thread rather than looking up its folder, so it still works if the
folder has been removed. Events never add threads, so this is the only way a fork appears. The
renderer (`forkThread` in the Inbox store) puts the thread in the list, opens it, then adds the text
to its draft the way a revert does. Failures say what happened: a message that is gone ("That
message is no longer in the conversation."), a service without the route (a 404 with no named
error, "This OpenCode service does not support forking. Update OpenCode and try again."), or
OpenCode's own message; if only the draft cannot take the text, the new thread opens with a notice.

The restored text reaches the box through `draftReloads` in the store, a pending instruction to
read the draft again, take focus and put the caret after the added text. A composer applies it
whenever it sees it, including when it appears after it was set, and then calls `clearDraftReload`,
so what runs first, the box or the text, does not matter and a thread opened later is not told
again. Attachments are not put back in the box, as with a revert, and both threads share one working
directory, so file changes made by either show up in both, which the new thread's header says. When
that directory is a worktree MDE made for the original, the fork shares the worktree too, and it is
removed only with the last thread that uses it.

The new thread's header says "Forked from" with the original's title, a link while the original is
still in the Inbox, and the sidebar row shows a small fork icon. `forkedFrom` is stored in
`inbox.json` as a thread ID and dropped if it is not one; it is not otherwise used.

**Transport.** OpenCode 2 runs one background service per machine, which its terminal UI also
uses, so a thread can be continued in a terminal (`opencode --session ses_…`) and both stay in
sync. `src/main/opencode/service/discovery.ts` finds the service for a target by running a fixed
script through the target's login shell: `opencode service start`
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
thread, from the first request until MDE quits; at launch, streams reopen for threads that were
still working. A dropped
stream reconnects with backoff and gives up after five failures in a row until the next request;
after a reconnect, open threads refetch. Events are matched to threads by session ID: text and
reasoning deltas, message and request changes, and run state go to the renderer for threads that
are open (`chat:subscribe`), and run starts, finishes, failures, renames and pending permissions
or questions update the thread's status in the Inbox. Events for sessions the Inbox does not
hold are ignored, except that a change to an MCP server, which names no session, makes the renderer
read that service's server list again.

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

### Mini Inbox window

F12 shrinks the main window into a small always-on-top list of Inbox threads, grouped by their
Inbox folder, with a status summary and a restore button; F12 again restores the full window.
It shows GUI and Terminal chat threads using the same titles, branch names, unread state and
API-driven status as the Inbox. Parked threads are hidden; pins and recent activity determine
the list order. Threads whose folder was removed still appear under the directory name, and
worktrees fall back to the original repository name. It uses Inbox metadata independently of workspace sessions and terminal layouts. New activity stays unread while only the mini Inbox is
visible. It is the
same `BrowserWindow` and renderer, not a second window, so the IPC sender policy is unchanged and
every terminal keeps running. The main process (`src/main/mini-window.ts`) owns the geometry: it
catches F12 in `before-input-event` while MDE is focused (there is no global hotkey, and the key
never reaches the terminal), remembers the previous bounds and maximized or fullscreen state in
memory, lowers the minimum size, and sets always-on-top. It then tells the renderer the new mode
over `window-mode:changed`, and `App` renders `MiniInboxWindow` instead of the sidebar and
terminals. Unmounting the terminals also stops their resize observers, so shrinking the window
never reflows a running TUI; they reattach and refit on restore. The mode event can reach the
renderer before the window has finished growing, so terminals hold off measuring until the
viewport has been quiet for 150 ms (`src/renderer/terminal/viewport-settle.ts`); otherwise a
live TUI would be shrunk to a few columns and straight back, leaving it half repainted. Clicking a thread restores the
full window and opens that conversation in the Inbox, marking it read through the normal Inbox
selection action. The mini window uses the same title bar as the full window,
with its title, thread count and restore button in it, and is not maximizable on Windows and macOS
(Linux has no such control). Its position is remembered only until MDE quits and nothing about it is
written to disk.

### To Do projects

A To Do project is a separate kind of project: a board with a name, an uppercase shorthand
(2–10 characters, such as `MDE`) and columns, which default to To Do, In Progress and Done. Tasks
have a title and description, are numbered per project (`MDE-12`), and move between columns by
drag and drop. Ctrl+F (Cmd+F on macOS) searches tasks in the open To Do project.

### Terminal launcher

In a focused Mac or Windows/WSL terminal, Ctrl+N or Cmd+N opens a launcher for a new shell, OpenCode, Codex, or
Claude pane. It uses that terminal's current directory and waits for the shell to report it
before enabling commands. New launcher panes split their source pane to its right,
preserving the surrounding arrangement and its divider ratios. The per-tab resource limit is 64 panes.
Configure each executable and its shell-style arguments in the Settings dialog's Agents section.
Arguments are passed as literal argv values; shell expansion and command chaining are not supported.
Agent launch identity is runtime-only, so reopening the app restores ordinary shells rather than
relaunching an agent.

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

In Sessions mode, the Files tree follows the selected terminal’s current directory. Selecting another
pane or changing directory resets the tree to that root. File previews belong to that terminal and
directory, so the same relative filename in another root cannot reuse an earlier preview.

Drag a file or folder from the Files tree on the right into any terminal to paste its full path.
A floating preview follows the drag, and the receiving terminal highlights where the path will land.
Paths use the source tree’s root. The main process resolves a terminal root from the live PTY and
checks the expected directory before listing, previewing, attaching, or resolving a drag; stale
requests fail if that terminal has moved to another directory. Inbox folder roots still use their
saved folder or thread identity.

Files can also be dragged from Finder, Explorer, or another file manager into any terminal pane. In a
normal shell MDE inserts target-shell-escaped paths without submitting them. In an alternate-screen
terminal agent, MDE pastes each target-side path separately so agents that support image paths can
create their native attachments immediately. Native sessions accept files from their host filesystem;
Windows WSL sessions translate accessible host paths into the active distro and explain why paths
cannot be reached there. File drops do not copy file contents or stage clipboard image bytes.

Open a Markdown file from the Files tree to preview it, or switch to Source to read its code.
The preview is a centered column by default; the width control beside Preview and Source makes it fill the
whole page instead, and the choice is remembered for every file.
Right-clicking rendered Markdown or a source preview offers **Copy** and **Select all**.
Copy uses the selected text; Select all selects the file contents without the viewer toolbar or
surrounding app. Source selections cover the full document, including lines outside the viewport.
Copy uses the existing main-process clipboard channel and shows a message if the clipboard write fails.
The file viewer covers the terminal view while terminals stay mounted at their existing size.
The terminal view has its own stacking context so resize handles and pane overlays stay beneath the viewer.
Fenced `mermaid` blocks render with selectable text and follow the application's color theme.
Wide diagrams scroll horizontally to keep their labels readable. Diagram HTML labels, interactive links,
configuration directives, and frontmatter are disabled. Diagrams are limited to 16,000 characters
and 200 edges; invalid or oversized diagrams show their source instead.

## Git

Each terminal header shows a compact chip with the branch and tracked line changes for its current
directory. Changes without line counts, including untracked entries and binary changes, show a
changed-entry count, and a clean checkout shows the branch alone. Commits ahead, the worktree root
and the clean state are in the chip's tooltip. In a pane narrower than 22rem the chip shrinks to the
branch icon, plus a dot when there are changes, so the title keeps its room. Clicking the chip opens
changes, diffs and recent history for that checkout. Queries run from the checkout root, so a terminal inside a subfolder still reviews the
whole repository. Changing directory closes an open Git dialog and clears the old metadata. The
session sidebar shows the launch directory and environment; it has no Git view or Git polling.

MDE polls terminal metadata every ten seconds, on directory changes and on window focus through
`src/main/git.ts`, using read-only native, Windows and WSL commands. It never overlaps a header’s
refreshes. The Inbox’s worktrees create and remove a worktree on request through a separate runner.
Every Git process goes through a shared pool of three slots (`src/main/spawn-limiter.ts`), where
polled readers queue behind requests such as opening the Git dialog.

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

The runner for worktree requests (`createGitMutationRunner`) keeps all of that hardening except
in-tree attributes, which a checkout has to honour: reading attributes from the empty tree would
write a repository that uses LFS or line-ending conversion with the wrong content. It also allows
two minutes instead of ten seconds, since a checkout writes a whole working tree. Because hooks
stay disabled, a `post-checkout` hook (a tool installing its own hooks, say) does not run in a new
worktree.

## WSL

- On Windows, `src/main/windows-executable.ts` resolves WSL to the canonical
  absolute executable under the Windows installation directory. Short-lived
  queries, PTYs and OpenCode service discovery share this resolver and an explicit host
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
  directory. They become available once the shell reports it through OSC 7. MDE installs
  process-local prompt hooks for Bash, Zsh, and Fish; other custom shells need to emit OSC 7
  themselves. Native terminals initially report their launch directory, including a restored folder.
- Choosing a WSL Inbox folder on Windows opens MDE's folder browser (`WslFolderBrowser`, backed
  by `path:list-wsl-directories` in `src/main/wsl/browse.ts`). Inbox folders and runtime terminal
  directories use the target's own path format. `wslpath` is used when translating dropped paths
  or revealing a folder in Explorer.

Native Windows shells also resolve before PTY creation: the default PowerShell
and built-in PowerShell/cmd aliases use system locations. Custom Windows shells,
including PowerShell 7, need a full drive-qualified `.exe`/`.com` path; ambiguous
bare names fail with a configuration error. Native shells still start in the
home directory unless a terminal launch supplies its current folder. Linux shell overrides and agent commands inside WSL retain
their existing target-shell behavior.

## Upgrade notes

### Removed OpenCode status integration

MDE no longer installs or runs an OpenCode status plugin, tracks terminal agents, or requests
Dock/taskbar attention and sound. Inbox status and the mini Inbox use the OpenCode API.
Previously installed `plugins/mde-status/` directories (or the older `plugins/mde-status.js` file)
can be removed from each target's OpenCode configuration after closing old MDE terminals.
The unused `opencode-tui.json` and `opencode-notifications.json` files in MDE's user-data directory
and old `mde-opencode` temporary snapshots are no longer read or written. They are not removed
automatically; workspace and Inbox data are unchanged.

### Removing previously installed Codex hooks

Codex hook reporting has been removed. The Codex launcher and its command settings remain
available. Existing workspace and launcher settings remain compatible. The mini Inbox uses
Inbox threads and their API events.

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

### Inbox attachments and drafts

Both composers accept multiple files through the paperclip's native chooser, clipboard image
paste, external file drops, and Files-sidebar drops. Images show removable thumbnails, other
files show filename/size chips, and messages can contain attachments without text. The renderer
reads only browser-provided File objects; source-tree reads remain in the main process with the
same real-path containment checks as the viewer. Binary attachment reads have a separate 20 MiB
limit and do not enlarge the text viewer's limit.

`InboxDraftStore` serializes mutations and atomically saves each text edit and attachment change
under `inbox-drafts/` in user data. Copies use opaque filenames and private permissions. Drafts
belong to a thread (`thread:<id>`) or are a new thread not yet started (`draft:drf_<uuid>`), and
survive restart. Native create/send requests carry attachment IDs and a draft revision; a create
also names the draft it starts from (`draftId`). The main process validates ownership, sends copied
contents as OpenCode native data-URL files, and clears only the submitted revision after acceptance.
A created session whose initial prompt fails retains the draft on that session for retry.

A new thread's draft also records the folder it was written for, how it would start (`choice`: the
agent, the model and a worktree `{ base, branch? }`) and when it last changed, which is what the
sidebar's Drafts section lists by. Every change to it (`text`, `prepend`, `add`, `tree`) carries
`folderId` and the main process refuses one without it; the page adds its current `choice` to every
request once the agent and model are known, and a change that names none leaves the stored one alone
(the page does not know them yet when it first loads). `load` and `flush` with a `folderId` or a
`choice` update an existing draft (`InboxDraftStore.setMeta`), which is how the page keeps a draft
when its folder is changed or something else is picked, and never create one. A `choice` replaces
the stored one as a whole, so leaving a worktree takes it away; one that does not read back as an
agent id, model and worktree on load is dropped without losing the draft. `chat:drafts` returns
`{ drafts, threads }`: `drafts` holds only what a row shows (id, folder, the first 300 characters of
the text, the file count and first file name, the choice, the time), never the attachments, and
`threads` the ids of the threads in the Inbox with an unsent message, for the Draft chip. A
new-thread draft that holds nothing (no text, no files) is not kept, and startup drops any. The
renderer's `store/inbox-drafts.ts` holds the list and `page`, the draft the new-thread page edits:
a fresh id (`drf_<uuid>`, saved only once something is typed) that is replaced when the page is
left or New thread is chosen on it, so what was typed stays behind as a draft, and the draft taken
from the list while `opened`. The list is read when the sidebar opens and whenever the page is left,
a draft is opened or deleted, and when another thread is opened (the chip then moves); an answer
that arrives after a newer request is dropped. Before
drafts were listed, a folder had one draft of its own (`folder:<id>`); startup turns each into a
new-thread draft, so nothing typed earlier is lost. Removing a folder does not delete its drafts.
Reverting an Inbox thread to a message adds that message's text to the top of the thread's draft in
the same store.

Prompt bodies and prompt/message-list responses allow 32 MiB; other transport limits stay the
same. Oversized history pages retry the same cursor with successively smaller page sizes down
to one message. Main-process parsing discards full file data before IPC, returning filename,
MIME, size, and bounded raster thumbnails (160 pixels per side, at most 180,000 URL characters).
Copies are removed on send, attachment removal, and owner deletion, with startup orphan cleanup.
Limits are 10 files / 20 MiB per draft and 200 MiB across saved attachments. Folders are rejected;
unsupported file contents are handled by OpenCode and the selected model.

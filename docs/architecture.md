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
independent layout of one to nine panes (Ctrl+1–9 selects the corresponding pane count),
including three terminals arranged as two above one, a six-terminal 3 × 2 grid and a
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
its first entry. The code preview font family also applies to Inbox tool input, output and error
blocks, edit/write diffs (including line numbers and change markers), and their file paths and
change counts. Changes take effect immediately in the open conversation, including content
expanded or streamed afterward; code preview font selection is independent of the terminal font.

The expanded Projects sidebar includes a collapsible Agents overview below the sessions, combining
currently reported OpenCode instances from every session with their originating session, tab, and
status.

The Settings dialog is a single dialog mounted by `App` (`src/renderer/components/SettingsDialog.tsx`)
and opened through the workspace store's `openSettings(section)`, so any view can open it at a
given section. The Settings button in the title bar, next to the mini agents button, opens it at Appearance and is available in every mode.

### Inbox

The Inbox is the third sidebar tab, beside Projects and To Do. It lists OpenCode conversations
("threads") like a mail inbox, the most recent agent action first. Each row shows the time since
that action ("5m ago"), the title, the folder name with the full path as a tooltip, the Git branch,
the model, and a status chip: Needs input or Needs permission, Done, Failed, or Working. Threads
with activity you have not opened are bold with a dot, and the tab shows how many there are. The
list can be searched by title, folder, branch and model, and filtered to All, Unread, Needs input
or Parked. Hovering or focusing a row shows a car icon and a "Park" label; parked threads offer
"Move to Inbox" instead. The context menu marks a thread read or unread, parks it, or deletes it.

The gear at the end of the filters opens the Inbox's display settings. One of them adds a
**Working** section to the sidebar, under the list rather than as another filter tab. Turned on, the
threads that are working right now move out of the list into it, the run that began last first, each
with the same row, menu and elapsed time, and they go back to the list (at the place their last
activity gives them) as soon as they stop. A thread that is done, failed, waiting for an answer or a
permission, not yet started or parked is not in it. A parked thread that is still working therefore
stays under Parked. The section ignores the filter tabs, so it always shows what is running, but the
search narrows it along with the list, since it is the only place a working thread can be found. Its
header (an arrow, the name and a count) folds it up, leaving the count; while it is folded those
threads are not listed anywhere else. It takes at most 45% of the sidebar's height and scrolls beyond
that, and the list above keeps a small minimum height. Both choices are kept in the renderer's
`localStorage` (`mde.inbox-working-section`, off by default, and `mde.inbox-working-collapsed`, open
by default; `store/inbox-view.ts`).

Opening a thread counts it as read, and so does something new happening in the thread you are
looking at (the Inbox showing and the window in front), as with an open mail. Since that leaves no
dot to see, the row glows and its status chip, in the list and in the thread's header, pops for
about two seconds (`inboxCues` in the workspace store, `.inbox-cue` in `index.css`; with reduced
motion only the glow remains). Only new activity counts: something that happens while the window is
in the background leaves the thread unread until the window comes back to the front. A thread you
mark unread by hand stays unread, even while it is the open one and after the window loses and
regains focus, until you open it again (its row, or returning to the Inbox) or something new
happens in it (`inboxMarkedUnread`).

The Inbox works without the OpenCode status plugin or status reporting: it talks to OpenCode's
background service directly (see Inbox chat). It is locked, with an explanation, anywhere MDE
cannot reach that service: everywhere except macOS and Windows with WSL. The main area shows the
selected thread's conversation, or the new-thread page when nothing is selected.

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

- **The Changes tab** in the right-hand sidebar, beside Files, for the thread that is open.
  It is always available, and it shows the number of changed files, so the open thread's
  changes are read while the sidebar is open. A new thread, which has no changes yet, shows
  only the file tree.
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

MDE has two modes that do not touch each other. The Projects tab ("legacy" mode) works with
projects, sessions and terminals in `workspace.json`. Inbox mode keeps its own list of folders in
`inbox.json` and never reads or changes projects or sessions. An Inbox folder is a directory and a
target: the Mac, or a WSL distro on Windows, where only WSL paths are accepted because OpenCode
runs there. In the Add folder dialog the path can be typed or chosen with Browse. On the Mac that
opens the system folder dialog. On Windows it opens MDE's own folder browser, which lists only the
folders inside the chosen distro (the Windows file dialog cannot show a distro's filesystem). The
browser opens in the folder already typed when it exists, otherwise in the distro's home. It has
home and parent buttons, a breadcrumb, and a "Show hidden folders" switch, and it hands back a plain
Linux path.

The Inbox also shows the Files sidebar for the open thread's folder, or for the folder a new thread starts in. It is the same tree and viewer as in Projects mode, but browse-only: the VS Code and File Explorer buttons are hidden. The renderer passes the thread's or folder's own ID to `files:list` and `files:read`; the main process looks it up in the Inbox store when no workspace session has that ID.

**New thread.** "New thread" at the top of the Inbox, or selecting nothing, shows "What should we
build in ‹folder›?". The folder name opens a menu of the Inbox folders with Add folder… and
remove buttons. Below it is the composer: a prompt box, a model picker (searchable, grouped by
provider, enabled and non-deprecated models only), an agent picker (Build, Plan, then any other
primary agent that is not hidden), and a send button. Enter sends; Shift+Enter and Ctrl+J add a newline.
Both the new-thread and follow-up inputs show Markdown bullet markers (`-`, `*`, or `+` followed
by a space) as formatted bullets while typing. A newline continues the current bullet list;
on an empty item it leaves the list.
`ChatInput` uses the existing CodeMirror Markdown parser and text editor. It decorates bullet
markers rather than rendering HTML, so pasted HTML, links and images remain literal text.
Code fences stay literal, and drafts, skill positions and sent messages keep plain Markdown
without converting it through HTML. Clipboard images still go through the attachment controls.
The model picker shows the selected provider and model as “Provider / Model”, with a muted provider prefix.
The folder, model and agent last used are remembered in `inbox.json`; otherwise the composer
starts with OpenCode's default model and the Build agent. Sending creates the OpenCode session in
the folder (or in a new worktree, below), records it as a chat thread, selects it, and sends the
prompt.

**Right-click menus.** Right-clicking the conversation opens a menu that depends on what is under
the cursor. **Copy** copies the selected text, but only when the click lands on the selection;
right-clicking elsewhere does not copy text the pointer has left. **Copy code** appears over a
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

**Git worktrees for threads.** When the folder is a Git repository, a strip under the composer
chooses where the thread runs (`WorktreeBar`). **Current directory**, the default, runs it in the
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
the choice is not remembered. The strip is absent when the folder is not a repository or Git cannot
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
Subagent calls (OpenCode's `subagent` tool) are shown as cards instead: the agent type, the title, its state (Working, Done, Stopped, Failed) and a one-line preview of the task. Subagents started together are grouped under one heading, and a card expands to the full task and the answer rendered as Markdown. The subagent's own steps are not shown, since MDE only follows sessions it recorded. Agent and model switches, failures and stops appear as small notes. Text streams in as OpenCode
produces it. Permission requests (Allow once, Always allow, Reject) and questions (option buttons,
checkboxes, free text) are answered inline as cards; a question with field types MDE cannot show
asks you to answer it in a terminal. While the thread works, the send button becomes Stop. A
follow-up switches the session's agent or model first only when you changed them. The renderer
keeps the last ten opened threads in memory so going back to one is instant; MDE never writes
messages to disk.

**Messages held for the agent.** A message sent while the agent is working is not added to the
conversation at once. OpenCode accepts it into the session's *inbox* and hands it to the agent later:
a `steer` message at the agent's next step, a `queue` message when the agent would otherwise stop. MDE
sends no `delivery`, so OpenCode's default (`steer`) applies; one queued from OpenCode's own interface is
shown as queued. Until it is delivered the message is not in the message list, so the thread shows it
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
reason, and every other tool is unchanged.

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
still loads and the totals are left out. After a compaction the count stays at its old value until
the next step finishes. The pill does not appear in the new-thread composer, where nothing has
been measured yet.

**Time worked.** A line under each turn says how long the agent worked on it (`TurnDuration`,
`ChatTurnTime.tsx`), such as `Worked for 1m 30s`, and while the turn is still going the same line
reads `Working for 1m 30s`, counting up every second, with a spinner and a light moving along its
rule (`WorkingFor`). A turn is a user message with everything after it up to the next user message
(`turnStats` in `lib/chat.ts`). It began when the user's message was created and ended when
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
It is offered in two places. The sidebar's right-click menu has **Fork thread**, which forks the
whole conversation. Each of your own messages has a fork button beside the revert button, which
forks from just before that message and puts its text in the new thread's box, so you can say it
differently without losing the original; there is no confirmation because nothing is deleted. A
sidebar fork that fails shows its reason in the panel and a message fork in the thread, and each
ignores a second click while its own fork is in progress.

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
thread, from the first request until MDE quits; at launch, streams reopen for threads that were
still working. A dropped
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
which runs read-only Git commands over the native, Windows and WSL transports. The one exception
is the Inbox's worktrees (see "Git worktrees for threads"), which create and remove a worktree on
request through a separate runner.

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

The runner for worktree requests (`createGitMutationRunner`) keeps all of that hardening except
in-tree attributes, which a checkout has to honour: reading attributes from the empty tree would
write a repository that uses LFS or line-ending conversion with the wrong content. It also allows
two minutes instead of ten seconds, since a checkout writes a whole working tree. Because hooks
stay disabled, a `post-checkout` hook (a tool installing its own hooks, say) does not run in a new
worktree.

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
- Choosing a folder for a WSL location (the New session dialog with WSL selected, and the Inbox's
  Add folder dialog on Windows) opens MDE's folder browser (`WslFolderBrowser`, backed by
  `path:list-wsl-directories` in `src/main/wsl/browse.ts`) instead of the Windows file dialog, so
  only folders of the chosen distro can be picked. The Windows file dialog remains for Windows
  folders. Folders under `/mnt/c` are listed like any other; in the New session dialog the chosen
  path still goes through `path:resolve`, which adds the 9p performance warning.
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

### Inbox attachments and drafts

Both composers accept multiple files through the paperclip's native chooser, clipboard image
paste, external file drops, and Files-sidebar drops. Images show removable thumbnails, other
files show filename/size chips, and messages can contain attachments without text. The renderer
reads only browser-provided File objects; source-tree reads remain in the main process with the
same real-path containment checks as the viewer. Binary attachment reads have a separate 20 MiB
limit and do not enlarge the text viewer's limit.

`InboxDraftStore` serializes mutations and atomically saves each text edit and attachment change
under `inbox-drafts/` in user data. Copies use opaque filenames and private permissions. Drafts
are scoped to a thread or new-chat folder and survive restart. Native create/send requests carry
attachment IDs and a draft revision. The main process validates ownership, sends copied contents
as OpenCode native data-URL files, and clears only the submitted revision after acceptance. A
created session whose initial prompt fails retains the draft on that session for retry.
Reverting an Inbox thread to a message adds that message's text to the top of the thread's draft in
the same store.

Prompt bodies and prompt/message-list responses allow 32 MiB; other transport limits stay the
same. Oversized history pages retry the same cursor with successively smaller page sizes down
to one message. Main-process parsing discards full file data before IPC, returning filename,
MIME, size, and bounded raster thumbnails (160 pixels per side, at most 180,000 URL characters).
Copies are removed on send, attachment removal, and owner deletion, with startup orphan cleanup.
Limits are 10 files / 20 MiB per draft and 200 MiB across saved attachments. Folders are rejected;
unsupported file contents are handled by OpenCode and the selected model.

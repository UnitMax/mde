# Privacy and Network Behavior

This document describes the privacy and network behavior of the released MDE application. It is an implementation summary, not a legal privacy policy.

## Summary

MDE contains no telemetry, analytics, remote crash uploader, automatic update checks, or direct
model-provider or remote MCP client. Its application HTTP client connects to OpenCode's loopback
service. This does not guarantee that using MDE produces no external traffic: MDE invokes Git,
shells and OpenCode, and reads paths through the operating system. MDE's Git calls now deny remote transports and
suppress external filters; the network section explains the remaining boundaries.

## What MDE stores locally

MDE writes the following data to filesystem and Chromium application storage. Its actual location
depends on the operating system and account configuration; mounted, redirected, synchronized or
backed-up locations can place copies elsewhere. These stores are not encrypted by MDE.

- `workspace.json` under Electron's user-data directory: terminal session names and order,
  platform and distro details, shell overrides, tab and terminal layout, and To Do projects
  with their task titles and descriptions.
- `terminal-directories.json` under Electron's user-data directory: the last reported directory of
  each terminal pane, its terminal and owning session IDs, and its native/WSL target (including the
  distro name). These plain-text records reopen fresh shells in the same folders after restarting
  MDE. Removed panes are forgotten. Commands, terminal output and conversation content are not saved
  in these records.
- The renderer's local storage (`mde.terminal-settings`): appearance and terminal preferences,
  including the command that starts OpenCode for the Inbox (Settings, OpenCode, Executable: a program
  name or path, without arguments). An older `agents` entry from a removed launcher is ignored.
- The renderer's local storage (`mde.markdown-preview-width`): whether the Markdown preview is a
  centered column or fills the page (the word `centered` or `full`).
- The renderer's local storage (`mde.workspace-navigation`): the last active tab (Sessions, To Do
  or Inbox) and the selected Inbox thread's session ID, or `null` for the new-thread page. MDE
  restores this view on startup and opens the saved thread only if it is still in the Inbox.
- The renderer's local storage (`mde.inbox-sidebar-changes`): whether the Inbox's thread list shows
  each thread's Git changes (the word `on` or `off`).
- The renderer's local storage (`mde.inbox-working-section` and `mde.inbox-working-collapsed`):
  whether the Inbox lists the threads that are working in a section of its own, and whether that
  section is folded up (the word `on` or `off` for each).
- The renderer's local storage (`mde.inbox-title-icons`): whether the Inbox's thread list shows each
  project's icon in front of the thread titles (the word `on` or `off`).
- The renderer's local storage (`mde.inbox-compact-chat`): whether Inbox conversations are shown in
  compact mode (the word `on` or `off`).
- The renderer's local storage (`mde.model-favorites`): provider and model identifiers for models
  starred in the Inbox model chooser. This does not store prompts or credentials.
- The renderer's local storage (`mde.inbox-project-filter`): the project the Inbox's thread list is
  narrowed to, as that project's folder ID (`fld_…`), or absent when it shows all projects.
- The renderer's local storage (`mde.inbox-sidebar-width` and `mde.inbox-terminal-layout`): how wide
  the Inbox's right-hand sidebar is (a number of pixels), and the arrangement of the Inbox terminal
  (a tree of pane IDs, split IDs, horizontal or vertical directions, and numeric divider ratios).
  Neither holds terminal content or pane titles; the terminal's shells are not restored on the next run.
- The renderer's local storage (`mde.inbox-floating-terminal`): whether the Inbox terminal floats over the
  conversation, where its window was left (four pixel numbers) and whether it is maximized. No terminal
  content.
- The renderer's local storage (`mde.inbox-terminal-distro`): the WSL distribution chosen for the
  Inbox sidebar terminal. No entry means the Windows default distribution.
- The renderer's local storage (`mde.alert-settings`): the Notifications choices: whether and how loudly
  sounds play, the sound for each of Done, Needs input and Failed, whether the taskbar flashes, and whether
  it is coloured and badged. The sounds are generated on the device; nothing is downloaded or sent.
- `inbox.json` under Electron's user-data directory, once you use the Inbox: one record for each
  OpenCode conversation you started in the Inbox, with its session ID, OpenCode title, optional custom name, folder, terminal chat mode
  when chosen (older threads use GUI chat), target (Mac
  or WSL distro), Git branch, model and provider identifiers and the selected model variant (reasoning effort), last status, timestamps (including,
  while a conversation is working, when its current run began), read, archived and pinned flags, and for a forked conversation the session ID of the one it was forked from. For a conversation started in a Git worktree it also holds that worktree's root path, the repository's path, and the names of the new branch and the branch it was cut from. It also holds the Inbox folders (projects) you add (path, target, name, the icon you picked for it — the name of a built-in icon and its color, or one emoji — and timestamps; at most 200), the worktrees MDE created for you (the same record and a name made from the folder and branch; at most 100, so that more conversations can be started in them) and the folder, model and agent
  you last chose in the Inbox composer. It never holds prompts, messages or tool data. It keeps at
  most 1,000 conversations; deleting a conversation from the Inbox removes only MDE's record.

- OpenCode's own global configuration file (`opencode.jsonc`, or `opencode.json`, in OpenCode's
  configuration folder), only when you use the **OpenCode configuration** editor (Settings, OpenCode) and
  press Save. This is OpenCode's file, not an MDE store; see the paragraph on the editor below for what
  is read and written.

Older versions may have left status-plugin files, temporary snapshots and reporting/alert preference
files on disk. MDE no longer reads or writes them; removal is manual (see the upgrade notes in
`docs/architecture.md`).

Apart from explicitly added Inbox draft attachments described below, MDE does not copy file contents or terminal output into these stores. Terminal scrollback is held
in memory only.

The Inbox chat view talks to OpenCode's local background service directly. To find it, MDE runs
`opencode service start` (which does nothing when the service is already running) and reads
OpenCode's `service.json` state file from the command's standard output, on the Mac or in the
WSL distro. That file holds the service's local address and the password OpenCode generated for
it. MDE keeps the password in the main process's memory, sends it only to that loopback
address as HTTP Basic auth, and never writes it to disk, logs it or passes it to the renderer.
Terminal chat passes the same password to its OpenCode child process through the environment
(`WSLENV` forwards it into WSL), so the terminal attaches to the same service. It is never placed
in command-line arguments.
Conversations, the messages the service is holding for a busy agent, tool input and output, permission
requests and questions are fetched from the
service when a thread is opened and are kept in memory only (the renderer keeps the last ten
opened threads); MDE does not write them to disk. Prompts and answers you send go to the service,
which stores them in OpenCode's own data and forwards them to the model provider you chose, as
OpenCode does in a terminal.

The Inbox's search over all threads (Ctrl+Shift+F) is the exception to opening a thread to read it: while
the search overlay is open (and for a while after, until the threads change), the main process reads the
user and assistant text of every thread's messages from the service, newest thread first, and keeps that
text in memory so that searching is fast. Tool calls, reasoning and command output are not retained in
the search index, although message pages containing them reach the main process before it extracts
user and assistant text. The index is never intentionally written to disk or logged, is sent only to
the renderer as short snippets of the matches, and is dropped when a thread is removed or MDE quits.
Once started, indexing can continue after the search overlay closes; the main process caches the text
for later searches.

Subagent cards also read the selected model and variant from their child sessions through the same
local service. These details stay in memory; MDE does not read the child conversation's messages
or make a model-provider request to show the label.

The message box's `$` list is filled from the service's list of skills for the folder (their names
and one-line descriptions only; MDE drops each skill's text and file path) and is kept in memory for
about a minute. When you send a message that names a skill, MDE tells the service which skill, and the
service gives the skill's text to the model, as OpenCode does in a terminal. MDE stores nothing more
for skills, and a skill the model loads is shown from the conversation the service returns.

The message box's `@` list is filled by asking the same local service for the files and folders of the
folder that fit what you typed (paths only, never contents), and MDE checks the paths a message writes
against it so they can be marked. Nothing of this is stored by MDE. When you send a message that names a
file or folder, MDE gives the service its address and where it was written; the service reads the file
(or lists the folder) itself and sends it to the model provider you chose with the message, as it does for
any attachment, and returns it with the conversation. The draft keeps only the text you typed.

The message box's `/btw` side question sends the question to the same local service, which answers it
from the conversation as it stands and may send that conversation and the question to the model provider
you chose, as it does for any message. It does not add either to the conversation. MDE keeps the question
and the answer in memory only, for each thread until you dismiss them or the app closes, and never
writes them to disk.

Compacting a conversation (the `/compact` command or the context pill's Compact conversation button) asks
the same local service to summarize the conversation, which sends the conversation to the model provider
you chose, as any message does. OpenCode writes the summary into the conversation it stores for the
session, so it is part of that history from then on and is shown in the conversation like any other note.
MDE stores nothing more for it, and shows only the summary, its approximate size and the reason when
it fails, with credentials and the provider's response removed.

A goal (the `/goal` command, or its card above the message box) asks the same local service, through OpenCode's
goal plugin, to keep the agent working on an objective until a reviewer judges it met. The objective, each
check by the reviewer and the work in between go to the model provider you chose, as any message does, and
a long goal can make many such requests. OpenCode stores the goal (its objective, status, round count and
the reviewer's last finding) with the session and writes the goal's messages into the conversation. MDE
reads that state from the service, keeps it in memory only, and stores nothing more for it.

The background-task strip above the Inbox message box asks the same local service for running jobs
owned by the thread and its subagents. Task descriptions, shell commands and start times are kept in
memory while displayed; MDE does not store them separately on disk. The list is read-only and does
not stop or otherwise change the listed tasks. MDE does not scan the operating
system's process list or infer detached processes from commands. Refreshes use the same loopback
connection, including while the agent is idle, and do not make model requests.
Hiding the unavailable-task message saves a boolean preference in `localStorage`
(`mde.background-tasks-hide-unavailable`); it contains no task or conversation data.

The Inbox's MCP list asks the same local service which MCP servers OpenCode has for the folder or
thread and how each stands: name, title, connected, failed or needs a sign-in, and a short error with
credentials and paths removed. MDE drops everything else in the answer (commands, URLs, headers and
environment variables), keeps the list in memory only and stores nothing. Switching a server off or on
there tells the service to disconnect or connect it until OpenCode restarts. MDE does not start,
contact or configure MCP servers itself and leaves the MCP part of OpenCode's configuration alone;
OpenCode starts and contacts them, and may send them what the model passes to their tools, as it does
in a terminal. What a tool is called with and returns is part of the conversation, which is fetched
from the service, kept in memory only and not written to disk by MDE.

The **OpenCode configuration** editor (Settings, OpenCode, Edit configuration; on the Mac and, for a WSL
distro, on Windows) reads and writes OpenCode's own global configuration file: `opencode.jsonc` or
`opencode.json` in `~/.config/opencode`, or in the folder named by `OPENCODE_CONFIG_DIR` or
`XDG_CONFIG_HOME` (inside the WSL distro on Windows, reached as `\\wsl.localhost\<distro>\...`). MDE reads
the file when you open the editor and writes it only when you press Save, and then only the permission
rules, the custom OpenAI-compatible providers it manages and the list of disabled providers; the rest of
the file, comments included, is kept as it was; the write goes through a temporary file next to it,
which replaces the file. Cleanup of a failed temporary write is best effort; a crash or failure before
rename can leave a temporary copy. The file can hold credentials that you or OpenCode put
there. Apart from the temporary write, MDE keeps no separate copy or backup and does not log the file.
The main process reads the
whole file and gives the window the parts the editor manages (the rules, the providers it manages, the
ids and names of other providers, and the names of older settings), which stay in memory until you
close the editor. The read-only Source tab also shows the rest of the file as it will be after saving, so
that you can check the change; there, the value of a setting whose name contains `api key`, `token`,
`secret`, `password`, `authorization` or `credential` is replaced by `(hidden)` after parsing JSONC
and decoding the key. Arrays and objects under such keys are hidden in full; `{env:...}` and
`{file:...}` string references remain visible. Malformed JSONC produces no content preview. Secrets
under other names or in unrelated comments can still remain visible, so the Source tab must not be
treated as a fully sanitized copy for sharing. The editor asks for the name of
an environment variable that holds a provider's key, never for the key, and writes no new key. It lists providers by asking the same local service
which ones it has (ids and names only). Saving makes no network request: OpenCode notices the changed
file itself, and only contacts a provider you added when you use one of its models, as it does in a
terminal. MDE does not contact the address of a custom provider.

The Inbox's Changes tab for the open thread, and the changes line under each visible thread
(when you turn that on in the Inbox's gear menu; it is off by default) with the file list and
diff review they open, run read-only local Git commands for that thread's checkout. They show staged,
unstaged, and untracked changes against HEAD, shared by conversations using that checkout.
The file list loads when the list or tab is opened and file diffs when a file is chosen.
Counts and diff previews stay in memory; MDE does not save them or create a snapshot
store. Viewing changes does not read conversation history, contact OpenCode or a model
provider, or modify files.

The Inbox's **Regenerate title** button asks that same local service to run OpenCode's
native title agent on the current conversation. OpenCode may send conversation context
to the model provider selected by its title-agent configuration. MDE does not make that
provider request itself, create an additional conversation, or persist the context.
The resulting title replaces the existing title in `inbox.json`; loading and error
feedback stays in memory.

## Inbox worktrees

When you start an Inbox conversation in a **New worktree**, MDE asks Git to check out a copy of the
branch you chose under `.mde/worktrees/` in your home directory (inside the WSL distro's home on
Windows), on a new branch: the name you typed, or `mde/` followed by eight hex digits when you
left it empty. The folder itself is named from random digits, not from the branch. It holds ordinary
working files and sits outside MDE's user-data directory, so MDE's own cleanup does not cover it.
It stays until you remove it: tick **Also remove the worktree** when you delete the conversation,
or run `git worktree remove` yourself. The new branch is kept either way. A worktree you created is also listed in the Inbox's folder menu until you remove it there (which only forgets it) or delete it with a conversation. MDE reads local branch
names to fill the picker and never contacts a remote.

## Inbox attachments and saved drafts

The Inbox paperclip, image paste, and file drops save copies under `inbox-drafts/` in
Electron's user-data directory. `index.json` stores unsent prompt text, filenames, MIME hints,
sizes, revisions and generated attachment IDs; `attachments/` holds the copied contents.
These local drafts are not encrypted. They survive app restarts and changes to the original
files. Each thread has its own draft, and any number of unsent new threads are kept as drafts of
their own, each noting the folder it was written for, how it would start (GUI or Terminal, agent, model, and the
worktree branch and name if a new worktree was chosen) and when it last changed; the Inbox lists them
in its sidebar and marks the threads that have an unsent message. Removing an attachment, successfully sending its draft, deleting a new-thread
draft from the sidebar, or removing a thread deletes the relevant copies. Removing a folder from the
Inbox leaves its drafts. Startup removes orphaned copies and new-thread drafts with nothing in them. Valid drafts do not expire automatically. Saved attachment
contents are capped at 200 MiB total, with 10 files and 20 MiB per draft. File removal is best effort;
failed deletion, abrupt shutdown, filesystem snapshots and backups can retain copies. These limits
apply to attachment bytes; there is no aggregate count or text quota for saved new-thread drafts.

Only sending a message transfers attachments to the loopback OpenCode service, as native inline
file attachments. OpenCode stores them and may forward their contents to the chosen provider.
Forking a conversation makes OpenCode copy its messages, attachments included, inside its own
data; MDE does not handle that content. MDE does not send unsent drafts automatically. Conversation history retains attachment metadata
and small raster thumbnails in memory; MDE does not persist conversation attachment downloads.

## The clipboard

The Inbox right-click menus write to the system clipboard when you choose Copy, Cut, or one of the
"Copy …" items. The terminal also writes copied selections, and its OSC 52 support can accept a
terminal program's clipboard-write request subject to the configured policy and interaction checks.
Clipboard history managers and operating-system clipboard synchronization can retain or transmit copies.

Paste asks the operating system to paste into the focused terminal or message box. The renderer's
paste handlers can read that content; pasted Inbox text and images can be saved in the draft store,
and sending transfers them to OpenCode. Terminal paste transfers text to the foreground terminal
program, which may execute it or use the network. There is no periodic clipboard polling, but the
paste bridge does not enforce a user gesture independently of the renderer. Send to current thread
and Send to new thread place selected terminal text into a message box or terminal without using the
system clipboard; text placed in an Inbox message box can become a persistent unsent draft.

## Network behavior in the released application

In Sessions mode, the Files sidebar reads the selected terminal’s current directory.
Each terminal header reads Git metadata for that terminal’s checkout. The Inbox Changes tab reads
changes and diffs on demand. Directory reports update the local
per-terminal records described above. File previews and Git results are held in memory and are
not added to the saved workspace. Inbox file browsing
continues to use the selected thread or folder.

MDE reads files and invokes commands to support terminal sessions and file actions: Git for
repository status/diffs and worktree creation/removal, `wsl.exe` on Windows, and the configured
OpenCode executable to find the background service. These helpers are relevant to network behavior:

- Git normally can fetch missing objects during apparently local operations and execute configured
  clean/smudge/process filters, including Git LFS downloads. MDE's Git calls deny all transport
  protocols and disable lazy fetching where supported. They also inspect effective filter key names
  before converting operations and disable those driver commands for the invocation. Missing objects
  produce an error rather than a download. Branch listing uses local metadata and includes cached
  remote-tracking branches; it does not refresh them.
- Worktree checkout keeps Git's built-in line-ending conversion, but refuses a checkout that selects
  a configured external filter instead of running that program or silently skipping needed conversion.
  Create such worktrees in a terminal, then add their folders to Inbox. Removal can likewise refuse
  when a configured clean filter is needed. Read-only diffs compare unfiltered contents, which can
  differ from a terminal Git query on filter-managed files. Submodule recursion/diffs and automatic
  maintenance are disabled in MDE-owned calls. These protections apply inside WSL as well as natively.
  Configuration is inspected on each operation, but separate subprocesses cannot guarantee atomicity
  against concurrent malicious changes to Git configuration.
- Network shares, mapped drives and mounted filesystems can cause OS network access and
  authentication when paths are validated, listed, read or polled. MDE does not enforce local-only
  filesystem locations.

The Inbox's application HTTP client makes requests and holds an event stream open to the OpenCode
background service. MDE accepts only a loopback address (`127.0.0.1`, `localhost` or `[::1]`) with an
explicit port in the service state file and refuses redirects. On Windows these reach WSL through
localhost forwarding. These connections support Inbox options, conversations and background thread
activity in GUI and Terminal mode; service startup can occur during options/configuration reads or
restored thread activity. Provider and MCP connections resulting from these OpenCode operations are
made by OpenCode. The accepted `localhost` name still depends on OS name resolution, and MDE does
not install an application-wide firewall or independently verify the actual socket peer.

MDE disables Chromium's automatic DNS-over-HTTPS upgrade at startup with
`app.configureHostResolver({ secureDnsMode: 'off' })`. This does not disable ordinary DNS, Node's
resolver, OS network filesystems, proxies, child-program networking or all Chromium request paths.
It is not evidence that no DNS or internet traffic can occur. Packaged network behavior must be
verified on each supported platform and network configuration.

On Mac, agent commands and service discovery run through the user's login shell. Shell startup configuration
can execute user-configured commands, as it does in normal terminal sessions.

On Windows, native file previews and attachment copies use a fixed local PowerShell/.NET helper
with profiles disabled. Main supplies the selected paths through child environment data; the helper
holds native directory/file handles while reading and returns bounded bytes over standard output.
It makes no HTTP requests and stores no copy of the file. PowerShell may create temporary compilation
artifacts for MDE's fixed helper code; these contain no file contents or request-specific paths in the
compiled source. The helper is limited to two concurrent reads and fails closed if local policy blocks
native compilation. Network-backed paths still involve the operating system as described above.

## User-initiated external actions

MDE may open a web link in the system browser when the user activates it in a terminal, Markdown
preview or chat view. The browser makes any resulting network connection and receives the full URL,
which may include query data. Opening a folder in a file manager or VS Code can likewise trigger the
receiving application's filesystem, extension or network behavior.

Commands entered by the user in a terminal, including commands run through third-party terminal applications, may access the network. Those are user-directed child-process activities rather than automatic connections made by MDE.

## Scope of this statement

This statement describes the supported release configuration. Development, dependency audits,
downloads, builds and release publication deliberately use external services. OpenCode, terminal
programs, OS filesystem services and browser/editor handoffs have separate behavior and retention.
Automatic helpers started by MDE must still be considered when assessing network behavior.

## Retention, access and reset

MDE relies on the account's filesystem permissions, OS access controls and device encryption;
it provides no application encryption or secure-erasure guarantee for JSON, drafts or localStorage.
Conversation caches and terminal scrollback are not intentionally persisted, but operating-system
swap, diagnostics and crash dumps can contain process memory. Some console errors include paths or
command diagnostics; no remote MDE log uploader is configured.

Parking a thread does not delete it. Removing a thread removes MDE's record and its draft, not
OpenCode's conversation history, provider data, shell history or backups. Removing a project leaves
its drafts. Worktrees and their branches have the separate lifecycle described above.

To reset MDE's own storage, quit the app and its terminals, identify its actual Electron user-data
directory for the account, back up anything needed, then remove that application's JSON files,
draft directory and Chromium storage. Separately manage worktrees, OpenCode history/configuration,
legacy plugins/status files, clipboard history, OS backups and third-party data. Do not delete
shared directories merely because their name resembles an MDE artifact.

## Audit conclusion

No hidden MDE telemetry or direct provider client was found in the source review. MDE's Git
operations now deny remote transports and configured external filters. This does not establish
a universal no-traffic guarantee: OS filesystem services, launched programs and packaged network
behavior still require separate assessment and platform verification.

# Privacy and Network Behavior

This document describes the privacy and network behavior of the released MDE application. It is an implementation summary, not a legal privacy policy.

## Summary

MDE is local-only for its own application traffic. The released application contains no telemetry, analytics, crash reporting, automatic update checks, or internet service connections.

## What MDE stores locally

MDE stores data only on the local machine:

- `workspace.json` under Electron's user-data directory: project labels, terminal session names,
  paths, platform and distro details, shell overrides, tab and terminal layout, and To Do projects
  with their task titles and descriptions.
- The renderer's local storage (`mde.terminal-settings`): appearance and terminal preferences,
  including the executable and argument strings configured for the shell, OpenCode, Codex and
  Claude launchers. Any secret typed into an argument string is stored there in plain text.
- The renderer's local storage (`mde.markdown-preview-width`): whether the Markdown preview is a
  centered column or fills the page (the word `centered` or `full`).
- The renderer's local storage (`mde.inbox-sidebar-changes`): whether the Inbox's thread list shows
  each thread's Git changes (the word `on` or `off`).
- The renderer's local storage (`mde.inbox-working-section` and `mde.inbox-working-collapsed`):
  whether the Inbox lists the threads that are working in a section of its own, and whether that
  section is folded up (the word `on` or `off` for each).
- Small preference files in the user-data directory for the OpenCode status integration and
  notifications.
- `inbox.json` under Electron's user-data directory, once you use the Inbox: one record for each
  OpenCode conversation you started in the Inbox, with its session ID, title, folder, target (Mac
  or WSL distro), Git branch, model and provider identifiers, last status, timestamps (including,
  while a conversation is working, when its current run began), read and archived flags, and for a forked conversation the session ID of the one it was forked from. For a conversation started in a Git worktree it also holds that worktree's root path, the repository's path, and the names of the new branch and the branch it was cut from. It also holds the Inbox folders you add (path, target, name, timestamps; at most 200), the worktrees MDE created for you (the same record and a name made from the folder and branch; at most 100, so that more conversations can be started in them) and the folder, model and agent
  you last chose in the Inbox composer. It never holds prompts, messages or tool data. It keeps at
  most 1,000 conversations; deleting a conversation from the Inbox removes only MDE's record.
- If you enable the optional OpenCode integrations, a short status snapshot under
  `/tmp/mde-opencode` in the WSL distro, or a private `mde-opencode` directory under the
  macOS user temporary directory (state, current session title, timestamps, and a process ID
  with its start identity; never prompts, messages or tool data), plus the plugin files MDE
  installs into the target's OpenCode configuration directory (`plugins/mde-status/`). The plugin runs inside the OpenCode terminal
  process and edits no OpenCode configuration file. Disabling an integration does not uninstall
  its plugin.
  On Mac the snapshot directory is accessible only by the current user (0700), with files
  restricted to that user (0600). MDE removes snapshots when terminals close and matching
  artifacts older than 24 hours on startup. Abrupt termination may leave these temporary files.

Apart from explicitly added Inbox draft attachments described below, MDE does not copy file contents or terminal output into these stores. Terminal scrollback is held
in memory only. The OpenCode session picker asks the configured OpenCode executable for session metadata on demand
(`opencode api`, which reads OpenCode's own local background service: session
titles, directories, models, token usage and cost) and keeps the result in memory only. The query output passes through a private temporary file on the native Mac host or in the distro, which is deleted when the query ends.

The Inbox chat view talks to the same OpenCode background service directly. To find it, MDE runs
`opencode service start` (which does nothing when the service is already running) and reads
OpenCode's `service.json` state file from the command's standard output, on the Mac or in the
WSL distro. That file holds the service's local address and the password OpenCode generated for
it. MDE keeps the password in the main process's memory only, sends it only to that loopback
address as HTTP Basic auth, and never writes it to disk, logs it or passes it to the renderer.
Conversations, the messages the service is holding for a busy agent, tool input and output, permission
requests and questions are fetched from the
service when a thread is opened and are kept in memory only (the renderer keeps the last ten
opened threads); MDE does not write them to disk. Prompts and answers you send go to the service,
which stores them in OpenCode's own data and forwards them to the model provider you chose, as
OpenCode does in a terminal.

The message box's `$` list is filled from the service's list of skills for the folder (their names
and one-line descriptions only; MDE drops each skill's text and file path) and is kept in memory for
about a minute. When you send a message that names a skill, MDE tells the service which skill, and the
service gives the skill's text to the model, as OpenCode does in a terminal. MDE stores nothing more
for skills, and a skill the model loads is shown from the conversation the service returns.

The Inbox's MCP list asks the same local service which MCP servers OpenCode has for the folder or
thread and how each stands: name, title, connected, failed or needs a sign-in, and a short error with
credentials and paths removed. MDE drops everything else in the answer (commands, URLs, headers and
environment variables), keeps the list in memory only and stores nothing. Switching a server off or on
there tells the service to disconnect or connect it until OpenCode restarts. MDE does not start,
contact or configure MCP servers itself and writes nothing to OpenCode's configuration; OpenCode starts
and contacts them, and may send them what the model passes to their tools, as it does in a terminal.
What a tool is called with and returns is part of the conversation, which is fetched from the service,
kept in memory only and not written to disk by MDE.

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
files. Each thread and new-chat folder has its own draft. Removing an attachment, successfully
sending its draft, or removing its owning thread/folder draft deletes the relevant copies.
Startup removes orphaned copies. Valid drafts do not expire automatically. Saved attachment
contents are capped at 200 MiB total, with 10 files and 20 MiB per draft.

Only sending a message transfers attachments to the loopback OpenCode service, as native inline
file attachments. OpenCode stores them and may forward their contents to the chosen provider.
Forking a conversation makes OpenCode copy its messages, attachments included, inside its own
data; MDE does not handle that content. MDE does not send unsent drafts automatically. Conversation history retains attachment metadata
and small raster thumbnails in memory; MDE does not persist conversation attachment downloads.

## The clipboard

The Inbox right-click menus write to the system clipboard only when you choose Copy, Cut, or one of
the "Copy …" items, and the terminal does the same when you copy a selection. Paste asks the
operating system to paste the clipboard into the message box. MDE does not read, store, or send the
clipboard's contents anywhere itself; what you paste is an unsent draft like any other text you type.

## Network behavior in the released application

MDE does not make automatic network requests. It reads local files and invokes local commands to support terminal sessions and file actions: Git for repository status (and, when you start an Inbox conversation in a new worktree or delete one with its worktree, to create or remove that worktree; MDE never runs `git fetch` or any other Git network command), `wsl.exe` on Windows, and the configured OpenCode executable for the session picker and to find the OpenCode background service.

The Inbox chat view makes HTTP requests, and holds an event stream open, to the OpenCode background service on a loopback address (`127.0.0.1`, `localhost` or `[::1]`) only; MDE refuses any other address in the service's state file. On Windows these reach the service inside WSL through WSL's localhost forwarding. MDE starts these connections only while OpenCode status reporting is on and a chat thread is in use. Any internet traffic that follows, such as calls to a model provider, is made by OpenCode, not by MDE.

MDE also disables Chromium's DNS-over-HTTPS upgrade at startup, with `app.configureHostResolver({ secureDnsMode: 'off' })`. Chromium's default mode would otherwise route name resolution through a DoH provider whenever the system resolver is a recognized one, without any application code asking it to. Because MDE resolves no hostnames of its own, the result is no DNS traffic rather than a fallback to plaintext DNS, and the statement above holds regardless of how the user's machine is configured to resolve names.

On Mac MDE also reads integration-related environment values through the user's login shell and
uses `/bin/ps` to check OpenCode process liveness. Shell startup configuration can execute
user-configured commands, as it does in normal terminal sessions.

## User-initiated external actions

MDE may open an external link in the system browser when the user explicitly activates a terminal link. The browser then makes any resulting network connection. MDE does not automatically load those links.

Commands entered by the user in a terminal, including commands run through third-party terminal applications, may access the network. Those are user-directed child-process activities rather than automatic connections made by MDE.

## Scope of this statement

This local-only statement applies to MDE's supported release configuration. MDE cannot control commands launched by the user or a compromised host operating system; network activity initiated by those external components is outside MDE's behavior and responsibility.

## Audit conclusion

The released MDE application has no hidden telemetry or automatic internet activity. Explicit browser-link clicks and user terminal commands are separate, user-directed activities outside MDE's own network behavior.

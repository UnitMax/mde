# Security

Security-relevant design and maintenance notes. The privacy and network statement is in
[`PRIVACY.md`](../PRIVACY.md).

## Network boundary

MDE has no telemetry, remote crash uploader, updater, direct provider client or
remote MCP client. Its own MCP server (the MDE MCP) is a local bridge over a Unix socket or named pipe,
not a network listener. The application HTTP client accepts loopback OpenCode origins
and rejects redirects. This is not a guarantee of no external traffic: OpenCode,
launched commands, OS network mounts and login-shell startup have their own network
behavior. See [`PRIVACY.md`](../PRIVACY.md).

## IPC security boundary

All renderer-to-main calls pass through the registration wrapper in
`src/main/ipc.ts`. Before a handler runs, the wrapper:

1. Requires the current application window's exact `WebContents` and main
   `WebFrameMain`, rejects destroyed/detached frames, and checks the renderer
   URL against the entry used to load the window.
2. Rejects additional invocation arguments.
3. Validates the payload against the exhaustive channel registry in
   `src/main/ipc-validation.ts`.

Production uses `app://mde/index.html`. Development uses the configured
`ELECTRON_RENDERER_URL` only when the app is not packaged. URL checks compare
scheme, host/port, path and query, reject credentials, and allow fragments on
that same document. They do not use Node's `URL.origin` for the custom scheme,
which would return `null`. A matching URL in another window or child frame
never grants authority. The current window/frame is checked on every request,
so a replaced or closed window is not trusted through a cached ID.

Payload objects accept only declared own data properties. Unknown keys,
inherited fields, custom prototypes, accessors and symbols are rejected,
including within patches. Optional fields may be absent or
`undefined`, as used by preload; nullable fields accept `null` only where the
shared contract allows it. No-payload channels accept only `undefined`.

The current limits are:

| Category | Limit |
| --- | --- |
| IDs | 512 UTF-16 code units |
| Labels and titles | 4,096 code units |
| Paths and executables | 32,768 code units |
| Task descriptions, terminal input and clipboard text | 2 Mi code units |
| Dropped file descriptors | 256 entries |
| Terminal columns and rows | Integers from 1 through 4,096 |
| Layouts | Bounded split tree (up to 64 panes), unique pane and split IDs, matching pane references and order, finite ratios strictly between 0 and 1; unknown keys, cycles and accessors rejected |

Process/path/identity fields and labels reject C0/C1 controls. Task descriptions,
terminal input and clipboard text allow controls and newlines so normal text
editing and terminal key sequences work. Empty arguments, descriptions,
clipboard text and terminal input are valid; empty IDs and required names are
not. File-viewer and tree-drop paths must stay relative and contain no dot
segments, backslashes or controls. Inbox requests (`inbox:set-read`,
`inbox:set-archived`, `inbox:remove`) accept only an OpenCode session ID
(`ses_` followed by letters, digits, `_` or `-`) and a boolean where one is
expected (`inbox:remove` also takes an optional `removeWorktree` boolean); they
change MDE's own `inbox.json` and never reach OpenCode, except that
`removeWorktree` also runs `git worktree remove` (see "Inbox worktree boundary").
`inbox:git-info` accepts only an `fld_` folder ID.
Inbox folder requests (`inbox:folders-add`, `inbox:folders-update`,
`inbox:folders-remove`, `inbox:composer-set`) accept a target and a path, which the handler resolves and
validates in the selected target (WSL only on Windows, native elsewhere), or an
`fld_` folder ID, an OpenCode model reference and an agent ID. A project's name
(add and update) is a non-blank string of at most 512 code units without controls.
Its icon is either `{ kind: 'symbol', id, color? }`, whose `id` and `color` must be
on the built-in lists in `src/shared/inbox-folder-icons.ts`, or `{ kind: 'emoji', emoji }`,
which must be exactly one grapheme containing an emoji, at most 32 code units and no controls;
extra keys are rejected, and `inbox:folders-update` takes `icon: null` to clear it. The icon is
only ever rendered as an SVG chosen from that list or as text, never as a URL, image data or
markup, and the store validates it again when `inbox.json` is read. Chat requests
(`chat:*`) accept `ses_`, `per_` and `frm_` IDs by pattern, prompts of at most
100,000 code units without controls other than newline and tab, permission
decisions from the fixed set `once`, `always`, `reject`, and form answers of
bounded keys, strings, numbers, booleans and string lists. `files:list` and `files:read` accept an Inbox `fld_` folder ID or `ses_` thread ID, or a live terminal with its expected directory; the main process resolves it to that folder's directory, and the usual containment checks apply. Domain handlers still verify resource
existence, session/source ownership, filesystem containment and platform
constraints after the central validation.

`pty:configure-inbox` accepts only a WSL distribution name (up to 128 code units, without controls or
option syntax), or `null` for the Windows default. The main process matches explicit names against
installed distributions and rejects WSL choices on other platforms. It resolves the sidebar's reserved
session itself for all subsequent terminal and filesystem requests. Switching targets invalidates
pending sidebar launches and disposes its old shells; other sessions and Inbox threads keep their targets.

OpenCode configuration requests (`opencode-config:read`, `opencode-config:preview`,
`opencode-config:save`) carry a target (`native`, or `wsl` with a distro name) and, for preview and save,
a draft; save also carries the revision the draft was made from. Never a path. The validator checks the
shape and size of the draft (at most 500 permission rules, 50 custom providers of 200 models each and 200
disabled providers; bounded strings without controls); the rules for what is valid (`validateDraft` in
`src/shared/opencode-config.ts`) run again in the main process, so the form and the file cannot disagree.
See "OpenCode configuration boundary".

The Inbox terminal belongs to no workspace session. Terminal requests accept the reserved session ID `inbox-terminal`; the main process builds its launch session on demand, as a shell in its saved directory or the home directory (`~` in the default WSL distro on Windows), and the reserved ID always wins over a stored session. File browsing, previews, tree drops and attachments accept either an Inbox folder/thread identity or a live terminal ID with its expected directory. For a terminal root, main resolves the launch environment and current directory from the PTY, verifies the directory on disk, and rejects a mismatch or a terminal that moves during verification. The renderer’s directory is a consistency check, not an arbitrary filesystem root. Relative-path and symlink containment checks still apply below the resolved root. Terminal Git summaries likewise resolve the live terminal’s verified directory and run from its checkout root. Mixed root selectors are rejected at the IPC boundary. Naming `inbox-terminal` as a saved file-root session still fails. This adds no authority the renderer does not already have through `pty:write`.

Inbox terminal chat threads use the reserved `inbox-thread:<sessionID>` identity for both the terminal
and its launch session. Main resolves a recorded terminal-mode thread, its native/WSL target, and its
directory from the Inbox store, checks that directory on disk, and launches only the configured
OpenCode executable with `--session <sessionID>` and the API client's validated loopback server URL.
The service password is passed only in the child environment (`WSLENV` forwards it into WSL), never
through renderer IPC or command-line arguments. Renderer-provided launch overrides, alternate pane
identities, GUI threads and removed threads are rejected. The thread is checked again after the
directory check. Removing a thread cancels pending launches and disposes its PTY. These terminals use
the existing API event stream for status.

Terminal directory restoration uses main-process records (`src/main/pty/directories.ts`), populated
from PTY directory reports and explicit main-owned launch directories. Records must match both
the terminal ID and its owning session and target; a changed WSL distro cannot inherit another
distro's directory. Native paths must be absolute for the host and WSL paths must be plain absolute
Linux paths. The directory is verified on disk before launch, with home as the fallback. The renderer
cannot provide a restoration path through IPC. No agent command is restored, and Inbox conversation
terminals continue to resolve their directory from the recorded API thread. Writes are serialized
and atomic; graceful shutdown flushes pending records after stopping the PTYs.

The clipboard has two channels. `clipboard:write-text` carries the text to write (up to 2 Mi code
units). `clipboard:paste` carries nothing and returns nothing: the main process calls
`webContents.paste()` on the window that asked, which pastes the system clipboard into whatever
field has the focus, as Ctrl/Cmd+V would. The renderer's own clipboard access stays denied (see
`src/main/permissions.ts`), and no clipboard content is ever returned to it. The Inbox right-click
menu uses `clipboard:paste` for its Paste item. Script that runs in the renderer could call it
after focusing a field and read the field, which is a way to read the clipboard without a
keypress. That adds no authority script does not already have, since the renderer can write to the
terminals through `pty:write`, but it is recorded here so that a future change to the renderer's
trust does not overlook it.

Errors identify the rejected channel or sender without including the payload,
which may contain terminal input or secrets. The boundary rejects oversized
requests rather than silently truncating them. Electron deserializes messages
before these checks, so these limits bound accepted handler work rather than
preventing all IPC transport allocation or request flooding.

This boundary authenticates a frame, not individual user gestures. JavaScript
already compromised inside the authorized renderer retains its legitimate
bridge capabilities, including PTY input, the configured OpenCode command and
workspace changes. Sender checks and payload schemas do not establish
executable provenance or make third-party agents safe. Any future capability
restriction or move of command preferences into main-process storage should
be evaluated separately.

Regression coverage includes `test/ipc-security.test.ts`,
`test/ipc-validation.test.ts`, `test/worktree-branch.test.ts`, `test/inbox-worktree.test.ts` (real
Git, including hostile base and branch names and a branch that already exists), and the
registered-handler tests in
`test/ipc-drop.test.ts`. Every shared channel must have a validator and a normal
request fixture. Existing path/drop tests exercise the same real
boundary with a trusted sender fixture. Native Windows/WSL smoke testing is
still required before claiming platform-specific release verification.

Electron smoke tests should run with sandboxing enabled and temporary userData.
Verify that main-frame app/workspace requests succeed and another sandboxed window
loading the same app URL cannot invoke `app:info`. An unpackaged Linux check does
not establish Windows/WSL or packaged-app behavior.

The sender policy follows [Electron's IPC sender validation guidance](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages).

## OpenCode service connection

The Inbox chat view talks to OpenCode's local background service from the
main process only (`src/main/opencode/service/`). The renderer never gets the
service address or password and has no network access to it; it can only call
the validated `chat:*` channels.

- **Discovery.** A fixed script runs the configured OpenCode executable (checked
  like every other OpenCode launch) with `service start`, then prints
  OpenCode's `service.json` between random markers on standard output; no
  temporary file is involved. The `url` must be `http:` on `127.0.0.1`,
  `localhost` or `[::1]` with an explicit port and no credentials, path, query
  or fragment, and the password must be 1–256 printable ASCII characters.
  Anything else is refused. This validates the URL text, not the identity of
  the listening service or the eventual socket peer; `localhost` relies on OS
  resolution. Packaged resolver/proxy behavior still needs network verification.
- **Secrets.** The password is held in memory per target, sent only as HTTP
  Basic auth to that loopback origin, and never logged, stored or put in an
  error message. A 401 or connection failure drops it and rediscovers once.
- **Operations.** `SERVICE_OPERATIONS` is a fixed allowlist of method
  and path pairs (agents, skills, MCP servers, providers, models, session create/get/active, message
  list, prompt, interrupt, agent and model switch, permission and form
  list/reply, session update, staging or clearing a revert, fork, compact, one-off text generation for a
  side question, running a slash command of the session, reading the goal plugin's state, listing or cancelling the inbox items the service holds for a busy agent, changing their
  delivery, and listing, connecting and disconnecting MCP servers). The skill list (`GET /api/skill`)
  takes only the `location[directory]` query. OpenCode answers with each skill's full text and file path;
  the main process keeps the id, name and a one-line description and drops the rest, so neither reaches
  the renderer. A prompt can carry `skills` ids, but only ones the main process found by exact match in
  that same list; the renderer sends text only and has no field to name a skill. The `chat:regenerate-title` channel accepts only a
  recorded session ID and sends a fixed PATCH body `{ title: '' }`; the renderer cannot
  supply arbitrary update fields, paths or targets. The `chat:redo` channel likewise accepts only a
  recorded session ID and sends `DELETE /api/session/{sessionID}/revert` with no body, which
  undoes a revert OpenCode has staged. The `chat:revert` channel accepts only a recorded
  thread ID, a message ID matching `msg_` followed by at most 200 ID characters, and an optional
  boolean (`files`), and sends `POST /api/session/{sessionID}/revert/stage` with the body
  `{ messageID }`, or `{ messageID, files: false }` to leave the files alone. The agent is
  interrupted first, and a busy answer is retried for about ten seconds. The service itself
  restores the files from its own snapshot; MDE sends no paths or file contents, and the diff
  OpenCode answers with is reduced to paths, status and line counts before it reaches the
  renderer. The `chat:discard-pending` channel accepts only a recorded thread ID and a message ID of the
  same `msg_` form, and sends `DELETE /api/session/{sessionID}/inbox/{inboxID}` with no body, which
  cancels a message the service has not yet delivered to the agent and does nothing for one it has. The
  held messages are read with `GET /api/session/{sessionID}/inbox`, whose answer is parsed down to the
  user's own messages; an ID that is not `msg_` form is dropped, so every message that is shown can be
  taken back. The `chat:set-delivery` channel accepts the same two IDs and a `delivery` from the fixed set
  `steer`, `queue`, and sends `PATCH /api/session/{sessionID}/inbox/{inboxID}` with the body
  `{ delivery }`; nothing else can be put in the body. `chat:send` returns the message as the service
  accepted it. Its payload may carry a `delivery` from the same fixed set (anything else is refused),
  which is added to the prompt body as the one extra field `delivery`; left out, nothing is sent. The
  `chat:aside` channel (the `/btw` side question) accepts only a recorded thread ID and a `question` of
  ordinary prompt text: at most 100,000 characters, no control characters other than tab and line breaks,
  and not blank; any other field is refused. The main process, not the renderer, builds the prompt: it puts
  OpenCode's own side-question preamble (answer from what you already know; call no tools and take no
  actions) in front of the question and sends `POST /api/session/{sessionID}/generate` with the body
  `{ prompt }`, with a longer timeout than the service's other calls because it is a model call. The service
  writes nothing to the conversation for it. The answer is reduced to its text, stripped of control
  characters and cut at the chat text limit, and the renderer shows it with the same read-only Markdown as
  assistant messages (raw HTML stays off). The `chat:fork` channel accepts only a recorded thread ID and an optional message ID
  of the same `msg_` form, and sends `POST /api/session/{sessionID}/fork` with the body
  `{ before }`, where `before` is that message ID or `null`. For a fork of the whole conversation the
  main process, not the renderer, decides what `before` is (see "Forking a thread" in
  `architecture.md`): it reads the session and the active list, and only while the agent is working
  it also reads pages of messages, keeping only the ID and text of the message the turn began with.
  OpenCode copies the messages and attachments inside the service, so the copy itself does not pass
  through MDE or the renderer, and the answer is reduced to the new session's ID, title and model.
  The `chat:compact` channel accepts only a recorded thread ID and sends
  `POST /api/session/{sessionID}/compact` with the fixed body `{ delivery: 'queue' }`; the renderer cannot
  supply the delivery or any other field. OpenCode answers at once and summarizes in the background, so
  nothing in the answer is used beyond its success. The summary reaches MDE only as a note in the
  conversation, read like every message (text capped, control characters stripped), and a failure is shown
  by its message only, never the provider's response body, which can carry request headers. The
  message page also says whether the session inbox holds a compaction, which is a yes or no read from the
  inbox list that was already requested for the held messages.
  The `chat:goal` channel (read a thread's `/goal`) accepts only a recorded thread ID and sends the plugin's
  RPC, `POST /api/rpc/opencode.goal/get`, with the body `{ input: { sessionID } }`; the path is fixed and
  the renderer supplies nothing of it. The `chat:goal-set` channel accepts a recorded thread ID and either
  `action: 'set'` with an `objective`, or `action: 'pause'`, `'resume'` or `'clear'` and nothing else; a
  `set` may also carry the agent and model the composer shows, checked like those of `chat:send`. The
  objective is ordinary prompt text of at most 4,000 characters (OpenCode's limit), not blank and not one of
  the three action words, which OpenCode would read as that action (`goalObjectiveProblem`, applied in
  the renderer, the IPC validator and the service). The main process sends `POST
  /api/session/{sessionID}/command` with the body `{ name: 'goal', text }`: the command name is fixed to
  `goal`, so the renderer cannot run any other command of OpenCode's, and `text` is the objective or the
  action word. The answers are read strictly: a goal is kept only with a known status, bounded counts and
  an ID of the usual form, its objective and reason are capped and stripped of control characters, and the
  `rpc.opencode.goal.changed` event is passed on only when it parses the same way. The goal's text reaches the
  renderer as plain text (the objective, the reviewer's reason) or as a note in the conversation, never as
  HTML.
  The MCP list (`GET /api/mcp`) takes only the `location[directory]` query. OpenCode's answer also says
  how each server is started or reached; the main process keeps a server's name, an optional title, its
  state and a short error, and drops everything else (commands, URLs, headers, environment), so none of it
  reaches the renderer. The error is cut to one line of at most 300 characters, with credentials in URLs,
  query strings, `Bearer` tokens, `key=`, `token=`, `secret=` and `password=` values, long opaque tokens
  and home-directory paths taken out (`redactMcpError`). A server whose name could not be put in a URL
  safely is not listed. The `chat:mcp` channel accepts exactly one of a folder ID and a thread ID. The
  `chat:mcp-set` channel adds a server name (1–200 characters, no control characters, not only dots) and
  a boolean, and sends `POST /api/experimental/mcp/{server}/connect` or `/disconnect` with no body. The
  main process acts only on a name OpenCode lists at that moment (exact match) and refuses a server that
  needs a sign-in or whose state is unknown, so a connect cannot start a sign-in flow on the machine
  running OpenCode; the renderer cannot add, change or remove a server, and these channels write no
  configuration file (the change lasts until OpenCode restarts). The name is percent-encoded as a path segment, and a
  name made only of dots is refused because `fetch` would normalise it out of the path.
  Path parameters must match `ses_`, `per_` or `frm_` ID patterns (an MCP server name, the rule above),
  only the query keys `limit`, `order`, `cursor` and `location[directory]` are
  allowed, request bodies are capped at 1 MB, responses at 16 MB, and each
  request times out after 30 seconds. Redirects are rejected.
- **Permission approvals.** Incomplete, malformed, overlong or visually ambiguous
  resource lists disable approval in the card. Main re-reads the request before
  granting and refuses incomplete or missing scopes; rejection remains available.
- **Event streams.** SSE limits count full multiline UTF-8 events and cancel
  oversized streams. Aggregate resource budgets remain an open hardening area.
- **Responses.** Every response and event is parsed into MDE's own types; unknown
  fields are dropped, tool input and output are cut at 64 KB, and control
  characters are stripped. Subagent model labels use validated child session IDs from the parent
  conversation's tool metadata or result/error wrapper. Main reads the child session from the same
  service, verifies its ID and parent ID, and forwards only its selected model. These optional reads
  time out after two seconds and run at most four at once. Model and agent selection events for a
  verified child refresh its subscribed parent; no child transcript is read or recorded.
  Other events for sessions the Inbox does not already hold
  are ignored; another exception is an MCP server change (`mcp.status.changed`, `mcp.tools.changed`), which
  names no session and only tells the renderer to read the server list again. Assistant replies and reasoning share the read-only Markdown renderer:
  only registered schema nodes and attributes are rendered, with no arbitrary HTML,
  scripts, embedded frames or remote images. Links open only for HTTP(S) URLs and
  go through the same main-process URL validator as other external links.

Inbox folders are separate from workspace sessions; adding one
resolves and validates its target-native path before storing the folder.

The Inbox message input is a plain-text CodeMirror editor with decorations for Markdown bullet
markers. It never renders prompt HTML, links or image embeds. Text paste reads only `text/plain`;
clipboard images follow the existing attachment boundary. Drafts and sent prompts remain plain
Markdown, including text that is outside the supported formatting.

Draft keys are validated as `thread:ses_…` or `draft:drf_…` (letters, digits, `-` and `_`, at most
64 characters for a draft id), so an id never becomes a path: attachment copies have opaque names
and the draft index is one file. A draft's `folderId` must look like a folder id and, when a change
names it, be a folder in the Inbox. A draft request may also carry `choice`, which takes only an
`agent` id, a `model` reference and a `worktree` of `{ base, branch? }` (strings of at most 256
characters without controls, no other key anywhere). The branch is not held to Git's branch-name rules
there, since it is saved while it is typed; `chat:create` checks it as before and the main process
again when the worktree is made. `chat:drafts` takes no payload and returns text previews cut at
300 characters and the saved choices, no file contents, plus the ids of threads with an unsent message
(never their text).

### Inbox attachment boundary

`chat:draft` is a fixed, validated union of draft load/text/prepend/add/tree/remove/clear/flush operations.
Keys name an existing Inbox thread or folder. Binary uploads are bounded Uint8Arrays; generated
IDs reference only files owned by that draft. Original filenames never form storage paths.
Sidebar sources resolve through known sessions/folders and bounded regular-file reads with
real-path containment checks, including in WSL. Renderer payloads cannot supply service URLs,
file URLs, shell commands, or storage paths. Attachment contents are never logged.

Draft files and their atomic index use private permissions on POSIX systems, and live under the
app's user-data directory. They are not encrypted. Generated thumbnails are raster data URLs;
remote image URLs and attachment HTML are never rendered. Existing CSP and renderer isolation
remain unchanged. Prompt and history size allowances are restricted to the relevant fixed
OpenCode operations; oversized history responses retry with smaller pages, never unbounded reads.

### Git execution boundary

Automatic status queries, diffs, branch discovery and worktree operations treat
repository configuration as untrusted input. Native and WSL Git runners apply
the same policy:

- All transport protocols are denied with an empty `GIT_ALLOW_PROTOCOL`, even if
  repository configuration explicitly allows a protocol or remote helper.
  `GIT_NO_LAZY_FETCH=1` also disables on-demand fetching on supporting Git versions.
  Missing local objects produce an error; MDE does not fetch them.
- Before each status, diff or converting worktree operation, main reads effective
  filter key names, including global/system, conditional includes and per-worktree
  settings. Bounded command-line overrides empty every configured driver's clean,
  smudge and process command. No filter command values are passed to the UI or logged.
  `GIT_CONFIG` is removed so it cannot redirect only the configuration probe.
- Read operations compare unfiltered content. Worktree checkout/removal requires
  a selected configured filter to succeed while its commands are disabled, so Git
  refuses that operation instead of silently producing an incomplete checkout.
  Manage filter-dependent worktrees in a terminal and add their folders to Inbox.
- New worktrees are registered with `--no-checkout`, then populated through a
  guarded reset in that new worktree. This inspects settings for the new branch
  before conversion; the original branch's configuration is insufficient.
  Removal also inspects the target worktree's settings before its cleanliness check.
- Branch discovery uses repository/ref metadata only. Local and cached
  remote-tracking branches remain available without scanning files or fetching
  objects. The Git graph (Inbox and Sessions) reads history the same way (`log`,
  `for-each-ref`, `diff-tree` without external diff or textconv), and `git:commit`
  accepts only a full 40- or 64-digit object name. `git:commit-diff` also takes a
  path, which must be one of the files that commit changed. The `git:*` graph channels take
  either an Inbox thread ID or a terminal ID (exactly one, never a path); a terminal
  resolves to its live current directory, verified on disk like its Git chip's.
- **User-started fetch.** `git:fetch` (a thread or terminal ID, nothing else) is the one call
  allowed to reach the network, and the renderer sends it only from the Git graph's Fetch
  button. It uses a separate runner, `createGitFetchRunner`, with `GIT_ALLOW_PROTOCOL` set to
  `file:git:http:https:ssh` (remote helpers such as `ext::` stay denied), hooks and fsmonitor
  disabled, askpass and terminal prompts off, and no submodule recursion or automatic
  maintenance. It keeps the person's credential helper and SSH command so they can sign in, so
  it first lists configuration with `--show-scope --includes` and refuses when a `local` or
  `worktree` scope (including files those include) sets `credential.helper` or
  `credential.<url>.helper`, `core.sshCommand`, `core.gitProxy`, or a remote's `uploadpack`,
  `receivepack` or `vcs`. Global, system and environment settings are the person's own. The
  command is fixed (`fetch --all --prune --no-recurse-submodules`); the renderer chooses no
  remote, refspec or URL. Error text shown in the UI keeps Git's `fatal:`/`error:` lines with
  URL credentials and control characters removed. A real-Git test fetches over `file://`,
  refuses a planted `remote.origin.uploadpack` without running it, and fails an `ext::` remote
  without running it. Submodule recursion/diffs and automatic maintenance are disabled
  in MDE-owned calls to avoid child operations with another execution context.

Real-Git regression fixtures cover info attributes, local/global/included/worktree
filters, long-running process filters, branch-conditional checkout/removal,
missing objects, a loopback HTTP recorder and a planted remote helper. They also
verify ordinary checkout, built-in line-ending conversion and branch listing
with missing blobs. Filter settings are re-read rather than cached; these
separate subprocesses do not establish atomicity against concurrent malicious
rewriting of Git configuration. Such mutation remains a filesystem trust limit.
Native Windows/WSL and macOS packaged acceptance is required; OS network
mounts and login-shell startup need separate attribution.

### Inbox worktree boundary

An Inbox thread can run in a Git worktree MDE creates, which is the only place MDE changes a
repository. `chat:create` accepts an optional `worktree: { base, branch? }`, where `base` is a string
of at most 256 characters without controls and `branch` is an optional name for the new branch; the
object takes no other key, so the renderer cannot name a path, a remote or a command.

- **The base is matched, never trusted.** The main process lists the refs with
  `git for-each-ref` and accepts `base` only if it equals the displayed name of one of them, so a
  string such as `--force`, `HEAD`, `../x` or a ref that does not exist never reaches a
  creating command. The start point is passed as the full refname (`refs/heads/…` or
  `refs/remotes/…`), which cannot be read as a tag, a path or an option.
- **Paths are generated; a branch name is generated or validated.** The worktree is
  `<home>/.mde/worktrees/<folder name>-<folder id>/<id>`, where `<id>` is eight random hex digits and
  the folder name is reduced to letters, digits, `.`, `_` and `-`; no user text reaches a path. The
  branch is `mde/<id>` unless the person typed a name. A typed name must pass
  `worktreeBranchProblem` (`src/shared/worktree-branch.ts`): at most 100 characters of plain ASCII
  letters, digits and `. _ - / +`, with Git's own branch-name rules and no leading `-`, so it
  cannot be read as an option. The IPC validator applies that function, the main process applies it
  again with a readable message, and Git validates the name a third time. The name must not exist as
  a local branch (listed and checked with `git show-ref`) and must not sit inside or on top of one,
  so an existing branch is never reused. The cleanup after a failed start deletes the branch only
  because the name was checked to be free first, and never after a clash.
  The home directory comes from the folder's own target (`os.homedir()` on macOS, the distro's
  login-shell `$HOME` on Windows) and must be a plain absolute path.
- **No shell.** Arguments are a fixed array with `--` before the positional operands. WSL commands
  run through `wsl.exe -e` direct execution, like every other WSL command.
- **Git safety overrides, longer clock.** Both runners deny remote transports and automatic
  lazy fetching, disable hooks/fsmonitor/credential helpers, and inspect all effective configured
  filter drivers before converting operations (see "Git execution boundary"). Built-in
  text/eol/ident conversion remains enabled. A checkout that selects a configured external filter
  is refused, with an explanation to manage that worktree in a terminal. An unrelated globally
  installed filter does not prevent an ordinary checkout. Conversion begins only after
  `worktree add --no-checkout`, through a guarded reset in the new branch's own context.
- **Removal is conservative.** `inbox:remove` with `removeWorktree` acts only on a thread MDE
  recorded with a worktree, whose root is a plain absolute path inside `<home>/.mde/worktrees/` and
  contains the thread's directory, and only when no other thread uses that root. It runs
  `git worktree remove` without `--force` from the recorded repository, so uncommitted changes
  make Git refuse and the refusal is shown; the branch is kept. The renderer can request
  removal only for a thread ID, never for a path.
- **Failed starts clean up after themselves.** A worktree whose session could not be created is
  removed with `--force` together with its branch, which is safe because nothing has run in it;
  cleanup errors are swallowed and the original error is reported.

- **Worktree folders are listed by main, never by the renderer.** A new worktree is added to the
  Inbox folders only after its thread was recorded, with the same record the thread carries; no
  channel takes a worktree record from the renderer. A thread started in such a folder copies the
  folder's record, so removal later passes the same checks, and a `worktree` request for a worktree
  folder is refused so a worktree is never cut from another.
- **Removal drops the entry.** `inbox:remove` with `removeWorktree` that succeeds also removes the
  folders recorded for that root; if Git refuses, nothing is dropped. Drafts written for such a
  folder are kept and open in another folder.

`inbox.json` stores the worktree record (the repository directory, the root, the branch and the
base) on the thread and on the folder entry, and is validated on load like every other field; a
malformed record on a folder is dropped and the folder stays.

### WSL folder browser boundary

The Windows file dialog cannot show a WSL distro's own filesystem, so choosing a WSL folder uses a
browser built into MDE (the Add folder dialog of the Inbox and the New session dialog). It is backed
by one read-only channel, `path:list-wsl-directories`, which takes a distro name, an optional
absolute Linux path and a flag for hidden folders.

- **Names only.** The reply is the folder names directly inside one folder: no file names, no file
  content, and nothing is created, changed or opened. Names that are not plain path text (a
  backslash or a control character) are left out, and a listing is cut off after 1,000 folders.
- **Validated in both places.** The IPC validator accepts the distro by the same pattern as the other
  path channels and rejects a path with controls or over the path limit. The main process then
  requires `isPlainAbsolutePath` (absolute, no backslash, no control character, no `.` or `..`
  segment), and refuses to run outside Windows.
- **No shell.** The distro runs `find -L <path> -mindepth 1 -maxdepth 1 -printf …` through
  `wsl.exe -e`, so the path is one argument that cannot be parsed as syntax and, being absolute,
  cannot be read as an option. Without a path the start is the distro's login-shell `$HOME`.
- **Same reach as a file dialog.** The renderer can list any folder the distro user can read, as the
  system file dialog could. A folder chosen here is only text in the form field: it is validated and
  canonicalized again by `path:resolve` and `path:validate` and by the add handlers before anything
  is stored or run.

### OpenCode configuration boundary

The **OpenCode configuration** editor changes OpenCode's own global file, so it is the one place MDE writes
outside its own stores and outside a project checkout. It is limited to three things: permission rules,
OpenAI-compatible providers and `provider.use` deny policies (disabled providers), in OpenCode 2's own keys
(`permissions`, `providers`, `policies`). The code is in `src/main/opencode/config/`.

- **The renderer names no path.** It sends `native` or `wsl` plus a distro. The main process accepts `wsl`
  only on Windows, with a distro name that `wsl.exe -l` lists, and `native` only elsewhere. The folder is
  worked out where OpenCode runs (`OPENCODE_CONFIG_DIR`, else `$XDG_CONFIG_HOME/opencode`, else
  `~/.config/opencode`; in the distro through its login shell). The WSL value checker currently
  requires an absolute prefix and rejects NUL/newlines, but does not apply the stricter plain-path
  rules to every value before UNC translation; backslashes and dot segments need hardening.
  The file is `opencode.jsonc`, else `opencode.json`, else a new `opencode.jsonc`. In a distro it is
  reached as `\\wsl.localhost\<distro>\...`.
- **Size and type.** A file over 1 MiB or one that is not a regular file is refused. The target of a
  symbolic link is edited in place (`realpath` first; for WSL, `realpath` run in the distro) so a file
  managed by dotfiles is not replaced by a regular one.
- **Edits are surgical and checked.** `jsonc-parser` locates things and `jsonc-edit.ts` changes only the
  entries being added, replaced or removed. Comments, other keys, foreign providers, other policies,
  legacy keys (`permission`, `provider`, `disabled_providers`, `enabled_providers`), indentation, line
  endings and a byte order mark are kept. Every result is parsed again before it is written; if an edit
  would leave invalid JSON (OpenCode ignores such a file without a message), nothing is written. A
  provider id that collides with a provider the editor does not manage is refused rather than merged.
  A file that is not valid JSONC is shown as such and never changed.
- **Lost updates are refused.** The snapshot carries a SHA-256 of the file text (`absent` when there is no
  file). Save reads the file again, refuses if the hash differs, then applies the draft to the fresh
  text. Saves are serialized.
- **Atomic replacement and modes.** The text goes to a temporary file in the same folder (mode of the existing
  file, `0600` for a new one), is flushed and renamed over the target. Cleanup is attempted after
  rename failure, but earlier write failures or a crash can leave a temporary copy. Creation uses a
  predictable time/PID name without exclusive creation and relies on the containing directory's
  access controls. Nothing is intentionally backed up by MDE.
- **No secrets are asked for or written.** A provider's key is the name of an environment variable
  (`env: [NAME]`), validated as such; a base URL with a user name or password is refused. Keys already in
  the file stay where they are, are not sent to the renderer as part of the draft, and the Source preview
  parses JSONC and uses source offsets to replace complete values under decoded secret-looking
  keys with `(hidden)`, including arrays and objects. Comments outside redacted values and unrelated
  formatting remain intact. Env/file string references remain visible. Invalid JSONC has no
  content preview. Unknown-name secrets and unrelated comments are still outside this heuristic;
  the preview is not a fully sanitized artifact for sharing.
- **No new network access.** Listing providers uses the existing local service client. After a save the
  main process only drops its cached model list; OpenCode reloads the file by itself.
- **Reach.** Script already running in the renderer could change these three settings, including
  allowing every tool without asking (`permissions`). That is the same class of authority as writing to a
  terminal through `pty:write`, and is recorded for the same reason as the clipboard note above.

Regression coverage: `test/opencode-config-edit.test.ts`, `test/jsonc-edit.test.ts` (exact-output tests and
a seeded fuzz that parses every result), `test/opencode-config-files.test.ts` (real temporary directories,
symbolic links, modes, conflicts, WSL paths), `test/ipc-opencode-config.test.ts` and the validator cases in
`test/ipc-validation.test.ts`.

### MDE MCP boundary

The MDE MCP lets an agent start Inbox threads and open Inbox terminal panes (`src/main/mcp/`, `src/shared/mde-mcp.ts`). It adds the one
place where something other than the window can ask the main process to act, so it is kept narrow.

- **Two processes, no network.** OpenCode starts MDE's own executable with `--mcp-bridge` as a stdio MCP
  server (`mcp.servers.mde` in its configuration). `src/main/index.ts` checks for that flag before
  registering the renderer scheme or taking the single-instance lock: the bridge opens no window, touches no
  store and sends console output to stderr, since stdout carries the protocol. It answers `initialize`,
  `ping` and `tools/list` itself and sends each `tools/call` to the running MDE as one JSON line on a fresh
  connection to a Unix socket (`<userData>/mcp.sock`, mode `0600`; a temporary-folder path when that one is
  too long for `sun_path`) or, on Windows, a named pipe (`\\.\pipe\mde-mcp-<hash of userData>`). Nothing
  listens on TCP. The Electron `runAsNode` fuse stays off; the bridge is the full app binary in a different
  mode, not a Node interpreter.
- **Token.** Every request carries the 256-bit secret from `<userData>/mcp-token` (mode `0600`), compared in
  constant time. The socket's mode and the user-data folder already keep other accounts out on the Mac; the
  token also covers the Windows pipe, whose default ACL lets other local accounts open it for reading.
- **Limits.** One request per connection, at most 1 MB, read within 10 s; at most 16 connections at once;
  agents may start at most 10 threads a minute in all, and a chain of agent-started threads stops at three
  levels (`spawnedBy`). The listener runs only where the Inbox does (macOS and Windows) and is closed on quit.
- **Same checks as the window.** `create_thread` refuses unknown arguments and checks the prompt (length,
  control characters), agent name, `provider/model`, mode and worktree branch with the rules the IPC
  validator and `worktreeBranchProblem` use. A directory must be a plain absolute path (or a
  `\\wsl.localhost\<distro>` path in the caller's distro); an unknown one goes through the same
  resolve-and-check (`checkedInboxFolderPlace`) as **Add project**, so it must be an existing directory on the
  caller's target. Then it calls `InboxChatService.create`: the thread is an ordinary Inbox thread, and its
  agent runs with OpenCode's permission rules like any other. The request's target must be the one this
  platform runs threads in (WSL on Windows, native on macOS).
- **Who asked.** OpenCode 2.2.6 puts the calling session in each call's `_meta["ai.opencode/sessionID"]`.
  It is only used to look up the parent thread (for the marker, the default directory and model, and the
  depth limit); a session that is not an Inbox thread simply has none.
- **Reach.** Any process running as the same user that can read the token can start threads, which run
  agents with your OpenCode configuration and cost model usage. That is no more than such a process could do
  through OpenCode's own service password or the terminal. Agents that have the MCP installed can do the
  same, within the limits above. Removing the entry (Settings → OpenCode → MDE MCP → Remove) stops it.
- **Install** writes only `mcp.servers.mde` = `{ type: "local", command: [...] }` into OpenCode's global
  configuration, with the configuration editor's guarantees (surgical JSONC edit, re-parse, serialized atomic
  write, nothing written to a file that does not parse). The command is built in the main process from
  `process.execPath` (plus the app folder in development; inside WSL, the path `wslpath -u` gives; plus
  `--mcp-user-data=<folder>` when MDE runs with its own `--user-data-dir`, which the bridge accepts only as an
  absolute path); the renderer names only a target.

- **Terminals agents open.** `open_terminal` can make a shell run a command, which OpenCode's own permission
  rules for shell commands (a `bash` rule of `ask` or `deny`, the plan agent) do not see. So commands wait
  for the person by default: the pane shows the whole command on an approval bar and nothing is typed until
  **Run**. **Run without asking** (Settings → OpenCode → MDE MCP, kept in `mde-mcp.json`) and **Run, and allow
  for an hour** (in memory only; the settings can only clear it, `agent-terminal:decide` and the settings
  channel cannot set or extend it) are the person's choice. A command must be one line of at most 2,000
  characters with no control characters (no second command through a line break, no escape sequences for the
  terminal or the line editor) and no bidirectional formatting characters (which could make the bar show
  something other than what runs). Main types the command from its own copy, keyed by the terminal it
  started; the window only names a terminal and an answer, so it cannot change the command or run one main is
  not keeping. Main starts the shell itself only for a pane ID of the Inbox terminal that is not running yet
  (never a thread's terminal or a Sessions pane), only for a directory checked like a project folder and in
  the environment the Inbox terminal runs in, and through the ordinary launch's folder checks. The pane never
  takes the keyboard, so nothing the person types goes into it by surprise. Limits: ten terminals a minute,
  four requests waiting for the window at once, none once the terminal has nine panes, and a background
  shell's kept output is capped at 2 MB.

- **Views agents show.** `show_view` sends data, never code: the view is a JSON tree of MDE's own components,
  checked against a fixed catalog (`checkView` in `src/shared/view-spec.ts`) by the bridge before it answers
  and again by the window before drawing; only the checked copy is drawn. No component takes HTML, Markdown,
  styles, colours, class names, URLs, images, media or scripts, and nothing in a view acts on a click beyond
  the view itself (tabs, sorting, the table and JSON toggles): no action reaches the agent, a link or the
  system, so a prompt-injected agent cannot make a view do anything, only show something, and every view is
  marked "From the agent" with its JSON one click away. Text reaches the page only as React text; control
  and bidirectional formatting characters are refused. Size limits keep drawing cheap (48,000 characters,
  150 elements, 8 levels, 6,000 numbers, 400 points per series, 200 rows). Views add no network access and no
  new stored data; the renderer's Content-Security-Policy (`script-src 'self'`, `img-src 'self' data:`,
  `connect-src 'self'`, no `unsafe-eval`) stays as it is, so even a fault in the view code could not load or
  send anything. A drawing fault is caught per view by an error boundary.

Regression coverage: `test/view-spec.test.ts` and `test/inbox-views-ui.test.ts` (views: the check, the bridge's
answer, the parser keeping a view whole, drawing), `test/mde-mcp.test.ts` (protocol, framing, bridge ↔ listener over a real socket, token,
tools, configuration edits), `test/mde-mcp-agent-terminals.test.ts` (approval, the hour, refusals, timeouts),
the agent-pane cases in `test/ipc-inbox-terminal.test.ts`, `test/pty-manager.test.ts` (kept output, typed input)
and the validator cases in `test/ipc-validation.test.ts`.

## Windows executable selection

`src/main/windows-executable.ts` resolves Windows host programs before launch.
WSL commands, WSL PTYs and OpenCode service discovery use the canonical absolute
`SystemRoot\System32\wsl.exe` path and an explicit host working directory.
Native Windows sessions use the system PowerShell by default; `powershell` /
`powershell.exe` and `cmd` / `cmd.exe` overrides map to their system locations.
Other native Windows shell overrides require a full drive-qualified `.exe` or
`.com` path, including PowerShell 7 (`pwsh.exe`). Bare names, drive-relative
paths, UNC/device paths, dot segments, controls and alternate streams are
rejected instead of searching the application's startup directory or `PATH`.

The resolver reads `SystemRoot` case-insensitively, canonicalizes paths, checks
regular-file type and rejects system programs redirected outside the Windows
installation tree. It resolves only the program being used and caches successful
results, so missing WSL does not disable native shells. Missing/invalid paths
fail without a bare-name fallback. Native PTYs start in a verified restored directory or the user's home directory. WSL `--cd` likewise selects the verified Linux directory,
defaulting to `~`.
Launch-spec construction receives resolved host paths and remains free of
filesystem lookup. These changes add no renderer or preload capabilities.

The inherited Windows installation location and explicitly configured custom
shell remain trusted account configuration. This does not verify publisher
signatures or protect against an attacker who already controls the OS, the
launch environment or the selected executable. Shell/agent command lookup
inside a Linux distro follows that user's shell configuration. The Linux WSL
interop path retained for opt-in integration tests is separate from Windows
host executable lookup.

`test/windows-executable.test.ts` covers path policy and lazy resolution;
launch, PTY, WSL buffer and OpenCode transport tests cover consumers and failed
resolution before side effects. The opt-in native Windows integration test
plants runnable harmless executables in both cwd and `PATH`, verifies the
sentinel itself works, and exercises real distro queries, PowerShell and
native/WSL ConPTY. See the Windows release checklist for running
it. It uses only scratch data and terminals.

## Dependency security maintenance

Run `npm run audit:deps` against the full lockfile after dependency changes and
before releases. Renderer libraries such as Mermaid are bundled into the app
even though they are declared as development dependencies, so a production-only
audit does not cover all shipped code.

The release workflow (started by hand on the default branch) runs the full dependency
audit, tests, license check, typecheck, and packaged-output audit in fresh Windows and
macOS jobs before uploading ZIP/DMG artifacts and checksums. Build jobs have read-only
repository permissions, pinned official actions, no persisted checkout credentials or
signing secrets, and package without publishing. A separate job has limited release-write
permission to tag the built commit and create or update a draft release after both builds
succeed; it never moves an existing tag or touches a published release. Build artifacts
expire after three days; publication of the draft remains manual. The CI workflow runs the
tests on Linux and Windows, the license and typecheck gates, and this audit on every push
and pull request, with read-only permissions. It is a safety net, not a substitute for the
local checks above.

Runtime and packaging platform validation are separate gates; npm audit does not
inventory all native CVEs. Audit results describe the lockfile at the time of the
check and must be refreshed after dependency changes and before releases.

The lockfile includes patched `http-cache-semantics` 4.3.0 and `source-map-js`
1.2.2. These updates remain within their parents' existing dependency ranges.

The lockfile pins the three `undici` copies used by `node-gyp`, `@electron/get`
and `jsdom` to 6.29.1, 7.30.1 and 8.12.3, within their parents' ranges.

### Patched advisory: minimatch in the packaging toolchain

The override `minimatch@>=7 <11.0.1` selects exactly 11.0.1 for the affected modern
copies, including app-builder-lib and @electron/universal. It preserves minimatch
3/5 for legacy callers that require a callable CommonJS export; forcing the new
API onto those callers breaks archive creation.

`test/packager-globs.test.ts` exercises the actual builder matcher, universal
merger's named matching API and legacy asar matching API. Native Windows/macOS
packaging remains a release check. Remove this override when upstream ranges
select patched versions themselves.

Three scoped overrides address advisories while preserving the current direct
dependency versions:

| Override | Reason | Removal condition |
| --- | --- | --- |
| minimatch 7–10 → 11.0.1 | Fixes globparts amplification while retaining legacy callable APIs in older copies. | Packager dependencies adopt patched modern versions. |
| Mermaid → KaTeX 0.18.2 | Fixes [inherited trust options](https://github.com/advisories/GHSA-238p-pmpm-9mq7). Mermaid's declared 0.16.x range excludes the fix. | Mermaid adopts a patched KaTeX release. |
| @electron/get → global-agent 4.1.3 | Removes the roarr → sprintf-js chain affected by [unbounded formatting precision](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). global-agent 4 no longer depends on roarr and retains the downloader's `bootstrap()` API. | Electron builder's downloader adopts a version without the vulnerable chain. |

KaTeX is also a direct dependency, pinned to the same 0.18.2, for LaTeX math in read-only Markdown. It renders
with `trust: false`, so commands that produce links, images or HTML attributes (`\href`, `\url`,
`\includegraphics`, `\htmlClass` and the like) are refused, with `maxSize`/`maxExpand` limits, a fresh macro
table per formula and a 4,000-character cap; failures show the source as text. `test/math-markdown.test.ts`
covers the delimiters, prices that must stay text, and refused commands.

`test/mermaid-runtime.test.ts` exercises real diagram rendering, Mermaid's math
integration, and rejection of inherited KaTeX trust options. The math integration
test enables HTML labels only in its isolated test configuration; the app keeps
HTML labels disabled and sanitizes diagram SVGs.
`test/dependency-security.test.ts` exercises Electron builder's actual downloader
in a child process with a local HTTP proxy and with `NO_PROXY` bypass, without
changing the test runner's global HTTP agents.

When updating these overrides, rerun those tests, the full test suite, typecheck,
compilation, the dependency audit, and the Windows build. Regenerate third-party
notices with `npm run licenses` when shipped dependencies change. Avoid blindly
applying `npm audit fix --force`: its proposed major-version changes can downgrade
the direct build and diagram dependencies.

## File read boundary

Native previews and attachment copies share nonblocking regular-file opens,
no-follow protection and handle identity revalidation. Linux checks the actual
opened descriptor path under `/proc`; WSL reads use a validated descriptor rather
than reopening the pathname. Linux regressions cover final-file and ancestor
replacement races and FIFOs. WSL pre-open FIFO races remain bounded by the
subprocess timeout.

Native Windows uses pinned handles as described below. On macOS, pathname
revalidation is defense in depth, not atomic ancestor containment; that limitation
remains open.

### Windows ancestor containment

Native Windows previews and attachment copies use the same fixed local helper. Main launches
validated absolute system PowerShell with no profile, a fixed encoded command and paths carried
only as JSON in the child environment. No user-controlled path is interpreted as script source.
The helper compiles MDE's fixed C# implementation with Add-Type; it opens and holds each directory
from the volume/share root without following reparse points and without FILE_SHARE_WRITE/FILE_SHARE_DELETE. A held
ancestor therefore cannot be renamed/replaced before the file read ends. It rejects reparse-point
handles, checks final root/file names from the handles and reads that verified file handle only.
All handles are released on success or failure. Size caps, changed-size rejection, a 15-second
process timeout, bounded output and at most two helpers at once limit the operation.

Internal links resolved to ordinary in-root paths remain supported. Unresolved reparse providers,
access/sharing failures or PowerShell policies that prohibit Add-Type cause a safe error; there is
no fallback to the vulnerable pathname reader. No elevation, persistent helper executable, new
package dependency or renderer capability is added. Helper startup adds latency to native Windows
file reads; it runs outside Electron's UI thread.

Directory opens request GENERIC_READ (including list access): attribute-only opens do not enforce
these share restrictions. A native OS test verifies that both rename and write handles fail while
a directory is pinned, then succeed after release.

The native Windows regression suite uses junctions without administrator/symlink privileges.
It covers ordinary/empty/oversized files, literal path characters, internal/external junctions,
handle release and repeated junction replacement between realpath and stat.
Packaged acceptance must also exercise the actual `files:read` IPC boundary.
macOS atomic ancestor containment remains open.
See [CreateFile sharing and reparse semantics](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-createfilew)
and [handle-derived names](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew).

## Platform security verification

Run native Windows/WSL and macOS acceptance against packaged artifacts, including
an extracted Windows release ZIP. Use fresh temporary userData and disposable
fixtures. Verify the `app://` origin, app-info IPC version, absence of renderer
Node globals, configured security fuses, and native/WSL ConPTY output and disposal.
Run the package path audit and the executable-lookup integration checks as separate
gates; source tests do not establish packaged behavior.

Filesystem checks should cover ordinary reads, junction/symlink containment,
device and alternate-stream path rejection, and concurrent ancestor replacement.
Tests requiring symlink privileges, POSIX modes or a real bash skip where those
capabilities are unavailable (`test/helpers/symlinks.ts`); keep those cases running
on supported systems and include a Windows account permitted to create symlinks.

Packaged network capture is a separate check. Attribute traffic from OpenCode,
OS network mounts and login-shell startup separately from MDE's HTTP client.
Passing terminal or filesystem smoke tests does not establish network isolation
or close known containment limitations.

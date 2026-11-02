# Security

Security-relevant design and maintenance notes. The privacy and network statement is in
[`PRIVACY.md`](../PRIVACY.md).

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
including within patches and launch commands. Optional fields may be absent or
`undefined`, as used by preload; nullable fields accept `null` only where the
shared contract allows it. No-payload channels accept only `undefined`.

The current limits are:

| Category | Limit |
| --- | --- |
| IDs | 512 UTF-16 code units |
| Labels and titles | 4,096 code units |
| Paths, executables and individual arguments | 32,768 code units |
| Task descriptions, terminal input and clipboard text | 2 Mi code units |
| Agent arguments | 128 entries; 256 Ki code units combined |
| Dropped file descriptors | 256 entries |
| Terminal columns and rows | Integers from 1 through 4,096 |
| Layouts | Defined layout enum, matching pane count, unique pane IDs, finite ratios strictly between 0 and 1 |

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
Inbox folder requests (`inbox:folders-add`, `inbox:folders-remove`,
`inbox:composer-set`) accept a target and a path, which the handler resolves and
validates like a session path (WSL only on Windows, native elsewhere), or an
`fld_` folder ID, an OpenCode model reference and an agent ID. Chat requests
(`chat:*`) accept `ses_`, `per_` and `frm_` IDs by pattern, prompts of at most
100,000 code units without controls other than newline and tab, permission
decisions from the fixed set `once`, `always`, `reject`, and form answers of
bounded keys, strings, numbers, booleans and string lists. `files:list` and `files:read` also accept an Inbox `fld_` folder ID or `ses_` thread ID in place of a session ID; the main process resolves it to that folder's directory, and the usual containment checks apply. Domain handlers still verify resource
existence, session/source ownership, filesystem containment and platform
constraints after the central validation.

Errors identify the rejected channel or sender without including the payload,
which may contain terminal input or secrets. The boundary rejects oversized
requests rather than silently truncating them. Electron deserializes messages
before these checks, so these limits bound accepted handler work rather than
preventing all IPC transport allocation or request flooding.

This boundary authenticates a frame, not individual user gestures. JavaScript
already compromised inside the authorized renderer retains its legitimate
bridge capabilities, including PTY input, configured agent launches and
workspace changes. Sender checks and payload schemas do not establish
executable provenance or make third-party agents safe. Any future capability
restriction or move of command preferences into main-process storage should
be evaluated separately.

Regression coverage includes `test/ipc-security.test.ts`,
`test/ipc-validation.test.ts`, `test/worktree-branch.test.ts`, `test/inbox-worktree.test.ts` (real
Git, including hostile base and branch names and a branch that already exists), and the
registered-handler tests in
`test/ipc-drop.test.ts`. Every shared channel must have a validator and a normal
request fixture. Existing path/drop/history tests exercise the same real
boundary with a trusted sender fixture. Native Windows/WSL smoke testing is
still required before claiming platform-specific release verification.

On 2026-10-03 the built application also passed an isolated Linux Electron
smoke test with sandboxing enabled: main-frame app/workspace requests and a
project create/remove succeeded, malformed project payloads were rejected,
and another sandboxed window loading the same app URL could not invoke
`app:info`. The fixture used temporary userData and left the user's workspace
untouched. This was an unpackaged Linux check, not Windows/WSL verification.

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
  Anything else is refused, so a tampered state file cannot point MDE, and the
  password, at another host.
- **Secrets.** The password is held in memory per target, sent only as HTTP
  Basic auth to that loopback origin, and never logged, stored or put in an
  error message. A 401 or connection failure drops it and rediscovers once.
- **Operations.** `SERVICE_OPERATIONS` is a fixed allowlist of twenty method
  and path pairs (agents, providers, models, session create/get/active, message
  list, prompt, interrupt, agent and model switch, permission and form
  list/reply, session update, staging or clearing a revert, and fork). The `chat:regenerate-title` channel accepts only a
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
  renderer. The `chat:fork` channel accepts only a recorded thread ID and an optional message ID
  of the same `msg_` form, and sends `POST /api/session/{sessionID}/fork` with the body
  `{ before }`, where `before` is that message ID or `null`. For a fork of the whole conversation the
  main process, not the renderer, decides what `before` is (see "Forking a thread" in
  `architecture.md`): it reads the session and the active list, and only while the agent is working
  it also reads pages of messages, keeping only the ID and text of the message the turn began with.
  OpenCode copies the messages and attachments inside the service, so the copy itself does not pass
  through MDE or the renderer, and the answer is reduced to the new session's ID, title and model.
  Path parameters must match `ses_`, `per_` or `frm_` ID patterns,
  only the query keys `limit`, `order`, `cursor` and `location[directory]` are
  allowed, request bodies are capped at 1 MB, responses at 16 MB, and each
  request times out after 30 seconds.
- **Responses.** Every response and event is parsed into MDE's own types; unknown
  fields are dropped, tool input and output are cut at 64 KB, and control
  characters are stripped. Events for sessions the Inbox does not already hold
  are ignored. Assistant Markdown is rendered with raw HTML off, and its links
  go through the same main-process URL validator as other external links.

Inbox folders are separate from workspace projects and sessions; adding one
resolves and validates the path through the same checks as a session path.

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
- **Same hardening, longer clock.** The runner keeps the safety options of the automatic queries
  (hooks, `core.fsmonitor`, credential helpers, askpass and ssh commands are disabled) and drops only
  `--attr-source`, which would make a checkout ignore `.gitattributes`. Creating a worktree never
  fetches, so it uses no network and no credentials, and never runs the repository's hooks.
- **Removal is conservative.** `inbox:remove` with `removeWorktree` acts only on a thread MDE
  recorded with a worktree, whose root is a plain absolute path inside `<home>/.mde/worktrees/` and
  contains the thread's directory, and only when no other thread uses that root. It runs
  `git worktree remove` without `--force` from the recorded repository, so uncommitted changes
  make Git refuse and the refusal is shown; the branch is kept. The renderer can request
  removal only for a thread ID, never for a path.
- **Failed starts clean up after themselves.** A worktree whose session could not be created is
  removed with `--force` together with its branch, which is safe because nothing has run in it;
  cleanup errors are swallowed and the original error is reported.

`inbox.json` stores the worktree record (the repository directory, the root, the branch and the
base) and is validated on load like every other field.

## Windows executable selection

`src/main/windows-executable.ts` resolves Windows host programs before launch.
WSL commands, WSL PTYs and OpenCode history queries use the canonical absolute
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
fail without a bare-name fallback. Native PTYs retain their project working
directory; WSL `--cd` still selects the Linux working directory separately.
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
sentinel itself works, and exercises real distro queries, history transport,
PowerShell and native/WSL ConPTY. See the Windows release checklist for running
it. It uses scratch data rather than a user's OpenCode sessions.

## Dependency security maintenance

Run `npm run audit:deps` against the full lockfile after dependency changes and
before releases. Renderer libraries such as Mermaid are bundled into the app
even though they are declared as development dependencies, so a production-only
audit does not cover all shipped code.

The macOS tag workflow also runs the full dependency audit, tests, license check,
typecheck, and packaged-output audit before uploading its DMG and checksum. It
uses pinned official actions, read-only repository permissions, no signing
secrets, and packaging with `--publish never`. Artifacts expire after three days;
release publication remains manual. Ordinary branch pushes do not run this gate,
so contributors must still run the local checks above.

The lockfile includes patched `http-cache-semantics` 4.3.0 and `source-map-js`
1.2.2. These updates remain within their parents' existing dependency ranges.

Plain `npm audit fix` (without `--force`) also moved the three `undici` copies
(`node-gyp`, `@electron/get` and `jsdom`) to 6.29.1, 7.30.1 and 8.12.3, again within
their parents' ranges.

### Open advisory: `minimatch` in Electron builder's toolchain

[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (a denial of
service from glob-pattern expansion) affects every `minimatch` below 11.0.1, and
`npm audit` reports it as 15 moderate findings under `electron-builder`: `app-builder-lib`,
`@electron/asar`, `@electron/universal`, `dir-compare`, `ejs`, `jake`, `filelist`, `glob`,
`rimraf`, `temp` and `electron-winstaller`. These are packaging tools, run only at build
time on patterns from this repository's own configuration; none of it ships in the app.

No safe fix exists yet. The newest `electron-builder` (26.18.1, and the 27 alpha),
`@electron/asar` 4.3.1, `dir-compare` 5.0.0 and `filelist` 2.0.2 all still depend on
`minimatch` 3 to 10. Forcing 11.0.3 with an override was tried and rejected: `glob` 7,
which `@electron/asar` uses to crawl files when packing, throws, `dir-compare` fails with
`minimatch_1.default is not a function`, and asar's unpacking stops working. The
suggestion of `npm audit fix --force` (`electron-builder` 20.23.1) is a downgrade by
six major versions.

Removal condition: `electron-builder` and the tools above move to `minimatch` 11.0.1
or later; then update, rerun `npm run audit:deps`, and build for each platform.

Two scoped overrides address advisories while preserving the current direct
dependency versions:

| Override | Reason | Removal condition |
| --- | --- | --- |
| Mermaid → KaTeX 0.18.2 | Fixes [inherited trust options](https://github.com/advisories/GHSA-238p-pmpm-9mq7). Mermaid's declared 0.16.x range excludes the fix. | Mermaid adopts a patched KaTeX release. |
| @electron/get → global-agent 4.1.3 | Removes the roarr → sprintf-js chain affected by [unbounded formatting precision](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). global-agent 4 no longer depends on roarr and retains the downloader's `bootstrap()` API. | Electron builder's downloader adopts a version without the vulnerable chain. |

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

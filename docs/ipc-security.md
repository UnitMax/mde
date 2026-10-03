# IPC security boundary

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
segments, backslashes or controls. Domain handlers still verify resource
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
`test/ipc-validation.test.ts`, and the registered-handler tests in
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

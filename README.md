# mde

Cross-platform desktop shell for an agentic dev environment: grouped projects containing
persistent terminal sessions, with first-class WSL support on Windows.

This is v1 — a desktop shell focused on persistent terminal workflows. Optional OpenCode TUI
plugins provide status, alerts, instance labels, and token-rate information without replacing
the terminal experience.

## Requirements

- Node 20+
- Windows 11, or Windows 10 version 1903 (build 18362) or newer, or Linux (X11 or Wayland)
  - Packaged Windows builds ship only `node-pty`'s ConPTY backend; the winpty fallback
    older releases would need is deliberately excluded.
- A C/C++ toolchain, because `node-pty` is a native module and is rebuilt against the
  Electron ABI by `@electron/rebuild` from `postinstall`:
  - Windows: Visual Studio Build Tools with the "Desktop development with C++" workload
  - Debian/Ubuntu: `build-essential python3`
- Linux only, to *run* Electron: `libnss3 libnspr4 libasound2t64` (`libasound2` on older
  releases). Without them the Electron binary fails with
  `error while loading shared libraries: libnspr4.so`.
- Opening a WSL session in VS Code requires Windows VS Code with the Remote - WSL extension
  installed locally. MDE uses VS Code's registered remote URI, so the `code` command does not
  need to be on PATH.

## Development

```sh
npm install     # also runs electron-rebuild for node-pty
npm run dev     # electron-vite dev server + Electron
npm test        # unit tests for the pure launch/path/parse/validation functions
npm run typecheck
```

## Packaging

```sh
npm run build             # typecheck, bundle, then package for the current platform
npm run build:win         # Windows ZIP    -> dist/mde-<version>-win.zip
npm run build:linux       # AppImage + deb  -> dist/mde-<version>.AppImage, .deb
```

Cross-building for Windows from Linux is not supported here; build it on Windows. If you develop
in WSL, `npm run build:win:remote` automates this: it rsyncs the repo to a staging directory under
the Windows temporary directory and runs the ZIP build using native Windows npm/node with
`node-pty`'s Windows x64 prebuilt runtime. Set `MDE_WINDOWS_BUILD_DIR` to a Windows-format path to
override the staging directory. The staging `dist` is emptied before each run, so it only ever
holds the artifacts of the build you just made. The first build runs `npm ci`; later builds reuse
the Windows `node_modules` directory until the dependency or native build inputs change. To force a
clean dependency install, run `npm run build:win:remote -- --force-deps`. Requires Node.js and
Visual Studio Build Tools ("Desktop development with C++") installed on Windows first (see
Requirements above).

## Licensing

MDE's first-party source, documentation, scripts, and branding are licensed under the MIT
License in `LICENSE`. Third-party packages remain under their own licenses; the complete
locked dependency inventory and available package license/notice text are recorded in
`THIRD_PARTY_NOTICES.md`.

Regenerate the notices after changing dependencies with:

```sh
npm run licenses
npm run licenses:check
```

Packaged builds include MDE's MIT license and third-party notices alongside Electron's
and Chromium's generated legal files. OpenCode is an external executable and is not
bundled or relicensed by MDE.

See [`docs/windows-release.md`](docs/windows-release.md) for the complete Windows release,
private-path audit, smoke-test, and publishing checklist.

## Architecture

```
src/
  main/      owns every node-pty instance, all filesystem access, all wsl.exe invocation
  preload/   contextBridge only — contextIsolation on, nodeIntegration off, sandbox on
  renderer/  React UI with no Node access whatsoever
  shared/    IPC channel names + payload types, imported by both sides so they cannot drift
```

### Projects and terminal sessions

Projects are label-only groups. Sessions own the name, path, platform, distro and optional shell
override. Each session persists an ordered set of terminal tabs. Every tab owns an independent
one-to-six-pane layout options, including three terminals side by side and a six-terminal 3 × 2 grid;
new tabs start with one fresh terminal. The renderer keeps one
`xterm` instance per runtime terminal identity in a plain Map outside React. Switching sessions
or tabs re-parents terminal containers rather than disposing them, so each process, its scrollback
and its cursor position survive. Unvisited persisted tabs create their PTYs lazily; the PTYs
themselves do not survive application restart.

The workspace is stored as `workspace.json` with separate `projects` and `sessions` arrays. Session
array order is the persistent sidebar order within each project; tab names, order, active tab, pane
order, layouts and resize ratios are stored inside each session. Legacy sessions without tab data
are normalized to a single `Tab 1` on load.

The Settings dialog's Terminal section controls terminal behavior, including whether Escape exits
the temporary fullscreen view; it is enabled by default. Ctrl+Shift+F toggles fullscreen for the
focused terminal pane. The Sidebar section controls the individual
entries shown beneath each session. Ordinary terminal instances are hidden by default, while
OpenCode instances are shown by default; these preferences are global and stored with the local
terminal settings.

Terminal clipboard shortcuts use the host Windows clipboard, including for WSL sessions. `Ctrl+C`
copies selected terminal text and remains the normal interrupt when there is no selection;
`Ctrl+Shift+C`, `Ctrl+Insert`, `Ctrl+V`, `Ctrl+Shift+V`, and `Shift+Insert` are also supported.
On macOS, use the corresponding `Command` shortcuts. OSC 52 clipboard sequences are accepted, so
copying a selection from the OpenCode TUI updates the system clipboard even while its mouse mode
is enabled.

### WSL

- Short-lived `wsl.exe` queries and path conversions go through `runWsl()` in
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
- OpenCode TUI status is optional and disabled by default for WSL terminal sessions. Open Terminal
  settings, enable global status reporting, and install MDE's small plugin in each WSL distro
  where it is needed;
  restart OpenCode after installing or updating it. The plugin is inert outside MDE terminals,
  writes only a short runtime snapshot under `/tmp`, and does not modify project files or
  OpenCode configuration. MDE reads that snapshot through the distro's `\\wsl.localhost\\...`
  path and falls back to normal shell status when it is absent. Each terminal pane with a live
  OpenCode TUI appears in the OpenCode instance list beneath its MDE session when that sidebar
  preference is enabled. Instance labels can
  use privacy-safe numbering or the current top-level OpenCode session title; prompts, messages,
  tool data, credentials, and filesystem contents are never included in the snapshot.
- OpenCode TUI token-rate display is a separate plugin from status reporting. On Linux it can be
  installed for the native OpenCode target; on Windows it can be installed independently for each
  WSL 2 distro. It adds a live estimated rate and a final provider-reported rate beside the TUI
  prompt. Restart OpenCode after installing, updating, or removing it. MDE does not emit a
  token-rate fallback when the target OpenCode version does not support TUI plugins.
- Session paths are stored in the target's own format. `wslpath` is used only at the UI
  boundary — when the Windows folder picker returns a `\\wsl$\` / `\\wsl.localhost\` UNC path
  or a drive path, and when revealing a folder in Explorer.
- A session whose files sit under `/mnt/c` gets an inline warning about 9p performance. It is
  a warning, not a block.

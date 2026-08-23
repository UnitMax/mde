# mde

Cross-platform desktop shell for an agentic dev environment: grouped projects containing
persistent terminal sessions, with first-class WSL support on Windows.

This is v1 — a desktop shell focused on persistent terminal workflows. Optional OpenCode TUI
plugins provide status, alerts, instance labels, and token-rate information without replacing
the terminal experience.

## Requirements

- Node 20+
- Windows 10/11, or Linux (X11 or Wayland)
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
npm run build:win         # NSIS installer + portable exe -> dist/mde-<version>-setup.exe, dist/mde <version>.exe
npm run build:win:portable  # portable exe only
npm run build:linux       # AppImage + deb  -> dist/mde-<version>.AppImage, .deb
```

Cross-building for Windows from Linux is not supported here; build it on Windows. If you develop
in WSL, `npm run build:win:remote` automates this: it rsyncs the repo to `C:\dev\mde-winbuild`
and runs the portable build using native Windows npm/node, so `node-pty` gets rebuilt with the
Windows toolchain when dependencies change. The first build runs `npm ci`; later builds reuse the
Windows `node_modules` directory until the dependency or native build inputs change. To force a
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

Packaged installers include MDE's MIT license and third-party notices alongside Electron's
and Chromium's generated legal files. OpenCode is an external executable and is not
bundled or relicensed by MDE.

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
override. `src/renderer/terminal/sessions.ts` keeps one `xterm` instance per session id in a
plain Map, outside React. Selecting a different session re-parents that terminal's container
element rather than disposing it, so the process, its scrollback and its cursor position all
survive. The PTY itself lives in the main process and is never touched by a session switch —
only by removing the session/project, restarting explicitly, or quitting.

The workspace is stored as `workspace.json` with separate `projects` and `sessions` arrays. Session
array order is the persistent sidebar order within each project. This early POC intentionally
starts with an empty workspace if only the previous flat project store is present; no migration is
attempted.

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
- The per-terminal Open in VS Code button follows the terminal's current directory. It starts
  out pointing at the session's configured path, and supported shells then correct it at every
  prompt by reporting their working directory through OSC 7. MDE installs process-local
  prompt hooks for Bash, Zsh, and Fish; other custom shells need to emit OSC 7 themselves or that
  button keeps opening the configured path.
- OpenCode TUI status is optional and disabled by default for WSL terminal sessions. Open Terminal
  settings, enable global status reporting, and install MDE's small plugin in each WSL distro
  where it is needed;
  restart OpenCode after installing or updating it. The plugin is inert outside MDE terminals,
  writes only a short runtime snapshot under `/tmp`, and does not modify project files or
  OpenCode configuration. MDE reads that snapshot through the distro's `\\wsl.localhost\\...`
  path and falls back to normal shell status when it is absent. Each terminal pane with a live
  OpenCode TUI appears in a collapsible sidebar list beneath its MDE session. Instance labels can
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

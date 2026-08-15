# mde

Cross-platform desktop shell for an agentic dev environment: grouped projects containing
persistent terminal sessions, with first-class WSL support on Windows.

This is v1 — a desktop shell with OpenCode GUI integration. There are no git/PR features or
settings screen. OpenCode is an external executable and is launched in the target environment:
native sessions use the host OpenCode CLI, while Windows WSL sessions use the CLI installed in
their selected distro.

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
- OpenCode GUI sessions require OpenCode to be installed and authenticated in the target
  environment. For WSL sessions, install it inside the selected WSL 2 distro and ensure it is
  available from a login Bash shell (`bash -lic 'command -v opencode'`).

## Development

```sh
npm install     # also runs electron-rebuild for node-pty
npm run dev     # electron-vite dev server + Electron
npm test        # unit tests for the pure launch/path/parse/validation functions
npm run typecheck
```

## Packaging

```sh
npm run build          # typecheck, bundle, then package for the current platform
npm run build:win      # NSIS installer  -> dist/mde-<version>-setup.exe
npm run build:linux    # AppImage + deb  -> dist/mde-<version>.AppImage, .deb
```

Cross-building the Windows installer from Linux is not supported here; build it on Windows.

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
and Chromium's generated legal files. OpenCode is an external executable/service and is not
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

The workspace is stored as `workspace.json` with separate `projects` and `sessions` arrays. This
early POC intentionally starts with an empty workspace if only the previous flat project store is
present; no migration is attempted.

### WSL

- Short-lived `wsl.exe` queries and path conversions go through `runWsl()` in
  `src/main/wsl/distros.ts`, which sets `WSL_UTF8=1`. The long-lived OpenCode server is spawned
  directly so MDE can keep its process and event stream attached.
- WSL sessions launch as
  `wsl.exe -d <distro> --cd <path> -- bash -lic 'exec bash -i'`. The login+interactive shell
  is required: nvm/mise/bun/asdf put their shims on `PATH` from the login profile.
- OpenCode GUI sessions use the same WSL boundary: MDE starts
  `opencode serve --pure --hostname=<wsl-ip> --port=0` inside the selected distro. MDE resolves
  `<wsl-ip>` with `hostname -I` and uses it for the Windows-side HTTP/SSE connection instead of
  assuming WSL localhost forwarding. WSL OpenCode uses the distro's own installation,
  credentials, configuration, and filesystem paths.
- Session paths are stored in the target's own format. `wslpath` is used only at the UI
  boundary — when the Windows folder picker returns a `\\wsl$\` / `\\wsl.localhost\` UNC path
  or a drive path, and when revealing a folder in Explorer.
- A session whose files sit under `/mnt/c` gets an inline warning about 9p performance. It is
  a warning, not a block.

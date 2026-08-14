# mde

Cross-platform desktop shell for an agentic dev environment: a project sidebar and one
persistent terminal per project, with first-class WSL support on Windows.

This is v1 — the shell only. There is no OpenCode integration, no git/PR features, and no
settings screen. The launch command lives in a single pure function
(`src/main/pty/launch.ts`) so OpenCode can be slotted in later without touching anything else.

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

## Architecture

```
src/
  main/      owns every node-pty instance, all filesystem access, all wsl.exe invocation
  preload/   contextBridge only — contextIsolation on, nodeIntegration off, sandbox on
  renderer/  React UI with no Node access whatsoever
  shared/    IPC channel names + payload types, imported by both sides so they cannot drift
```

### Terminal sessions

`src/renderer/terminal/sessions.ts` keeps one `xterm` instance per project id in a plain Map,
outside React. Selecting a different project re-parents that terminal's container element
rather than disposing it, so the process, its scrollback and its cursor position all survive.
The PTY itself lives in the main process and is never touched by a project switch — only by
removing the project, restarting explicitly, or quitting.

### WSL

- Every `wsl.exe` invocation goes through `runWsl()` in `src/main/wsl/distros.ts`, which sets
  `WSL_UTF8=1`. Without it `wsl.exe` emits UTF-16LE and every string comparison downstream
  silently fails.
- WSL projects launch as
  `wsl.exe -d <distro> --cd <path> -- bash -lic 'exec bash -i'`. The login+interactive shell
  is required: nvm/mise/bun/asdf put their shims on `PATH` from the login profile.
- Project paths are stored in the target's own format. `wslpath` is used only at the UI
  boundary — when the Windows folder picker returns a `\\wsl$\` / `\\wsl.localhost\` UNC path
  or a drive path, and when revealing a folder in Explorer.
- A project whose files sit under `/mnt/c` gets an inline warning about 9p performance. It is
  a warning, not a block.

---
name: run-mde
description: Build, launch, and drive the mde Electron app. Use when asked to run or start mde, screenshot its UI, or confirm a change works in the real app — especially anything touching the terminal, PTY lifecycle, or the project sidebar.
---

mde is an Electron desktop app, so "does it work" cannot be answered from the
test suite. Drive it through the Playwright REPL at `driver.mjs`, or run the
full behavioural suite in `verify.mjs`.

All paths are relative to the repo root.

## Scope — read this before trusting a green run

**Both scripts are Linux-only, and they exercise only `kind: 'native'`
projects.** `verify.mjs` counts shells with `ps` via bash; `driver.mjs` reads
`/dev/stdin`. Neither runs on Windows.

That means the WSL paths — distro enumeration, `wslpath`, validating a folder
inside a distro, and the `wsl.exe -d <distro> --cd <path> -- bash -lic` launch —
are **not covered here at all**, and those are the parts most worth covering.
They need a Windows host and a suite that speaks PowerShell and `tasklist`.
The pure functions behind them are covered by `npm test`; the runtime is not.

A green run here says the app's terminal plumbing works on Linux. It says
nothing about Windows.

## Prerequisites

```sh
npm install     # postinstall rebuilds node-pty against the Electron ABI
```

Linux also needs the Chromium shared libraries, or the Electron binary dies with
`error while loading shared libraries: libnspr4.so`:

```sh
sudo apt-get install -y libnss3 libnspr4 libasound2t64
```

If `node_modules/electron/dist/` is missing after `npm install`, Electron's own
postinstall did not run — fetch the binary directly:

```sh
node node_modules/electron/install.js
```

A display is required. This repo is developed under WSL2, where WSLg provides
one; no xvfb needed. On a headless box, prefix commands with `xvfb-run -a`.

## Build first

```sh
npx electron-vite build          # out/ — what driver.mjs and verify.mjs load
npm run build                    # adds electron-builder output in dist/
```

Neither script rebuilds for you. A stale `out/` is the usual reason a change
"didn't take".

## Run the behavioural suite

```sh
node .claude/skills/run-mde/verify.mjs              # against out/
node .claude/skills/run-mde/verify.mjs --packaged   # against dist/linux-unpacked
```

13 checks covering PTY survival across project switches, TUI rendering and
arrow keys, Ctrl-C, resize reflow, the exit banner, restart, persistence across
an app restart, PTY teardown on remove, and orphaned processes after quit.
Exits non-zero on failure and prints a screenshot directory.

The `--packaged` run is the one that catches `node-pty` failing to load out of
`app.asar` — a class of bug that never shows up in the dev tree.

## Drive it interactively

```sh
node .claude/skills/run-mde/driver.mjs
```

Or under tmux, which is how an agent should use it:

```sh
tmux new-session -d -s mde -x 200 -y 50
tmux send-keys -t mde 'cd /home/max/dev/mde && node .claude/skills/run-mde/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t mde -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t mde 'launch fresh' Enter
timeout 60 bash -c 'until tmux capture-pane -t mde -p | grep -q "launched"; do sleep 0.2; done'
tmux send-keys -t mde 'new-project /tmp/demo' Enter
tmux capture-pane -t mde -p
```

Commands are serialised, so piping a script into stdin also works.

### Commands

| command | what it does |
|---|---|
| `launch [fresh]` | start the app; `fresh` wipes the driver profile first |
| `new-project <abs-path> [name]` | open the dialog, fill it, wait for validation, create |
| `select <name>` | click a sidebar row (this is what creates its PTY) |
| `term <command>` | type into the focused terminal and press Enter |
| `type <text>` / `keys <Key>` | raw keyboard, e.g. `keys ArrowDown`, `keys Control+c` |
| `resize <w> <h>` | resize the window — exercises the debounced fit + PTY resize |
| `rows` | sidebar rows with status-dot colour and selection |
| `renderer` | whether WebGL or the DOM renderer activated |
| `menu <name>` | open a row's context menu (Rename / Reveal / Remove) |
| `ss [name]` | screenshot to `$SCREENSHOT_DIR` (default `/tmp/mde-shots`) |
| `text [sel]` / `eval <js>` / `click-text <text>` | generic DOM access |
| `quit` | close the app and exit |

Both scripts launch with a throwaway `--user-data-dir`, so they never touch the
real `projects.json`. Override with `MDE_USER_DATA`.

## Gotchas

- **No project is selected at launch, by design.** A PTY is created on first
  view of a project, so until you `select` one there is no terminal and no
  shell process. A screenshot taken before that shows the empty state, which is
  correct, not a failure to launch.
- **WebGL2 is unavailable under WSLg.** The app catches it and falls back to
  xterm's DOM renderer — expected behaviour, and it means the WebGL path is
  *not* exercised here. `renderer` reports which one is live: `webglCanvases: 0,
  domRows: N` is the fallback.
- **vim restores the cursor line from viminfo.** If you measure cursor movement
  across runs, launch it as `vim -i NONE +1 <file>` or the starting line is
  whatever the previous run left behind. This produced a false failure once.
- **Reading terminal text from the DOM only works on the DOM renderer.** Under
  WebGL the rows are painted to a canvas. Assert on side effects instead —
  write a file from the shell and read it from Node, which is what `verify.mjs`
  does throughout.
- **WSL projects cannot be exercised on Linux.** `kind: 'wsl'` is a Windows-only
  path; `buildLaunchSpec` throws off Windows by design. See Scope above.
- **The sidebar is addressed through `data-testid`,** not styling classes:
  `project-row`, `project-name`, and `project-status` (which also carries
  `data-status="none|running|exited"`). Keep those attributes when restyling —
  hooking Tailwind utilities instead makes a restyle look like a regression.

## Troubleshooting

- **Launch timeout** — `out/` missing or stale. Run `npx electron-vite build`.
- **`libnspr4.so` missing** — install the packages under Prerequisites.
- **`Electron uninstall`** — `node node_modules/electron/install.js`.
- **Driver hangs after `new-project`** — the path did not validate. The command
  prints the dialog's inline validation text on timeout; check the folder exists.

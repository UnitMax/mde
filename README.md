# mde

Cross-platform desktop shell for an agentic dev environment: named, persistent terminal
sessions, with first-class WSL support on Windows.

It is a desktop shell focused on persistent terminal workflows: tabbed multi-pane terminals per
session, Git changes in each terminal header, a file tree that follows the selected terminal,
Markdown and Mermaid preview, and To Do boards. The Inbox is a separate
view for starting and continuing OpenCode conversations in GUI chat or a direct OpenCode terminal;
both use OpenCode's API for thread activity. Choose GUI (the default) or Terminal from the menu under the new-thread message box.
Add, rename, remove and give icons to the folders threads start in from Projects (the folder button
beside the Inbox settings); the icon shows beside each project's threads. On macOS and in WSL,
Settings → OpenCode → Edit configuration changes OpenCode's own configuration file: permission rules,
custom OpenAI-compatible providers and disabled providers. See
[`docs/architecture.md`](docs/architecture.md) for how each part behaves.

Settings → Notifications plays a sound and flashes the taskbar button when an Inbox thread is done, needs
input or fails; on Windows the button is also coloured red, yellow or green with a count until you return.
It needs nothing installed.

The Inbox terminal can also float as a window over the conversation: use the button beside Collapse sidebar on
the Terminal tab, then F11 shows and hides it. It can be moved, resized from every edge, maximized, and put back.

On Windows, choose the Inbox sidebar terminal's WSL distribution from Settings → Terminal →
Inbox sidebar terminal. Apply restarts its panes when the distribution changes; the choice is remembered.

Build terminal layouts by holding Ctrl and clicking + on a pane’s left, right, top or bottom edge.
Drag dividers to resize; closing a pane expands its sibling and preserves the rest of the layout.
Select a terminal to browse its current folder in Files. Its terminal header shows the current
branch and change counts. Sessions group terminals by name and environment;
the Sessions sidebar shows each session’s runtime and WSL distribution below its name. Create a
session with a name and environment, then drag its sidebar handle to reorder it. Each terminal
remembers its own last reported folder across app restarts. Restored shells fall back
to the user’s home directory if their saved folder is unavailable.

## Removing the old OpenCode plugin

Close MDE and OpenCode, then delete `~/.config/opencode/plugins/mde-status/` and
the older `~/.config/opencode/plugins/mde-status.js`, if present. On macOS, use
`$OPENCODE_CONFIG_DIR/plugins/` if configured, otherwise `$XDG_CONFIG_HOME/opencode/plugins/`
if configured. On Windows, repeat inside each WSL distro where you installed the plugin.
Restart MDE and OpenCode afterward.

## Requirements

- Node 22.22.2+, or Node 24.15+ (the locked test dependencies require these versions)
- Windows 11, or Windows 10 version 1903 (build 18362) or newer, or Linux (X11 or Wayland)
  or macOS on Apple Silicon
  - Packaged Windows builds ship only `node-pty`'s ConPTY backend; the winpty fallback
    older releases would need is deliberately excluded.
- A C/C++ toolchain, because `node-pty` is a native module and is rebuilt against the
  Electron ABI by `@electron/rebuild` from `postinstall`:
  - Windows: Visual Studio Build Tools with the "Desktop development with C++" workload
  - Debian/Ubuntu: `build-essential python3`
  - macOS: Xcode Command Line Tools (`xcode-select --install`) and Python 3
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

Contributor rules (code style, versioning, commit checks) are in [`AGENTS.md`](AGENTS.md).

## Packaging

```sh
npm run build             # license check, typecheck, bundle, package, then audit the output
npm run build:win         # Windows ZIP    -> dist/mde-<version>-win.zip
npm run build:win:dir     # Windows app    -> dist/win-unpacked/mde.exe (no ZIP)
npm run build:mac         # macOS ARM64 DMG -> dist/mde-<version>-arm64.dmg (never publishes)
npm run build:linux       # AppImage + deb  -> dist/mde-<version>.AppImage, .deb
# On macOS, npm run build produces a local ARM64 app, DMG + ZIP.
```

Mac builds place the app in `dist/mac-arm64/mde.app` and use an explicit ad-hoc
signature for local builds. Distribution with Developer ID signing and
notarization requires overriding `mac.identity` and supplying release credentials
and configuration. The Mac
package includes only the rebuilt PTY binding and spawn helper outside `app.asar`,
with compiler debug paths stripped before signing. Native Mac terminals support
the F12 mini Inbox window.
WSL-specific actions remain Windows-only.

Cross-building for Windows from Linux is not supported; build on Windows, or from WSL with
`npm run build:win:remote` (add `-- --dir` to skip the ZIP while testing locally). Release steps,
the Windows staging details and verification are in
[`docs/windows-release.md`](docs/windows-release.md).

### Checks and release builds with GitHub Actions

The [CI workflow](.github/workflows/ci.yml) runs on every push and pull request: license
notices, typecheck and the test suite on Linux, the test suite on native Windows, and the
dependency audit as its own job. It builds nothing.

The [Build release draft workflow](.github/workflows/build-release.yml) is started by hand
and builds a release from the head of the default branch. It reads the version from
`package.json`, checks that `package-lock.json` (both fields) agrees and that the tag
`v<version>` is free, then builds Windows x64 on `windows-2025` and macOS ARM64 on `macos-15`
in parallel, using Node 24.21.0 and locked dependencies. Both jobs run the full test suite,
dependency audit, license checks, typechecking, compilation, packaging, and packaged-output
audit. Windows uses the existing `node-pty` prebuilds; macOS rebuilds the native module.
Packaging explicitly disables publishing.

The macOS job verifies the app signature, architecture, and disk image. The Windows
job extracts the ZIP, checks its required runtime files, and compares every file
against the audited unpacked package. Both produce SHA-256 checksums and upload
Actions artifacts retained for three days. A failed check prevents that job's upload.

For each release:

1. Merge the work to the default branch. The version in `package.json` and both version
   fields in `package-lock.json` change only for a release, in one commit, for example:

   ```sh
   npm version 0.1.15 --no-git-tag-version
   ```

2. Open **Actions → Build release draft → Run workflow** on the default branch. Nothing
   needs tagging by hand.
3. Check that all jobs succeed. After both builds pass, the final job creates the tag
   `v<version>` on the commit that was built, verifies the downloaded checksums and
   creates a draft GitHub Release for it, attaching the Windows ZIP, macOS DMG, both
   checksums, `LICENSE`, and `THIRD_PARTY_NOTICES.md`.
4. Open the draft under **Releases**, review the files and release notes, and test
   the extracted Windows ZIP as described in [`docs/windows-release.md`](docs/windows-release.md).
   Publish the release manually when ready. For Windows, extract the entire ZIP
   into its own folder and run `mde.exe`. For macOS, mount the DMG and drag MDE into
   Applications.

The workflow refuses to run on any other branch. It fails before building when the version
was already published, when its tag exists on a different commit, or when the three version
fields disagree. Raise the version for a new release; to rebuild one that is still a draft,
run the workflow again: it reuses the draft, replaces matching assets and keeps its release
notes. A published release is never modified. Runs share one concurrency group and each
platform build has a 30-minute timeout. The workflow file must be on the default branch
for **Run workflow** to appear. Tags made before this process (`0.0.x`, no `v`) stay as
they are.

The workflow uses pinned GitHub actions and read-only repository permissions for
builds. Only the final draft-release job receives `contents: write` and `actions: read`,
using the built-in `GITHUB_TOKEN`; no additional secret is needed. It never bumps
versions or publishes a release. Builds need no signing secrets: Windows remains
unsigned and macOS uses the existing ad-hoc signature without Developer ID signing
or notarization. Tests use fixtures and do not submit OpenCode prompts or invoke
models. Local `npm run build` on macOS still produces both DMG and ZIP.

## Licensing

MDE's first-party source, documentation, scripts, and branding are licensed under the MIT
License in `LICENSE`. Third-party packages remain under their own licenses; the complete
locked dependency inventory and available package license/notice text are recorded in
`THIRD_PARTY_NOTICES.md`. The same file credits the color themes that adapt other projects' palettes
(Catppuccin, GitHub Primer, Solarized, Gruvbox, Tokyo Night, Dracula, Nord and One Dark, all MIT) and
reproduces their license texts.

Regenerate the notices after changing dependencies with:

```sh
npm run licenses
npm run licenses:check
```

Packaged builds include MDE's MIT license and third-party notices alongside Electron's
and Chromium's generated legal files. OpenCode is an external executable and is not
bundled or relicensed by MDE.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — process boundaries, sessions, WSL, Git, OpenCode
  integration, and upgrade notes
- [`docs/security.md`](docs/security.md) — IPC boundary and dependency security maintenance
- [`docs/windows-release.md`](docs/windows-release.md) — Windows build, verification and publishing
- [`PRIVACY.md`](PRIVACY.md) — local data and network behavior
- [`AGENTS.md`](AGENTS.md) — repository guidelines for contributors and coding agents

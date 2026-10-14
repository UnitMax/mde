# mde

Cross-platform desktop shell for an agentic dev environment: grouped projects containing
persistent terminal sessions, with first-class WSL support on Windows.

It is a desktop shell focused on persistent terminal workflows: tabbed multi-pane terminals per
session, Git status in the sidebar, a file tree with Markdown and Mermaid preview, an OpenCode
session picker, and To Do boards. Optional OpenCode TUI plugins provide agent status, alerts,
instance labels, and token-rate information without replacing the terminal experience. See
[`docs/architecture.md`](docs/architecture.md) for how each part behaves.

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
the agent launcher, OpenCode history/resume, status reporting, Agents overview,
Dock attention and sound, and token-rate display. Enable status reporting and
install the optional plugins under Settings → OpenCode, then restart OpenCode.
Mac plugin management resolves the config directory and executable environment
through the user’s login shell, including when MDE is launched from Finder.
WSL-specific actions remain Windows-only.

Cross-building for Windows from Linux is not supported; build on Windows, or from WSL with
`npm run build:win:remote` (add `-- --dir` to skip the ZIP while testing locally). Release steps,
the Windows staging details and verification are in
[`docs/windows-release.md`](docs/windows-release.md).

### macOS builds with GitHub Actions

The [Build macOS DMG workflow](.github/workflows/build-macos.yml) runs when a version
tag such as `0.0.117` is pushed; `v`-prefixed tags are also accepted. It uses the
standard ARM64 `macos-15` runner and Node 24.21.0, installs the locked dependencies
with `npm ci` (including the native PTY rebuild),
and runs the full test suite and dependency audit. `npm run build:mac` then checks
licenses, typechecks, compiles, packages an ARM64 DMG, and audits the output. The
workflow verifies the app's signature, architecture, and disk image before
uploading the DMG and a `.dmg.sha256` checksum. A failed check prevents upload.

For each release:

1. Prepare and commit the release version in `package.json` and both version
   fields in `package-lock.json`, then push the commit. The workflow must already
   be on the default branch to support manual runs.
2. Push the matching version tag from that commit. For example:

   ```sh
   version=$(node -p "require('./package.json').version")
   git tag -a "$version" -m "$version"
   git push origin "refs/tags/$version"
   ```

3. Open **Actions → Build macOS DMG**, select the successful run, and download
   `mde-<version>-macos-arm64` from **Artifacts** within three days. Extract the
   download archive to get the DMG and checksum. In that directory, verify with
   `shasum -a 256 -c mde-<version>-arm64.dmg.sha256` (replace `<version>`).
4. Manually create a GitHub Release using that existing tag and attach the DMG
   and checksum. Only the DMG is needed to install: mount it and drag MDE into
   Applications. A separate app ZIP offers the same app and is unnecessary here.

The tag, with an optional `v` prefix removed, must exactly match all three manifest
version fields; mismatches fail before dependency installation. Ordinary branch
pushes do not build. To rebuild an existing tag, use **Run workflow** with the
required `tag` input on the default branch, or rerun its previous job if the
artifact has expired. The tag
must contain the `build:mac` command. Runs for the same tag share a concurrency
group, and each build has a 30-minute timeout.

The workflow has read-only repository permissions and pinned GitHub actions. It
never bumps versions or creates, publishes, or changes a GitHub Release; packaging
explicitly disables publishing. It needs no signing secrets and uses the existing
ad-hoc app signature, without Developer ID signing or notarization. Tests use
fixtures and do not submit OpenCode prompts or invoke models. Local
`npm run build` still produces both DMG and ZIP.

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

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — process boundaries, sessions, WSL, Git, OpenCode
  integration, and upgrade notes
- [`docs/security.md`](docs/security.md) — IPC boundary and dependency security maintenance
- [`docs/windows-release.md`](docs/windows-release.md) — Windows build, verification and publishing
- [`PRIVACY.md`](PRIVACY.md) — local data and network behavior
- [`AGENTS.md`](AGENTS.md) — repository guidelines for contributors and coding agents

# Windows release checklist

MDE's Windows release is built from WSL with native Windows Node.js so the
packaged application contains the correct Windows `node-pty` prebuilds. Cross-building
from Linux is not supported; on native Windows, run `npm run build:win` directly.

## Build prerequisites

Node.js and Visual Studio Build Tools ("Desktop development with C++") must be installed on
Windows first (see Requirements in the README).

`npm run build:win:remote` rsyncs the repository to a staging directory under the Windows
temporary directory and runs the build there using native Windows npm/node with `node-pty`'s
Windows x64 prebuilt runtime. Set `MDE_WINDOWS_BUILD_DIR` to a Windows-format path to override
the staging directory. The staging `dist` is emptied before each run, so it only ever holds the
artifacts of the build you just made. The first build runs `npm ci`; later builds reuse the
Windows `node_modules` directory until the dependency or native build inputs change.

## Prepare the release

1. Close every running packaged MDE instance. Windows keeps Electron DLLs open
   and electron-builder cannot replace `dist/win-unpacked` while they are in use.
2. Update `package.json` and `package-lock.json` to the same release version.
3. Run `npm run audit:deps` against the full lockfile and resolve or document any
   advisories (see [`security.md`](security.md)).
4. Refresh and review the generated notices:

   ```bash
   npm run licenses
   git diff -- THIRD_PARTY_NOTICES.md
   ```

5. Run the release checks and build:

   ```bash
   npm test
   npm run typecheck
   npm run licenses:check
   npm run build:win:remote
   ```

The remote build reuses Windows dependencies when their fingerprint matches and
the required package files are present. It reinstalls them if Vite's build or
client entries are missing. To repair other damage to the cached installation,
run `npm run build:win:remote -- --force-deps` to force a clean `npm ci`.

The build produces exactly one artifact, `dist/mde-<version>-win.zip`, from the
`dist/win-unpacked` tree beside it. The staging `dist` is emptied first, so
nothing from an earlier build survives to be mistaken for this one. The command
runs the license and type checks again, packages the application, deletes
electron-builder metadata dumps containing absolute paths, scans every remaining
artifact for the build user's Linux, WSL, and Windows profile paths, and fails if
an unpacked file the package is not meant to ship is present:
electron-builder's `elevate.exe`, or `node-pty`'s `winpty-agent.exe` and
`winpty.dll`. The only unpacked `node-pty` files allowed are `conpty.node`,
`conpty.dll`, and `OpenConsole.exe`; its JavaScript stays in integrity-checked
`app.asar`. A nonzero exit code means the artifacts must not be published.

There is deliberately no installer and no portable executable. A portable NSIS
build re-extracts the whole application into `%TEMP%` and runs it from there on
every launch, which is the generic pattern behavioral heuristics are written
against, and an unsigned installer buys back little of that. A ZIP has no
self-extracting stub at all.

## Local testing without a ZIP

For local testing, close every packaged MDE instance using the staging directory,
then run:

```bash
npm run build:win:remote -- --dir
```

This creates only `dist/win-unpacked`, skipping ZIP compression while retaining
the license checks, type checks, application compilation, and package audit.
After the audit succeeds, the command prints the Windows path to `mde.exe`.
The staging `dist` is still emptied first, including any ZIP from an earlier run.

To also reinstall the cached Windows dependencies, add `--force-deps`; the flags
can appear in either order. On native Windows, use `npm run build:win:dir`.
For a release, use the default ZIP build and verify the extracted archive below.

## Verify Windows behavior

Extract `dist\mde-<version>-win.zip` into an empty folder and run `mde.exe` from
there. Testing the extracted archive rather than `dist\win-unpacked` in place is
deliberate: it is exactly what a user does, and it confirms the archive extracts
into something that runs.

Open both a PowerShell and WSL terminal, type a command, resize the window, and
close each terminal. This exercises the unpacked `node-pty` native module and the
bundled ConPTY files. Packaged builds carry no winpty fallback, so a terminal that
opens here proves the ConPTY path works on its own.

MDE does not fall back to Windows' inbox ConPTY when the bundled component cannot
start. A damaged or incomplete release therefore leaves its terminal unavailable;
re-extract a fresh release rather than attempting to bypass that protection.

Confirm the packaged binary was hardened, from the build directory:

```powershell
npx electron-fuses read --app '.\dist\win-unpacked\mde.exe'
```

The listing must show `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, and
`EnableNodeCliInspectArguments` disabled, with `EnableCookieEncryption`,
`EnableEmbeddedAsarIntegrityValidation`, and `OnlyLoadAppFromAsar` enabled. If the
application refuses to start at all, suspect
`enableEmbeddedAsarIntegrityValidation` in `electron-builder.yml` first; the other
fuses cannot prevent startup.

Optionally verify the executable's signature in PowerShell:

```powershell
Get-AuthenticodeSignature '<extracted-folder>\mde.exe'
```

Releases are not code signed, so this reports `NotSigned`. Unsigned builds work
but commonly trigger Microsoft Defender SmartScreen.

## Publish

Upload these three files to the matching GitHub release:

- `mde-<version>-win.zip`
- the repository `LICENSE`
- the generated `THIRD_PARTY_NOTICES.md`

Tell users to extract the archive into its own folder and run `mde.exe` from
there. Like Electron's and VS Code's Windows archives, this ZIP is flat: it has no
top-level directory, so extracting it in place scatters the application across the
current folder. Windows Explorer's "Extract All" and 7-Zip's "Extract to
<name>\" both create the folder by default. `mde.exe` cannot be run from inside
the archive.

Both notice files also ship inside the archive under `resources\`. Publishing
them beside it makes the licensing terms readable without downloading and
extracting the application. Do not upload `builder-debug.yml`,
`builder-effective-config.yaml`, an older artifact left in `dist`, or anything
from a build whose package audit failed.

## Known gaps

Closing MDE with several terminals running can trigger the native
`remove_pty_baton(baton->id)` assertion in `node-pty` 1.1.0's Windows ConPTY
cleanup. This strongly matches the upstream terminal-handle race tracked in
[node-pty issue #921](https://github.com/microsoft/node-pty/issues/921) and fixed
by [PR #922](https://github.com/microsoft/node-pty/pull/922). The fix is currently
available in the 1.2 beta releases. Keep the stable dependency for now; update
`node-pty` once a stable release includes this fix, refresh the lockfile and
third-party notices, and run the dependency audit. After upgrading, verify
repeated application shutdown with several PowerShell and WSL terminals running,
including panes in other tabs and sessions, using the extracted Windows ZIP.

Releases are unsigned, and no checksum file is published alongside them, so a user
who receives a modified archive has no way to detect it. The `OriginalFilename`
field of `mde.exe`'s version resource is also empty; electron-builder writes it
that way and setting it would mean rewriting the binary after its fuses and asar
integrity resource are already stamped. Both are accepted for now.

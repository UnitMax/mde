# Windows release checklist

MDE's Windows release is built from WSL with native Windows Node.js so the
packaged application contains the correct Windows `node-pty` prebuilds.

## Prepare the release

1. Close every running packaged MDE instance. Windows keeps Electron DLLs open
   and electron-builder cannot replace `dist/win-unpacked` while they are in use.
2. Update `package.json` and `package-lock.json` to the same release version.
3. Refresh and review the generated notices:

   ```bash
   npm run licenses
   git diff -- THIRD_PARTY_NOTICES.md
   ```

4. Run the release checks and build:

   ```bash
   npm test
   npm run typecheck
   npm run licenses:check
   npm run build:win:remote
   ```

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

Releases are unsigned, and no checksum file is published alongside them, so a user
who receives a modified archive has no way to detect it. The `OriginalFilename`
field of `mde.exe`'s version resource is also empty; electron-builder writes it
that way and setting it would mean rewriting the binary after its fuses and asar
integrity resource are already stamped. Both are accepted for now.

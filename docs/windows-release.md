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

The build command runs the license and type checks again, packages the portable
application, deletes electron-builder metadata dumps containing absolute paths,
and scans every remaining artifact for the build user's Linux, WSL, and Windows
profile paths. A nonzero exit code means the artifacts must not be published.

## Verify Windows behavior

Run `C:\dev\mde-winbuild\dist\mde-<version>-portable.exe` on Windows. Open both
a PowerShell and WSL terminal, type a command, resize the window, and close each
terminal. This exercises the unpacked `node-pty` native module and bundled
ConPTY files.

Optionally verify the executable's signature in PowerShell:

```powershell
Get-AuthenticodeSignature C:\dev\mde-winbuild\dist\mde-<version>-portable.exe
```

Unsigned builds work but commonly trigger Microsoft Defender SmartScreen.

## Publish

For the smallest public release, upload these three files to the matching
GitHub release:

- `mde-<version>-portable.exe`
- the repository `LICENSE`
- the generated `THIRD_PARTY_NOTICES.md`

The two notice files are also embedded in the portable executable. Publishing
them beside it makes the licensing terms available without running or
extracting the application. Do not upload `builder-debug.yml`,
`builder-effective-config.yaml`, an older executable left in `dist`, or any
artifact from a build whose package audit failed.

If an unpacked ZIP is desired instead, archive the complete contents of
`dist/win-unpacked`; `mde.exe` cannot run by itself. Include the repository
`LICENSE` and `THIRD_PARTY_NOTICES.md` beside that ZIP on the GitHub release.

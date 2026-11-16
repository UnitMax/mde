#!/usr/bin/env bash
# Syncs this repo to a Windows-side directory and runs the Windows build there
# using native Windows npm/node. Run from WSL:
# npm run build:win:remote
# npm run build:win:remote -- --dir
#
# By default, the build produces dist/mde-<version>-win.zip plus the
# dist/win-unpacked tree. --dir skips the ZIP for local testing.
# See docs/windows-release.md.
set -euo pipefail

REMOTE_BUILD_SCRIPT='build:win'
FORCE_DEPS=false
OFFLINE=false
for argument in "$@"; do
  case "$argument" in
    --dir) REMOTE_BUILD_SCRIPT='build:win:dir' ;;
    --force-deps) FORCE_DEPS=true ;;
    --offline) OFFLINE=true ;;
    *)
      echo "Usage: npm run build:win:remote -- [--dir] [--force-deps | --offline]" >&2
      exit 2
      ;;
  esac
done

if "$OFFLINE" && { "$FORCE_DEPS" || [[ "$REMOTE_BUILD_SCRIPT" != 'build:win:dir' ]]; }; then
  echo '--offline requires --dir and cannot be combined with --force-deps.' >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WINDOWS_TEMP_NATIVE="$(cd /mnt/c && cmd.exe /d /c 'echo %TEMP%' | tr -d '\r' | tail -n 1)"
WIN_DIR_NATIVE="${MDE_WINDOWS_BUILD_DIR:-${WINDOWS_TEMP_NATIVE}\\mde-winbuild}"
WIN_DIR="$(wslpath -u "$WIN_DIR_NATIVE")"
REMOTE_DEPS_COMMAND='node scripts/ensure-windows-dependencies.mjs'
if "$FORCE_DEPS"; then
  REMOTE_DEPS_COMMAND+=' --force'
fi
if "$OFFLINE"; then
  REMOTE_DEPS_COMMAND+=' --offline'
fi

# Both `rsync --delete` and the `rm -rf` below take this path as their target,
# so refuse to run at all rather than aim either of them at the filesystem root.
case "$WIN_DIR" in
  '' | '/' | '/mnt' | '/mnt/'*/ )
    echo "Refusing to stage into '$WIN_DIR'; check MDE_WINDOWS_BUILD_DIR." >&2
    exit 1
    ;;
esac

mkdir -p "$WIN_DIR"

# With the MDE MCP installed from this build, OpenCode runs `mde.exe --mcp-bridge`
# processes out of dist/win-unpacked. MDE stops them when it quits, but not when
# it crashed or was killed, and Windows refuses to delete a running mde.exe. Stop
# what is left, and say so: it should not happen after a normal quit. Only bridge
# processes started from this build's dist are touched, never a running MDE.
stop_leftover_bridges() {
  local dist="${WIN_DIR_NATIVE}\\dist\\"
  local pids pid count=0
  pids="$(cd /mnt/c && powershell.exe -NoProfile -NonInteractive -Command "
    \$dist = '${dist//\'/\'\'}'
    Get-CimInstance Win32_Process |
      Where-Object { \$_.ExecutablePath -and \$_.ExecutablePath.StartsWith(\$dist, [StringComparison]::OrdinalIgnoreCase) -and \$_.CommandLine -like '*--mcp-bridge*' } |
      ForEach-Object { \$_.ProcessId }" 2>/dev/null | tr -d '\r')" || return 0
  for pid in $pids; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    # /T takes the bridge's Chromium helper processes with it.
    if (cd /mnt/c && taskkill.exe /PID "$pid" /T /F >/dev/null 2>&1); then
      count=$((count + 1))
    fi
  done
  if ((count > 0)); then
    echo "Stopped ${count} leftover MDE MCP bridge process(es) running from ${dist}"
    echo "  (MDE did not quit cleanly, or OpenCode started them after it quit). The 'mde' MCP server now shows"
    echo "  as failed in OpenCode until MDE's Inbox MCP menu connects it or 'opencode service restart' runs."
    # Windows releases the executable a moment after the process is gone.
    sleep 1
  fi
}

rsync -a --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist*/' \
  --exclude='out/' \
  --exclude='.mde-windows-deps-fingerprint' \
  "$REPO_ROOT"/ "$WIN_DIR"/

# rsync must keep excluding dist: it runs with --delete, so syncing it would
# wipe the Windows artifacts and copy this machine's Linux ones over. That
# exclusion is also why old artifacts survive here, because electron-builder
# only overwrites files whose names collide. Empty the directory instead, so
# every run starts clean and `npm run audit:package` only ever sees the build
# it just made. Artifacts are reproducible; nothing here is worth keeping.
stop_leftover_bridges

rm -rf "$WIN_DIR/dist"

# cd into the Windows dir first so cmd.exe doesn't start from the \\wsl.localhost\...
# UNC path (which it can't use as a cwd and warns about, harmlessly, before the
# explicit `cd /d` below takes effect).
if "$OFFLINE"; then
  (cd "$WIN_DIR" && cmd.exe /c "cd /d ${WIN_DIR_NATIVE} && ${REMOTE_DEPS_COMMAND} && npm run licenses:check && npm run typecheck && npm run compile && node scripts/build-windows-offline.mjs && npm run audit:package")
else
  (cd "$WIN_DIR" && cmd.exe /c "cd /d ${WIN_DIR_NATIVE} && ${REMOTE_DEPS_COMMAND} && npm run ${REMOTE_BUILD_SCRIPT}")
fi

if [[ "$REMOTE_BUILD_SCRIPT" == 'build:win:dir' ]]; then
  echo "Unpacked app ready: ${WIN_DIR_NATIVE}\\dist\\win-unpacked\\mde.exe"
fi

echo "Build artifacts:"
ls -la "$WIN_DIR/dist"

#!/usr/bin/env bash
# Syncs this repo to a Windows-side directory and runs the portable Windows
# build there using native Windows npm/node, so node-pty gets rebuilt against
# the Windows toolchain when its dependencies change. Run from WSL:
# npm run build:win:remote
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_DIR="/mnt/c/dev/mde-winbuild"
WIN_DIR_NATIVE='C:\dev\mde-winbuild'
REMOTE_DEPS_COMMAND='node scripts/ensure-windows-dependencies.mjs'

case "${1:-}" in
  '') ;;
  --force-deps) REMOTE_DEPS_COMMAND+=' --force' ;;
  *)
    echo "Usage: npm run build:win:remote -- [--force-deps]" >&2
    exit 2
    ;;
esac

mkdir -p "$WIN_DIR"

rsync -a --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='out/' \
  --exclude='.mde-windows-deps-fingerprint' \
  "$REPO_ROOT"/ "$WIN_DIR"/

# cd into the Windows dir first so cmd.exe doesn't start from the \\wsl.localhost\...
# UNC path (which it can't use as a cwd and warns about, harmlessly, before the
# explicit `cd /d` below takes effect).
(cd "$WIN_DIR" && cmd.exe /c "cd /d ${WIN_DIR_NATIVE} && ${REMOTE_DEPS_COMMAND} && npm run build:win:portable")

echo "Build artifacts:"
ls -la "$WIN_DIR/dist"

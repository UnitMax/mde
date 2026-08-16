#!/usr/bin/env bash
# Syncs this repo to a Windows-side directory and runs the portable Windows
# build there using native Windows npm/node, so node-pty gets rebuilt against
# the Windows toolchain. Run from WSL: npm run build:win:remote
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_DIR="/mnt/c/dev/mde-winbuild"
WIN_DIR_NATIVE='C:\dev\mde-winbuild'

mkdir -p "$WIN_DIR"

rsync -a --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='out/' \
  "$REPO_ROOT"/ "$WIN_DIR"/

# cd into the Windows dir first so cmd.exe doesn't start from the \\wsl.localhost\...
# UNC path (which it can't use as a cwd and warns about, harmlessly, before the
# explicit `cd /d` below takes effect).
(cd "$WIN_DIR" && cmd.exe /c "cd /d ${WIN_DIR_NATIVE} && npm ci && npm run build:win:portable")

echo "Build artifacts:"
ls -la "$WIN_DIR/dist"

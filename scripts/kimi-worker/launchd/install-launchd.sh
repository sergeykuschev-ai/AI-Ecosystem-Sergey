#!/bin/bash
# Manual LaunchAgent installer for the Kimi worker. Run ONLY after reviewing
# the generated plist. The repo automation never invokes this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$REPO_ROOT" ]; then
  # The worker can live in a non-main worktree; fall back to the main clone.
  REPO_ROOT="$(git worktree list --porcelain | awk '/^worktree /{wt=$2} /^branch refs\/heads\/main$/{print wt; exit}')"
fi

if [ -z "$REPO_ROOT" ]; then
  echo "Could not determine the main repo path." >&2
  exit 1
fi

PLIST_TARGET="$HOME/Library/LaunchAgents/com.sergeykuschev.kimi-worker.plist"

echo "Repo root:  $REPO_ROOT"
echo "Installing: $PLIST_TARGET"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.kimi-worker-admin/AI-Ecosystem-Sergey/logs"

sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__HOME__|$HOME|g" \
  "$SCRIPT_DIR/com.sergeykuschev.kimi-worker.plist.template" > "$PLIST_TARGET"

echo
echo "Review the plist, then activate with:"
echo "  launchctl bootstrap gui/\$(id -u) $PLIST_TARGET"
echo "  launchctl kickstart gui/\$(id -u)/com.sergeykuschev.kimi-worker   # optional first run"
echo
echo "Deactivate with:"
echo "  launchctl bootout gui/\$(id -u)/com.sergeykuschev.kimi-worker"

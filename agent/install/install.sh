#!/usr/bin/env bash
# Install the RoutineCast launchd agent. Requires ROUTINECAST_API_URL and
# ROUTINECAST_API_TOKEN (same values as the cloud app).
set -euo pipefail

if [[ -z "${ROUTINECAST_API_URL:-}" || -z "${ROUTINECAST_API_TOKEN:-}" ]]; then
  echo "Set ROUTINECAST_API_URL and ROUTINECAST_API_TOKEN first." >&2
  echo "Example:" >&2
  echo "  ROUTINECAST_API_URL=https://your-app.onrender.com \\" >&2
  echo "  ROUTINECAST_API_TOKEN=... \\" >&2
  echo "  ./agent/install/install.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_PATH="$(cd "$SCRIPT_DIR/../.." && pwd)"
NODE_BIN="$(command -v node)"
HOME_DIR="${HOME}"
DEST="$HOME_DIR/Library/LaunchAgents/com.routinecast.agent.plist"
API_URL="${ROUTINECAST_API_URL%/}"

mkdir -p "$HOME_DIR/Library/LaunchAgents" "$HOME_DIR/Library/Logs"

sed \
  -e "s|__REPO_PATH__|${REPO_PATH}|g" \
  -e "s|__API_URL__|${API_URL}|g" \
  -e "s|__API_TOKEN__|${ROUTINECAST_API_TOKEN}|g" \
  -e "s|__HOME__|${HOME_DIR}|g" \
  -e "s|/opt/homebrew/bin/node|${NODE_BIN}|g" \
  "$SCRIPT_DIR/com.routinecast.agent.plist" > "$DEST"

launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST"
launchctl start com.routinecast.agent

echo "Installed $DEST"
echo "Logs: $HOME_DIR/Library/Logs/routinecast-agent.log"
echo "Wake the Mac before the daily build, e.g.:"
echo "  sudo pmset repeat wakeorpoweron MTWRFSU 05:30:00"

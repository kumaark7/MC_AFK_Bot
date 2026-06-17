#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$HOME/MC_AFK_Bot"

export UI_HOST="${UI_HOST:-127.0.0.1}"
export UI_PORT="${UI_PORT:-3000}"

mkdir -p logs

if command -v pgrep >/dev/null 2>&1 && pgrep -f "node bot.js" >/dev/null 2>&1; then
  echo "Bot service already running."
  exit 0
fi

nohup node bot.js >> logs/termux-bot.log 2>&1 &
echo "Bot service started on http://${UI_HOST}:${UI_PORT}"

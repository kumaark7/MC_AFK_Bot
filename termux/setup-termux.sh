#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

cd "$HOME/MC_AFK_Bot"

pkg update -y
pkg install -y nodejs git

npm install

mkdir -p "$HOME/.termux"
if [ ! -f "$HOME/.termux/termux.properties" ]; then
  touch "$HOME/.termux/termux.properties"
fi

if ! grep -q '^allow-external-apps *= *true' "$HOME/.termux/termux.properties"; then
  printf '\nallow-external-apps = true\n' >> "$HOME/.termux/termux.properties"
fi

chmod +x termux/start-bot.sh

echo "Termux setup done. Restart Termux once, then use Start Termux in Larry Control."

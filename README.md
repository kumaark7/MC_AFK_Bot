# AFK Bot

Multi-account Mineflayer AFK bot for `play.normalsurvival.com`.

## Setup

1. Keep real account details in `accounts.json`.
2. Use `accounts.example.json` as the format reference.
3. Adjust server, UI, timings, and feature toggles in `config.json`.
3. Start the bot:

```powershell
node bot.js
```

You can also use:

```powershell
npm start
```

## Commands

```text
help
list
status
pos
pos botname
afk on all
afk off botname
restart all
restart botname
pause all
pause botname
resume all
resume botname
debug botname 10
goto botname x y z
come botname player
follow botname player
stop botname
all /spawn
botname /spawn
botname /tpa player
exit
```

## Optional Settings

These can be set as environment variables before starting:

```text
SERVER_HOST
SERVER_PORT
RECONNECT_DELAY_MS
LOGIN_DELAY_MS
AFK_INTERVAL_MS
DEBUG_AFTER_COMMAND_MS
MANUAL_RESTART_DELAY_MS
JOIN_DELAY_MS
BOT_AUTOSTART=false
```

## What It Does

- Connects every account from `accounts.json`.
- Checks chat prompts first, then auto-sends `/register <password> <password>` for new accounts.
- Checks chat prompts first, then auto-sends `/login <password>` for existing accounts.
- Keeps bots active with look, swing, and occasional sneak actions.
- Reconnects automatically after disconnects or kicks. Default reconnect delay is 5 seconds.
- Starts bots one by one using the configured join delay.
- Lets you restart bots without closing the whole app.
- Tracks status, uptime, reconnect count, last error, and position.
- Logs chat to `logs/chat.log`.
- Adds pathfinding commands through `mineflayer-pathfinder`.
- Supports optional SOCKS proxy settings per account.

## Browser UI

The local dashboard starts with the bot:

```text
http://127.0.0.1:3000
```

It shows bot status, health, hunger, positions, AFK state, reconnect counts, live logs, and command controls.

It also includes:

- Server selector with server ID/address, port, and auth mode.
- Saved server dropdown for quick switching.
- Add bot form.
- Saved bot dropdown for quick editing.
- Edit bot username/password.
- Remove bot button.
- Pause and resume controls.
- Command suggestions for common bot actions.

Passwords are not displayed back in the dashboard. When editing a bot, leave the password field blank to keep the saved password.

## Optional Proxy Format

Add this inside an account only if you need a proxy:

```json
{
  "name": "bot_name_here",
  "password": "server_password_here",
  "proxy": {
    "host": "127.0.0.1",
    "port": 1080,
    "type": 5,
    "username": "",
    "password": ""
  }
}
```

# Mac fetch agent — install

The agent polls the cloud app for fetch jobs, resolves YouTube selectors at
your residential IP, normalizes audio with the shared spec, and uploads
segments to R2. It never accepts inbound connections.

## Prereqs

```sh
brew install node ffmpeg yt-dlp
```

## Build

```sh
cd <repo>
npm install
npm run build -w @routinecast/shared
npm run build -w @routinecast/agent
```

## Configure + install the launchd agent

The plist template still has placeholders (`__REPO_PATH__`, `__API_URL__`,
`__API_TOKEN__`, `__HOME__`). `install.sh` fills them from this machine:

```sh
ROUTINECAST_API_URL=https://your-app.onrender.com \
ROUTINECAST_API_TOKEN=the-same-token-as-render \
  ./agent/install/install.sh
```

Then:

```sh
tail -f ~/Library/Logs/routinecast-agent.log
```

## Wake the Mac before the fetch window (D22)

The cheapest staleness prevention: schedule the Mac to wake before the
morning build so at least one hourly agent run lands first:

```sh
# Wake every day at 05:30 (build cron runs at ~07:00 UTC — adjust to yours)
sudo pmset repeat wakeorpoweron MTWRFSU 05:30:00
```

## Bot-check posture (D19)

If fetches start failing with "confirm you're not a bot", set
`YT_DLP_COOKIES_FROM_BROWSER` in the plist (commented block) to `safari` (or
`chrome`) and reload the agent. This is a deliberate opt-in — it exposes your
logged-in YouTube session to yt-dlp (account-ban exposure), so it is never a
silent default. Keep yt-dlp updated regardless; the agent attempts a
best-effort `brew upgrade yt-dlp` on every run.

## Uninstall

```sh
launchctl unload ~/Library/LaunchAgents/com.routinecast.agent.plist
rm ~/Library/LaunchAgents/com.routinecast.agent.plist
```

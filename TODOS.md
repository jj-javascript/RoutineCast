# TODOS

## Ship v1 (remaining)

Order matters: R2 before Render; Render URL + `API_TOKEN` before GitHub secrets and the Mac agent.

- [ ] **Prove the code:** `npm install`, `npm run typecheck`, `npm test` (needs Node 20 + ffmpeg)
- [ ] **Commit and push** the untracked monorepo to `jj-javascript/DailyRoutineApp`
- [ ] **Cloudflare R2:** two buckets (private `routinecast-state`, public `routinecast-feed` with r2.dev enabled) + R2 API token
- [ ] **ntfy.sh:** pick an unguessable topic, subscribe on the phone → `NTFY_TOPIC`
- [ ] **healthchecks.io:** free check (~24h + grace) → `HEALTHCHECKS_PING_URL`
- [ ] **Render:** Docker web service from `render.yaml`; set all `R2_*`, `NTFY_TOPIC`, `HEALTHCHECKS_PING_URL`; copy generated `API_TOKEN`
- [ ] **GitHub secrets:** `ROUTINECAST_API_URL` (Render URL) and `ROUTINECAST_API_TOKEN` (same token); confirm daily cron vs wake time (UTC, no DST)
- [ ] **Mac agent:** `brew install node ffmpeg yt-dlp`, build agent, install launchd plist (replace placeholders), `pmset` wake before the cron
- [ ] **First episode:** CMS login with `API_TOKEN`, add segments, agent fetch for YouTube items, Rebuild, subscribe the phone to the feed URL

## Deferred from v1 scope

- **E4 — Build history as feed episodes:** keep the last 7 builds as RSS
  items (v1 feed has only the latest) for rollback. Requires `generateRss`
  to accept multiple builds and retention to keep referenced mp3s.
- **Custom domain for the feed:** r2.dev is the v1 serving mechanism for the
  public feed bucket. If r2.dev rate limits or availability ever matter at
  this volume, move the feed bucket behind a custom domain (D6 escape hatch).

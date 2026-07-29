# FundsFlee — Deployment & Cutover (Phase 8)

**Deploy = `git pull && bash deploy.sh`** on the VPS.

Single origin: one **FastAPI** process (uvicorn under **PM2**, port 3000) serves
both the JSON API and the built React SPA, exposed via the existing **Cloudflare
Tunnel** (`fundsflee.voidall.com → localhost:3000`).

> **Single worker only.** `deploy.sh` runs uvicorn with `--workers 1`. The backend
> has an in-process APScheduler (daily 12:00 IST cron) and an in-memory
> shortcut-prepare store; multiple workers would double-run the cron and split
> that store.

---

## What `deploy.sh` does

1. Ensures Node ≥ 20 (via nvm) and PM2.
2. Verifies the pyenv env `FundsFlee_env` exists (override with `PYENV_ENV=…`),
   installs `backend/requirements.txt`.
3. Builds the SPA (`frontend/ → dist`), wiring `VITE_VAPID_PUBLIC_KEY` from
   `.env.local`'s `VAPID_PUBLIC_KEY` if present.
4. (Re)starts the `fundsflee` PM2 process: `uvicorn app.main:app` on `127.0.0.1:3000`.
5. Ensures the Cloudflare Tunnel routes `fundsflee.voidall.com → localhost:3000`
   (unchanged from the old app — same port).

## One-time prerequisites (before the first `bash deploy.sh`)

1. **Python env** (pyenv-virtualenv):
   ```bash
   pyenv install 3.10.12       # if that version isn't present
   pyenv virtualenv 3.10.12 FundsFlee_env   # or any pyenv env; pass PYENV_ENV=… to deploy.sh
   ```
2. **`.env.local`** (repo root — shared with the old app; the backend reads it):
   - `BASE_URL=https://fundsflee.voidall.com`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `JWT_SECRET` — **keep the existing value** (installed iOS Shortcuts depend on it)
   - `SESSION_SECRET` — signs the session cookie
   - `AI_PROVIDER`, `OPENCODE_API_URL`, optionally `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`
   - optional push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`)
3. **Google OAuth**: add the redirect URI in the Cloud Console for `GOOGLE_CLIENT_ID`:
   ```
   https://fundsflee.voidall.com/auth/google/callback
   ```

## Cutover from the old Next.js app

- `deploy.sh` reuses the same PM2 name (`fundsflee`) and port (3000), so it
  **replaces** the old Node process in place — the tunnel route is untouched.
- The new service worker auto-replaces the old Serwist one and, on activate,
  deletes the stale Serwist caches so installed PWAs stop serving the dead Next
  shell (`frontend/src/sw.ts`).
- Backend state lives in `backend/data/` (`users.json`, `cron-session.json`,
  created on first sign-in / cron register). Nothing to migrate — both stacks read
  the same Google Sheets.

## Verify

```bash
pm2 status                                            # fundsflee = online
curl -s https://fundsflee.voidall.com/healthz          # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' https://fundsflee.voidall.com/manifest.webmanifest   # 200
```
Browser: sign in → dashboard; install the PWA; toggle offline → shell + cached
data load; add a transaction offline → reconnect → synced; Lighthouse PWA pass.

## Rollback

`pm2 logs fundsflee` to diagnose. To revert to the old app: `git checkout <old-sha>
&& <old build/start>` (or restart the previous PM2 process). No data to undo.

# FundsFlee — Deployment

**Deploy = `git pull && bash deploy.sh`** on the VPS (branch `main`).

Single origin: one **FastAPI** process (uvicorn, run as the **systemd** service
`fundsflee`) serves both the JSON API and the built React SPA, exposed via a
**Cloudflare Tunnel** (`fundsflee.voidall.com → localhost:<port>`).

> **Single worker only.** `deploy.sh` runs uvicorn with `--workers 1`. The backend
> has an in-process APScheduler (daily jobs, the 60s sheet sync, the nightly
> backup), an in-memory shortcut-prepare store, and writes SQLite from one
> process; multiple workers would double-run the jobs and split that state.

---

## What `deploy.sh` does

1. Picks the port. **The tunnel config is the source of truth**: if
   `fundsflee.voidall.com` is already routed, that rule's port is used; otherwise
   3000, or the next port free on both counts. `PORT=… bash deploy.sh` overrides,
   and it refuses a port held by another service.
2. Ensures Node ≥ 20 (via nvm — only to build the SPA) and systemd.
3. Verifies the pyenv env `FundsFlee_env` exists (override with `PYENV_ENV=…`),
   validates `.env.local`, installs `backend/requirements.txt`.
4. Builds the SPA (`frontend/ → dist`), wiring `VITE_VAPID_PUBLIC_KEY` from
   `.env.local`'s `VAPID_PUBLIC_KEY` if present.
5. Writes `/etc/systemd/system/fundsflee.service` (mode 600), enables and
   restarts it, and waits for the port to bind.
6. Ensures the tunnel ingress rule and the DNS CNAME, then prints every tunnel
   route and whether it is answering.

## One-time prerequisites

1. **Python env** (pyenv-virtualenv):
   ```bash
   pyenv install 3.12.8                       # if that version isn't present
   pyenv virtualenv 3.12.8 FundsFlee_env      # or any env; pass PYENV_ENV=… to deploy.sh
   ```
2. **`.env.local`** at the repo root (template: `.env.local.example`):
   - `BASE_URL=https://fundsflee.voidall.com`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `JWT_SECRET` — **keep the existing value** (installed iOS Shortcuts depend on it)
   - `SESSION_SECRET` — signs the session cookie
   - `AI_PROVIDER`, `OPENCODE_API_URL`, optionally `ANTHROPIC_API_KEY`/`GEMINI_API_KEY`
   - optional push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`)
   - optional: `BACKUP_DIR` (see Data below)
3. **Google OAuth**: the redirect URI in the Cloud Console for `GOOGLE_CLIENT_ID`:
   ```
   https://fundsflee.voidall.com/auth/google/callback
   ```

## Data

Everything lives in `backend/data/` — **this disk is the database**:

- `sheets/{sheet_id}.db` — one SQLite file per spreadsheet, the authoritative
  store. The Google Sheet is a one-way mirror, caught up every 60s
  (see `SQLITE_MIGRATION.md`); hand-edits to the sheet are overwritten.
- `users.json` — OAuth refresh tokens; `cron-session.json` — the unattended
  cron's credentials.

A verified snapshot of all of it is taken nightly at 03:30 IST into
`BACKUP_DIR` (default `backend/data/backups`, 14 days, never fewer than 3).
**That does not survive losing the disk** — point `BACKUP_DIR` at another volume
or copy the tarballs off the machine. Restore: stop the service, unpack over
`backend/data/`, start it; the syncer pushes the restored rows back to the sheet.

`python scripts/verify_mirror.py` (from `backend/`) diffs the database against
the sheet, read-only.

## Verify

```bash
systemctl status fundsflee                            # active (running)
curl -s https://fundsflee.voidall.com/healthz          # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' https://fundsflee.voidall.com/manifest.webmanifest   # 200
```
Browser: sign in → dashboard; install the PWA; toggle offline → shell + cached
data load; add a transaction offline → reconnect → synced.

## Logs and rollback

`journalctl -u fundsflee -f` for live logs, `sudo systemctl restart fundsflee`
to restart. To roll back code: `git checkout <old-sha> && bash deploy.sh`.
Data is not touched by a deploy.

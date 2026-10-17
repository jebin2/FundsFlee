# FundsFlee

- `backend/` — FastAPI (Python, pyenv env). Run from `backend/`:
  `python -m uvicorn app.main:app`; tests: `python -m pytest -q`.
- `frontend/` — Vite + React SPA. `npm run dev` (proxies `/api` and `/auth` to
  :8000), `npm run build`. Some files still import `next/*` specifiers; those
  resolve to local shims in `frontend/src/shims/` — there is no Next.js.
- SQLite in `backend/data/sheets/` is the database; the Google Sheet is a
  one-way mirror (`SQLITE_MIGRATION.md`). Never write to the sheet directly.
- The REST contract is `API.md`. Deploy is `DEPLOY.md`.

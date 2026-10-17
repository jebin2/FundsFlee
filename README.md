# FundsFlee

A personal AI spending tracker that logs transactions automatically from receipts, bank SMS, emails, and bank statements — all stored in your own Google Sheet.

## What it does

- **Capture** — photograph a receipt, paste a bank SMS, or upload a PDF bank statement. AI reads it and creates the transaction in the background.
- **Email import** — connects to Gmail and automatically pulls transactions from bank alert emails daily.
- **Analysis** — AI-generated spending breakdown by category with insights and saving tips.
- **Duplicates** — detects and merges transactions recorded from multiple sources (e.g. the same payment from a receipt and a bank email).
- **Offline-first** — works without internet; changes sync automatically when connectivity returns.
- **PWA** — installable on iPhone and Android, works like a native app.

## Tech stack

- **FastAPI** (`backend/`) — the API, background jobs and scheduler; also serves the built SPA
- **React + Vite** (`frontend/`) — the PWA, with Workbox for offline support
- **SQLite + Google Sheets** — a local SQLite file per user is the database; their own Google Sheet is a one-way mirror of it, synced every minute
- **Google OAuth** — sign-in and access to Sheets, Drive, and Gmail
- **AI** (Claude, Gemini, OpenCode) — receipt parsing, SMS parsing, PDF extraction, duplicate detection, spending analysis

## Self-hosting

1. Clone the repo
2. Copy `.env.local.example` → `.env.local` and fill in your keys (Google OAuth, AI provider)
3. Run `bash deploy.sh` on your VPS — installs a systemd service, builds the SPA, and configures Cloudflare Tunnel. See [`DEPLOY.md`](./DEPLOY.md).

The REST contract is in [`API.md`](./API.md); the storage design in
[`SQLITE_MIGRATION.md`](./SQLITE_MIGRATION.md).

## Feature docs

Plain-language descriptions of every feature are in [`/functionality`](./functionality/).

How a photo, PDF, email or SMS becomes transaction rows:
[`PARSING_FLOW.md`](./PARSING_FLOW.md).

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

- **Next.js 16** — full-stack React framework
- **Google Sheets** — the database; every user's data lives in their own sheet in their Google Drive
- **Google OAuth** — sign-in and access to Sheets, Drive, and Gmail
- **Claude AI** — receipt parsing, SMS parsing, PDF extraction, duplicate detection, spending analysis
- **Serwist** — service worker for PWA and offline support

## Self-hosting

1. Clone the repo
2. Copy `.env.local.example` → `.env.local` and fill in your keys (Google OAuth, Claude API)
3. Run `bash deploy.sh` on your VPS — sets up PM2, builds, and configures Cloudflare Tunnel

## Feature docs

Plain-language descriptions of every feature are in [`/functionality`](./functionality/).

How a photo, PDF, email or SMS becomes transaction rows:
[`PARSING_FLOW.md`](./PARSING_FLOW.md).

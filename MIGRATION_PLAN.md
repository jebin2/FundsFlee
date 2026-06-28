# FundsFlee Migration Plan — Next.js Full-Stack → Python Backend + React SPA

**Goal:** Split the current Next.js 16 monolith into a Python (FastAPI) backend and a standalone React SPA, connected via REST API.

---

## 1. Current Architecture Analysis

### What exists today (~15k LOC TypeScript, 39 API routes)

| Layer | Current implementation | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router, `--webpack`) | Pages + API routes in one process |
| Auth | NextAuth v5 (beta) + Google OAuth | JWT session cookie carries Google `access_token`/`refresh_token`/`sheet_id`; token refresh in JWT callback |
| Database | **Google Sheets** (per-user, in their Drive) | `src/lib/sheets/*` — transactions, categories, meta, suggestions, parsed-emails, analysis cache |
| AI | Provider chain: Anthropic → Gemini → OCR → opencode | `src/lib/ai/*` — receipt/SMS/email/statement parsing, dedup, analysis, comparison, normalization |
| Background jobs | `node-cron` (daily 12:00 IST), started via `instrumentation.ts` | Email import, dedup, merge retry, analysis, comparison retry; session persisted to `data/cron-session.json` |
| Async tasks | Fire-and-forget jobs in `src/server/jobs/*` (receipt processing, statement parsing, enrichment) | Polled by the client via status endpoints |
| Push | `web-push` (VAPID) | Subscription stored in the user's sheet meta |
| Apple Shortcuts | JWT-authenticated endpoint (`jose`), binary plist generation (`src/lib/bplist.ts`) | Standalone token auth, separate from session auth |
| Offline/PWA | Serwist service worker, Dexie (IndexedDB), write queue + sync | Entirely client-side — survives migration mostly intact |
| Frontend state | Zustand stores, custom hooks, react-hook-form + zod, recharts, Tailwind 4 | All portable to a plain React SPA |

### Key observations that shape the plan

1. **There is no traditional database.** Google Sheets is the store, accessed with the *user's* OAuth token. The backend is essentially stateless apart from `data/cron-session.json` and in-flight job state. This makes the Python rewrite much simpler than a typical migration — no data migration at all.
2. **The session IS the credential.** The NextAuth JWT cookie holds the Google access token; every Sheets/Gmail call uses it. The Python backend must own the full OAuth flow and issue its own session tokens that map to Google credentials.
3. **The frontend is already API-shaped.** All data flows through `fetch` to `/api/*` (see `src/lib/api/*` client wrappers). The UI never uses server components for data — pages are client components. Extracting the SPA is low-risk.
4. **Offline-first must keep working.** Dexie queue + service worker sync are client-side and survive, but the SW caching rules and the same-origin assumption (`/api/*`) need attention if backend and frontend are served from different origins.
5. **Python wins one for free:** `src/lib/bplist.ts` (hand-rolled binary plist writer for the iOS Shortcut) is replaced by Python's built-in `plistlib`.

### Full REST surface to reproduce (39 routes)

```
Auth (NextAuth, becomes new endpoints)   /api/auth/*  → /auth/login, /auth/callback, /auth/session, /auth/logout
Transactions   GET/POST /transactions · GET/PATCH/DELETE /transactions/{id} · POST /transactions/{id}/enrich
Categories     GET/POST /categories · PATCH/DELETE /categories/{id}
Parsing        POST /parse/image · POST /parse/text (+/async, /process) · POST /parse/statement (+/async, /process)
Receipts       POST /receipts/upload · POST /receipts/process
Duplicates     POST /duplicates/detect · POST /duplicates/merge
Analysis       GET/POST /analyze · GET/POST /compare · POST /compare/items
Items          POST /items/normalize · GET /items/suggestions
Email import   GET/PUT /email/config · POST /email/fetch · GET /email/status
Cron           POST /cron/register · POST /cron/run · GET /cron/status · POST /cron/clear
User           GET/PUT /user/profile · GET /user/token
Sheet          POST /sheet/init · POST /reset
Shortcut       POST /shortcut · GET /shortcut/prepare · GET /shortcut/file · GET /shortcut/install.shortcut
Misc           POST /push/subscribe · POST /share
```

---

## 2. Target Architecture

```
┌──────────────────────────┐         ┌─────────────────────────────┐
│  React SPA (Vite)        │  REST   │  FastAPI backend (Python)   │
│  - react-router          │ ──────► │  - google-auth-service      │
│  - Zustand, Dexie, PWA   │  JSON   │  - google-api-python-client │
│  - vite-plugin-pwa       │         │  - anthropic / google-genai │
└──────────────────────────┘         │  - APScheduler (cron)       │
     served as static files          │  - pywebpush, plistlib      │
     (by FastAPI or nginx/CDN)       └─────────────────────────────┘
                                              │
                                     Google Sheets / Drive / Gmail
                                     (user's own account = the DB)
```

**Recommended stack**

| Concern | Current (Node) | Target (Python) |
|---|---|---|
| HTTP framework | Next.js API routes | **FastAPI** + uvicorn (async, auto OpenAPI docs) |
| Validation | zod | **Pydantic v2** (near 1:1 mapping from zod schemas) |
| Google OAuth | next-auth | **google-auth-service** (jebin's lib: OAuth code flow + JWT sessions + FileUserStore) |
| Google APIs | googleapis | **google-api-python-client** + google-auth |
| Anthropic | @anthropic-ai/sdk | **anthropic** (Python SDK) |
| Gemini | @google/generative-ai | **google-genai** |
| Cron | node-cron + instrumentation.ts | **APScheduler** (started in FastAPI lifespan) |
| Async jobs | fire-and-forget promises | **asyncio tasks / BackgroundTasks** (same poll-for-status model) |
| Push | web-push | **pywebpush** |
| Shortcut JWT | jose | **PyJWT** |
| Binary plist | hand-rolled bplist.ts | **plistlib** (stdlib) |
| Frontend build | Next.js | **Vite + React 19 + react-router** |
| PWA / SW | Serwist | **vite-plugin-pwa** (Workbox) |

**Serving model:** Serve the built SPA as static files from FastAPI (`StaticFiles` with SPA fallback) so everything stays same-origin — this avoids CORS, keeps the session cookie simple (`SameSite=Lax`, httpOnly), and keeps the service worker scope unchanged. The existing `deploy.sh` (PM2 + Cloudflare Tunnel) changes from `next start` to `uvicorn`.

---

## 3. Phase-by-Phase Plan

### Phase 0 — API Contract Freeze & Scaffolding (foundation)

**Goal:** Lock the REST contract so backend and frontend can be built in parallel; restructure the repo.

- Audit all 39 routes: document method, path, request/response shape, auth type (session cookie vs shortcut JWT vs none). The zod schemas in `src/types/*` and `src/lib/sheets/transactionSchema.ts` are the source of truth.
- Decide the new repo layout:
  ```
  backend/   (FastAPI app: app/routers, app/services, app/sheets, app/ai, app/jobs)
  frontend/  (Vite React app: src/pages, src/components, src/hooks, src/store, src/lib)
  functionality/  (keep — feature docs)
  ```
- Write the OpenAPI spec skeleton (or let FastAPI generate it from stub routers) and keep response shapes **byte-identical** to today's JSON, so the existing frontend code ports without data-shape changes.
- Define the auth contract: httpOnly session cookie issued by the backend after Google OAuth; `GET /auth/session` returns `{ user, sheet_id, error }` (replaces `useSession`).

**Exit criteria:** `API.md` / OpenAPI file enumerating every endpoint with schemas; empty FastAPI + Vite projects boot.

---

### Phase 1 — Python Backend Core: Auth + Google Clients

**Goal:** Replace NextAuth and the Google client layer — everything else depends on these.

- **OAuth flow (replaces `src/lib/auth.ts`, `src/lib/googleAuth.ts`):**
  - `/auth/login` → redirect to Google with the same scopes (`spreadsheets`, `drive.file`, `gmail.readonly`, `access_type=offline`, `prompt=consent`).
  - `/auth/callback` → exchange code, run `init_spending_sheet`, mint a signed session JWT (access_token, refresh_token, sheet_id, expires_at) in an httpOnly cookie — mirroring the NextAuth JWT callback exactly, including the "keep old refresh_token if Google omits it" behavior.
  - Auto-refresh on request when `expires_at` passed; set `error: "RefreshTokenError"` on failure (frontend already handles this signal).
- **Google clients (replaces `src/lib/sheets/client.ts`):** thin factories for Sheets/Drive/Gmail using the per-request access token, plus the `withSheetsRetry` wrapper (429 → 65s wait, 5xx → exponential backoff). Use `asyncio.to_thread` for the blocking google-api-python-client calls (or `aiogoogle` if you prefer fully async).
- **Session dependencies (replaces `src/server/http/requireSession.ts` / `withSession.ts`):** FastAPI `Depends(require_session)`.
- Port `src/lib/logger.ts` → Python `logging` with the same `[scope] message` format.

**Exit criteria:** Sign in via browser against the Python backend; `GET /auth/session` returns a valid session; a smoke endpoint reads the user's sheet.

---

### Phase 2 — Sheets Data Layer (the "database")

**Goal:** Port `src/lib/sheets/*` — the highest-risk, most detail-heavy code. Pure logic, no UI.

- Port in dependency order: `schema/headers.ts` + `transactionSchema.ts` (column maps, zod→Pydantic) → `meta.ts` → `transactions.ts` → `categories.ts` → `suggestions.ts` → `parsedEmails.ts` → `analysis-cache.ts` → `drive.ts` → `init.ts` (incl. `schema/migrations.ts` and `defaultCategories.ts`).
- **Critical invariants to preserve:**
  - Exact column ordering/header names — existing user sheets must keep working with zero migration.
  - Row-ID semantics, A1-notation ranges, serial date handling (note recent commit "time isse fux" — preserve whatever timezone fix that made).
  - Serial (not parallel) writes for deletes — recent commit reverted parallelism due to rate limits.
- Port the two existing vitest suites (`transactionSchema.test.ts`, `transactionList.test.ts`) to pytest first — they encode the schema rules.
- **Parity harness:** a script that runs the same read operations through the old TS lib and new Python lib against a test sheet and diffs the JSON. This is the cheapest insurance in the whole project.

**Exit criteria:** pytest green; parity script shows identical output for transactions/categories/meta reads and writes on a scratch sheet.

---

### Phase 3 — AI Layer & Domain Services

**Goal:** Port `src/lib/ai/*`, `src/domain/*`, and `src/server/services/*`.

- **Provider chain** (`providerChain.ts`, `client.ts`, `providers/*`): Anthropic → Gemini → OCR → opencode fallback, driven by `AI_PROVIDER` env. The prompts in `parse-image/text/email/notes`, `analyze`, `compare`, `dedup`, `normalize-items`, `merge-transactions` move verbatim — **do not "improve" prompts during migration**; behavior parity first.
- Port `parseJson.ts` (lenient JSON extraction from model output) and `safeJson.ts` faithfully — these handle real-world model quirks.
- Port services: `analysisService`, `comparisonService`, `duplicateDetectionService`, `emailImportService` (+ `gmailQuery.ts`, `emailImportConfig.ts`, `postImportDuplicateCheck.ts`), `itemNormalizationService`, `itemSuggestionService`, `receiptProcessingService`.
- Port domain logic: `domain/transactions/{factory,metadata,status}.ts` and use-cases (`createMergeRequest`, `createReceiptUploadRequest`, `createStatementImportRequest`).
- Statement parsing handles PDF uploads — verify multipart handling and any size limits match.

**Exit criteria:** Golden-file tests: a fixture set of receipt images / SMS texts / sample emails produces the same parsed transactions as production (modulo model nondeterminism — assert on structure + key fields).

---

### Phase 4 — REST Routes, Jobs, Cron, Push, Shortcut

**Goal:** Expose everything from Phases 1–3 as the 39 routes; port the background machinery.

- **Routers:** transactions, categories, parse, receipts, duplicates, analyze/compare, items, email, user, sheet/reset, share, push. Match status codes and error JSON from `src/lib/api-error.ts`.
- **Async jobs** (`src/server/jobs/*`): keep the fire-and-forget + client-polls-status model. Use `asyncio.create_task` with the same status writes to the sheet (`processing` → `done`/`failed`), including `hide_from_ui` handling for receipt OCR tasks.
- **Cron** (`src/lib/cron/*`): APScheduler with the same `0 12 * * *` Asia/Kolkata schedule, started in FastAPI lifespan (replaces `instrumentation.ts`). Port `cronStore` (the `data/cron-session.json` file is format-compatible — reuse it as-is) and the full `runDailyJobs` pipeline including stuck-transaction cleanup.
- **Push:** pywebpush with the same VAPID keys; same payload shape so existing browser subscriptions keep working.
- **Shortcut endpoints:** PyJWT verification with the same `JWT_SECRET` (existing installed iOS Shortcuts must keep working!), `plistlib` for the `.shortcut` file generation (port `shortcutPrepare.ts`; validate output opens in iOS Shortcuts).

**Exit criteria:** Contract test suite (e.g. schemathesis or pytest + httpx) passes against the new backend; **the existing Next.js frontend, pointed at the Python backend via a rewrite/proxy, works end-to-end.** This is the big integration checkpoint — backend is done before any frontend work starts.

---

### Phase 5 — React SPA: Shell, Auth, Routing

**Goal:** Stand up the Vite SPA and port the app skeleton.

- Scaffold Vite + React 19 + TypeScript + Tailwind 4 + react-router. Most `src/` code is copy-paste portable; the work is replacing Next-isms:
  - `next/navigation` (`useRouter`, `usePathname`) → react-router (`useNavigate`, `useLocation`).
  - `next/image` → plain `<img>` (only Google avatar images are involved).
  - `next-auth/react` (`useSession`, `signIn`, `signOut`) → small auth context backed by `GET /auth/session` + redirects to `/auth/login` / `/auth/logout`.
  - Route groups: `(app)/layout.tsx` → a layout route with `<Outlet/>`; landing (`page.tsx`), `onboarding`, offline page become routes.
- Port shared infrastructure unchanged: Zustand stores, `lib/api/*` fetch wrappers, `hooks/*`, `providers/SyncProvider`, `lib/format`, `lib/date`, types.
- Dev setup: Vite proxy `/api` + `/auth` → `localhost:8000`.

**Exit criteria:** Sign in, see the dashboard shell, navigate all routes (even if some pages are still stubs).

---

### Phase 6 — React SPA: Feature Pages

**Goal:** Port all 17 pages and their components/hooks. Largely mechanical since pages are already client components.

Suggested order (dependency/simplicity first):

1. **Transactions list + detail** (`transactions/`, `TransactionRow`, `TransactionSheet`, `EditForm`, `useTransactions`) — the core loop.
2. **Dashboard** (`SpendingChart`, recharts).
3. **Add / manual entry** (`add/`, react-hook-form flows, `useManualTransactionForm`, `useSmartDefaults`, suggestions).
4. **Capture** (`capture/`, `useCameraCapture`, `useReceiptUpload`, `useSmsParser`, `useReceiptProcessingPoller`).
5. **Categories**, **Import** (statement upload), **Analysis** (`InsightsTab`), **Compare** (`CompareTab`).
6. **Settings** suite: profile, email import, sheet, data & export, scheduled tasks, shortcut install.
7. **Onboarding** flow (`useOnboardingFlow`).

**Exit criteria:** Feature-by-feature manual pass against the checklists in `/functionality/*.md` (24 docs — these are your acceptance criteria, already written).

---

### Phase 7 — PWA, Offline & Push Parity

**Goal:** Reproduce the Serwist setup with vite-plugin-pwa; this is the most platform-sensitive part of the frontend.

- Port `src/app/sw.ts` logic to a Workbox `injectManifest` SW: precache app shell, `/~offline` fallback route, `cacheOnNavigation` equivalent, **and make sure `/api/*` is NetworkOnly** (the Dexie layer owns offline data, not the SW).
- Port unchanged: `lib/offline/{db,queue,sync}.ts`, `useOfflineFetch`, `useFetchInterceptor`, `useOnlineStatus`, `networkStore`.
- Push: `usePushSubscription` works as-is; expose the VAPID public key via env (`VITE_VAPID_PUBLIC_KEY`) or a `/push/key` endpoint.
- `manifest.json`: keep identical (name, icons, start_url) so installed PWAs update in place rather than becoming new apps.
- **SW migration for existing users:** ship logic to unregister the old Serwist SW / clear stale precaches, otherwise installed PWAs may serve the dead Next.js shell forever.
- Test the full offline loop on real devices: airplane mode → add transaction → queued in Dexie → reconnect → synced to sheet.

**Exit criteria:** Lighthouse PWA pass; install + offline + queued-sync + push verified on Android and iOS.

---

### Phase 8 — Parity Testing, Deployment & Cutover

**Goal:** Prove parity, switch production, delete the old stack.

- **Parity sweep:** run every `/functionality/*.md` checklist against the new stack. Diff sheet writes between old and new for identical operations.
- **Deployment:** rewrite `deploy.sh` — `pip install`/venv (or uv), `vite build`, FastAPI serves `frontend/dist` with SPA fallback, PM2 (`uvicorn` via interpreter) or systemd, same Cloudflare Tunnel.
- **Env migration:** same `.env` keys (`GOOGLE_CLIENT_*`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `AI_PROVIDER`, `JWT_SECRET`, VAPID keys, `OPENCODE_API_URL`); drop `AUTH_SECRET`/`NEXTAUTH_URL`, add `SESSION_SECRET` + `BASE_URL`.
- **Cutover sequence (per-user impact):**
  1. Deploy new stack to the same domain.
  2. All users are signed out once (NextAuth cookie → new session cookie) — they re-auth with Google; sheets are untouched.
  3. Verify `data/cron-session.json` is honored (or have the user open the app once to re-register, as the cron already instructs).
  4. Existing iOS Shortcuts keep working if `JWT_SECRET` is unchanged — verify before deleting old code.
  5. Monitor the first 12:00 IST cron run end-to-end.
- **Cleanup:** remove Next.js code, `node_modules` from backend path, old SW files in `public/`; update `README.md` tech stack and `AGENTS.md` (the "this is not the Next.js you know" warning becomes obsolete).

**Exit criteria:** One full day in production: a receipt capture, an email import cron run, an analysis generation, and an offline sync all succeed; old code deleted.

---

## 4. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Sheets layer behavior drift (column order, date/serial handling, rate-limit pacing) | **High** | Phase 2 parity harness; port tests first; never run old + new writers against the same sheet concurrently |
| Auth/session subtleties (refresh-token-absent case, `RefreshTokenError` signaling, sheet init on first login) | **High** | Mirror `auth.ts` logic line-by-line; integration test with a real Google account |
| Installed PWAs serving the stale Next.js shell after cutover | **High** | Explicit old-SW unregister + cache purge logic shipped in the new SW (Phase 7) |
| iOS Shortcut breakage (JWT format, bplist output) | Medium | Keep `JWT_SECRET` and token payload identical; binary-compare/`plutil`-validate plist output |
| AI output differences (prompt formatting, JSON extraction edge cases) | Medium | Move prompts verbatim; golden-file tests; port `parseJson` leniency exactly |
| Long-running jobs killed on uvicorn restarts (Node had the same flaw) | Medium | Stuck-transaction cleanup already handles it; keep PM2 graceful reload |
| CORS/cookie issues if frontend is ever split to a different origin | Low | Same-origin serving (FastAPI serves SPA) avoids the entire class |
| Sheets quota: Python client pacing differs from Node | Medium | Port `withSheetsRetry` semantics exactly (65s on 429); keep serial deletes |

## 5. Recommended Sequencing & Effort Shape

- Phases are strictly ordered for the backend (1 → 2 → 3 → 4), but **Phase 5–6 frontend work can start in parallel after Phase 0** since the API contract is frozen and the old backend can serve it during development.
- The single most valuable checkpoint is the **end of Phase 4**: old frontend + new backend running together. It isolates every backend bug before any frontend variable is introduced.
- Relative effort: Phase 2 (Sheets layer) and Phase 6 (feature pages) are the bulk; Phases 0, 1, 5 are small; Phases 3, 4, 7, 8 are medium.
- Keep the migration **behavior-preserving only** — log every "we should improve X" in a follow-up list instead of fixing it mid-port.

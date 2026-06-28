# FundsFlee REST API Contract (v1 — frozen for migration)

This is the **frozen contract** between the Python backend and the React SPA.
It reproduces the current Next.js behavior exactly. Response shapes are byte-compatible
with today's JSON so frontend code ports without data-shape changes.

**Total: 39 existing routes + 4 new auth endpoints (replacing NextAuth).**

---

## Conventions

- All paths keep the `/api/` prefix (installed iOS Shortcuts hardcode `POST /api/shortcut` — paths must not change).
- All request/response bodies are JSON unless marked `multipart`.
- Timestamps are ISO-8601 strings; dates are `YYYY-MM-DD`; amounts are numbers (INR).

### Auth modes

| Mode | Mechanism | Used by |
|---|---|---|
| **session** | httpOnly session cookie (JWT signed with `SESSION_SECRET`) carrying Google `access_token`, `refresh_token`, `sheet_id`, `expires_at`, user email/name. Backend auto-refreshes the Google token when expired. | Almost everything |
| **shortcut-jwt** | `Authorization: Bearer <JWT>` signed with `JWT_SECRET` (HS256), payload `{ email, sheetId, purpose: "shortcut", refreshToken, region }`. **Must remain compatible with already-installed shortcuts.** | `POST /api/shortcut` |
| **prepare-id** | Short-lived (10 min) in-memory UUID → shortcut-JWT lookup | `GET /api/shortcut/file`, `GET /api/shortcut/install.shortcut` |
| **none** | — | auth endpoints |

### Error envelope (must match exactly)

| Condition | Status | Body |
|---|---|---|
| No/invalid session | 401 | `{"error": "Unauthorized"}` |
| Google token rejected downstream | 401 | `{"error": "auth_expired"}` |
| Validation failure | 400 | `{"error": "<message>"}` |
| Unhandled exception | 500 | `{"error": "Internal server error"}` |

### Core entities

```ts
Transaction {
  id: string; date: string; time: string; amount: number;
  original_amount?: number; original_currency?: string;
  merchant: string; category: string; subcategory?: string;
  item_name?: string; payment_method: "Cash"|"UPI"|"Card"|"NetBanking"|"Other";
  tags?: string[]; notes?: string;
  source: "manual"|"sms"|"email"|"receipt"|"shortcut"|"merge"|"import";
  raw_input?: string; location?: string;
  is_duplicate?: boolean; duplicate_ref?: string;
  created_at: string; updated_at: string;
  status?: "queued"|"processing"|"done"|"failed"|"merging"|"merge_failed";
  receipt_url?: string; receipt_id?: string; quantity?: string;
  deleted?: boolean; recurrence?: "daily"|"weekly"|"monthly"|"yearly";
  merge_id?: string;
}

Category {
  id: string; name: string; parent_id?: string; color: string;
  icon: string; is_default: boolean; created_at: string;
}
```

---

## Auth (replaces NextAuth — implemented by [google-auth-service](https://github.com/jebin2/googleauthservice) v1.1+)

| Method & path | Auth | Description |
|---|---|---|
| `GET /auth/google/authorize` | none | 302 → Google OAuth consent (lib code flow). Scopes: `openid email profile spreadsheets drive.file gmail.readonly`; `access_type=offline`, `prompt=consent`; CSRF state cookie. |
| `GET /auth/login` | none | Convenience alias → 307 `/auth/google/authorize`. |
| `GET /auth/google/callback` | none | Lib exchanges the code, stores Google credentials in the FileUserStore, fires the `on_oauth_credentials` hook (FundsFlee: `init_spending_sheet`, stamps `sheet_id`/`sheet_is_new` on the user record), sets httpOnly session cookie; 302 → `/` (or `/onboarding` if the sheet is new; `/?auth_error=1` on failure). Keeps old Google `refresh_token` if Google omits one on re-consent. |
| `GET /api/auth/session` | session | `{ user: { name, email, image }, sheet_id, sheet_is_new, error? }` — `error: "RefreshTokenError"` when the Google token refresh fails (client treats as signed-out). 401 if no cookie. Replaces `useSession()`. |
| `POST /auth/logout` | session | Lib endpoint: bumps token version (revokes all sessions), clears cookie. `{ success: true, message: "Logged out" }` |
| `GET /auth/me` | session | Lib endpoint: raw user record. SPA should prefer `/api/auth/session`. |

Session model: the cookie holds a **lib session JWT** (user id + email only — Google tokens never leave the server). Google access/refresh tokens live in `data/users.json` (FileUserStore, mode 0600); `auth.get_google_access_token()` auto-refreshes them per request. This replaces both the NextAuth fat-cookie *and* (eventually, Phase 4) the `data/cron-session.json` pattern — the cron can read refresh tokens from the user store.

---

## Transactions

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/transactions?page&pageSize` | session | `page` ≥1 default 1; `pageSize` 1–500 default `PAGE_SIZE` | `{ transactions: Transaction[], total: number, hasMore: boolean }` |
| `POST /api/transactions` | session | `{ transaction: Transaction }` — server fills `id` (uuid4) if empty, `created_at` if empty, always sets `updated_at=now` | `{ transaction: Transaction }` (the completed object) |
| `PUT /api/transactions/{id}` | session | `{ updates: Partial<Transaction> }` | `{ ok: true }` |
| `PATCH /api/transactions/{id}` | session | `Partial<Transaction>` (bare, no wrapper) | `{ ok: true, updates: <echo> }` |
| `DELETE /api/transactions/{id}` | session | — | `{ ok: true }`. Side effect: any tx with `duplicate_ref == id && is_duplicate` gets flags cleared first; delete is a **soft delete** (`deleted: true`). |
| `POST /api/transactions/{id}/enrich` | session | multipart: `text?`, `image?` (jpeg/png/webp), `region?`, `txContext?` (JSON string), `receiptId?`. 400 if neither text nor image. | `{ ok: true }` — fire-and-forget job. For receipt retries (`receiptId` set): soft-deletes old items + creates "processing" placeholder **before** responding; 500 `{"error":"Failed to prepare receipt retry"}` on prepare failure. |

## Categories

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/categories` | session | — | `{ categories: Category[] }` |
| `POST /api/categories` | session | `{ id, name, color, icon, created_at }` | `{ ok: true }` |
| `DELETE /api/categories/{id}` | session | — | `{ ok: true }` |

## Parsing (synchronous)

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/parse/text` | session | `{ text, region? }` — 400 if no text | `{ extracted: ParsedTransaction, confidence: number }` |
| `POST /api/parse/image` | session | multipart: `image` (jpeg/png/webp only — 400 otherwise), `region?` | `{ extracted: ParsedTransaction, confidence: number }` |
| `POST /api/parse/statement` | session | multipart: `file` (PDF only, ≤20MB) | `{ transactions: StatementTx[] }` — direct Anthropic PDF parse (model `AI_MODEL` ?? `claude-sonnet-4-6`); 500 `{"error":"Could not parse AI response"}` / `{"error":"Unexpected AI response"}` |

## Parsing (async job + retry)

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/parse/text/async` | session | `{ text, region? }` — 400 if blank | `{ ok: true, txId }` — creates queued placeholder, runs job in bg |
| `POST /api/parse/text/process?txId&region` | session | query only; 400 if no txId | `{ ok: true }` — fire-and-forget retry |
| `POST /api/parse/statement/async` | session | multipart `file` (PDF ≤20MB) | `{ ok: true, txId }` |
| `POST /api/parse/statement/process?txId` | session | query only | `{ ok: true }` — fire-and-forget retry |

## Receipts

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/receipts/upload` | session | multipart `image` (mime defaults to image/jpeg) | result of `createReceiptUploadRequest` (txId placeholder, `hide_from_ui=true`) |
| `POST /api/receipts/process` | session | `{ txId, region? }` — 400 if no txId | receipt result, or `{ error }` with service-provided status |

## Duplicates

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/duplicates/detect` | session | — | `{ skipped: true }` if last run < 1h ago, else `{ started: true }` (bg job; progress via `dedup_running_at` meta) |
| `POST /api/duplicates/merge` | session | `{ transactionIds: string[] }` — 400 if <2: `{"error":"Need at least 2 transaction IDs to merge"}` | `{ ok: true, ...mergeResult }` |

## Analysis & Compare

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/analyze?period` | session | `period` default `month` | analysis status object (from cache row: status/summary/generated_at) |
| `POST /api/analyze` | session | `{ period?="month", region?, lifestyle_tags?, force_refresh? }` | analysis request status |
| `GET /api/compare?merchants=a\|b&period` | session | `merchants` pipe-separated; `period` default `month` | comparison status |
| `POST /api/compare` | session | comparison request body | comparison; 400 `{"error":"Select at least 2 merchants"}` |
| `GET /api/compare/items` | session | — | `{ comparisons: ItemPriceComparison[], total_items }` — normalizes item names via AI, cached under `item_norm_<fingerprint>` key |

## Items

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/items/normalize` | session | — | normalization request status |
| `GET /api/items/suggestions` | session | — | `{ suggestions: [...] }` |
| `PATCH /api/items/suggestions` | session | resolution body | `{ ok: true }` |

## Email import

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/email/config` | session | — | email import status/config |
| `PUT /api/email/config` | session | `{ fromContains?: string[], daysBack?: number }` | `{ ok: true }` |
| `POST /api/email/fetch?manual=1` | session | — | `{ ok: true, message: "Email import started in background." }` — always fire-and-forget |
| `GET /api/email/status` | session | — | config status + `{ emailsScanned, emailsParsed, emailsSkipped, emailsFailed }` |

## Cron

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/cron/register` | session | — | `{ ok: true }` or `{ ok: false, reason: "no refresh token in session" }`. Persists `{refreshToken, sheetId, userEmail, savedAt}` to `data/cron-session.json` (mode 0600). Called on every app load. |
| `POST /api/cron/run?job=all\|email\|dedup\|analysis` | session | — | `all`: sequential, `{ ok, results: { email, dedup, analysis } }`; `email`: bg, `{ ok, job, status: "started (background)" }`; `dedup`: sync `{ ok, job, status: "done" }`; `analysis`: sync, status like `"week=done month=done year=failed"`; unknown → 400 `{"error":"Unknown job"}` |
| `GET /api/cron/status` | session | — | `{ registered, email: { lastRun, runningAt, txCount, enabled }, dedup: { lastRun, runningAt }, analysis: { week\|month\|year: { lastRun, status } }, schedule: "12:00 IST daily" }` — "running" = runningAt < 10 min old AND lastRun not newer |
| `POST /api/cron/clear?job=email\|dedup\|analysis\|all` | session | — | `{ ok: true }` — clears running markers / sets analysis rows `cancelled` |

## User / Profile

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/user/profile` | session | — | `{ name, region, lifestyle_tags: string[], monthly_income: number\|null, shortcut_token, shortcut_last_used, sheet_url, receipts_folder_id }` (meta values; name falls back to Google profile name) |
| `PUT /api/user/profile` | session | flat `{ key: value }` map — objects JSON-stringified, each written to sheet meta | `{ ok: true }` |
| `GET /api/user/token` · `POST /api/user/token` | session | — | `{ token }` — regenerates shortcut JWT (payload above, HS256 `JWT_SECRET`), stores in meta `shortcut_token`. 401 if no user email. |

## Sheet

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/sheet/init` | session | — | `{ sheetId, sheetUrl, isNew: false }` (init actually happens at sign-in) |
| `POST /api/reset` | session | — | `{ ok: true }` — wipes & re-initializes the sheet |

## Shortcut (iOS)

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/shortcut` | shortcut-jwt | `{ text, source?="shortcut" }` | `{ entry: Transaction }`. 401 variants: missing token / invalid token / `"Token is outdated — please reinstall the shortcut from the app."` (no refreshToken in payload) / `"Could not authenticate — please reinstall the shortcut from the app."` (refresh failed). Parses text → appends tx → sets meta `shortcut_last_used`. |
| `POST /api/shortcut/prepare` | session | — | `{ prepareId }` (UUID; 10-min in-memory TTL). 404 if no `shortcut_token` in meta. |
| `GET /api/shortcut/file?id=` | prepare-id | — | Binary plist `.shortcut` file. Headers: `Content-Type: application/x-apple-shortcut`, `Content-Disposition: attachment; filename="FundsFlee.shortcut"`, `Cache-Control: no-store`. 400 no id; 401 expired. |
| `GET /api/shortcut/install.shortcut?id=` | prepare-id | — | Identical to `/api/shortcut/file` (duplicate route — iOS needs `.shortcut` URL suffix). Build from one shared implementation. |

## Misc

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/push/subscribe` | session | PushSubscription JSON | `{ ok: true }` — stored in meta `push_subscription` |
| `DELETE /api/push/subscribe` | session | — | `{ ok: true }` — clears meta value |
| `POST /api/share` | session (redirect on fail) | multipart from PWA share target: `text?`, `url?`, `image?` | **Always 302 redirect** (share-target requirement): no session → `/?share=auth_required`; image → upload receipt, → `/transactions?shared_receipt=1`; text/url → `/capture?tab=paste&text=<enc>`; else → `/capture` |

---

## Implementation notes for the Python port

1. **Logging:** every session route logs `METHOD /path {status, ms}` on success, error + ms on failure (see `withSession.ts`).
2. **Fire-and-forget jobs** (`enrich`, `parse/*/process`, `email/fetch`, `duplicates/detect`, statement/text async): respond immediately; job continues via `asyncio.create_task`. Job state lives in the sheet (status columns / meta keys), never in server memory — except the shortcut prepare-ID store (in-memory dict with 10-min TTL, single process is fine).
3. **Long timeouts:** receipts/enrich up to 480 s, email/cron up to 300 s, statement parse 120 s — uvicorn must not kill these; no proxy timeouts below that.
4. **`data/cron-session.json`** format is reused as-is (already deployed).
5. **Env keys:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET` (must keep current value!), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `AI_PROVIDER`, `AI_MODEL?`, `OPENCODE_API_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, new: `SESSION_SECRET`, `BASE_URL`.
6. The duplicated `shortcut/file` + `shortcut/install.shortcut` handlers collapse into one function with two route decorators.

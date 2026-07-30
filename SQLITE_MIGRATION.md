# SQLite as the database, Sheets as the mirror

## Why

Every problem below came from one cause — the database is a spreadsheet behind a
60-requests-per-minute quota:

- transactions are paginated at 200 rows, so the dashboard needs `loadAll`
- "This year" under-reports once a year holds more than one page
- `record_parsed_email` re-read a whole tab per message
- the meta tab spent a read per write
- tapping filter chips returned 429
- `_get_all_rows_sync` returned `[]` on failure and nearly reimported the
  entire history

None of these are hard problems. They are all the same problem. Moving the
authoritative store to SQLite removes the class, rather than the instances.

**Concretely:** a 2000-message import currently costs roughly 4000 Sheets
requests and is paced by quota. Afterwards it costs **zero during the run**, and
the syncer pushes the result in one or two batched calls.

## The contract

**The sheet is a mirror. It is for looking at, never for editing.**

Everything else follows from that. Sync is one-way, local → sheet. There is no
conflict resolution because conflicts cannot exist. A hand-edit to the sheet is
overwritten the next time that row is pushed, and the periodic reconcile heals
the rest.

The frontend is unaffected: it talks to FastAPI, not to Sheets.

## Storage

One SQLite file, `data/fundsflee.db`, beside `data/users.json` — same directory,
same backup story, same 0600 treatment.

**Tenant key is `sheet_id`.** It is already threaded through all 33 call sites
and every `app/sheets` function takes it. Reusing it as the tenant column means
signatures barely change and no new identity has to be invented.

### Tables

| table | mirrored to sheet | note |
|---|---|---|
| `transactions` | yes | the 27 columns from `transaction_schema.COLS` |
| `categories` | yes | small, rarely changes |
| `meta` | yes | config; cheap to mirror, useful to see |
| `item_suggestions` | yes | |
| `parsed_emails` | **no** | import bookkeeping you never read — a whole tab of quota disappears |
| `analysis_cache` | **no** | derived; regenerate rather than mirror |
| `sync_state` | n/a | per `(sheet_id, table)`: `hydrated_at`, `last_push_at`, `last_error` |

Dropping `parsed_emails` and `analysis_cache` from the sheet is a real
simplification, not just a saving. Both exist in Sheets today only because
Sheets was the only place to put them.

### Columns every mirrored table carries

```sql
sheet_id    TEXT NOT NULL,     -- tenant
id          TEXT NOT NULL,     -- existing stable id
sheet_row   INTEGER,           -- row it occupies in the sheet; NULL until pushed
dirty       INTEGER NOT NULL DEFAULT 1,
updated_at  TEXT NOT NULL,
PRIMARY KEY (sheet_id, id)
```

`dirty` is a column, not in-memory state, so a restart mid-sync loses nothing.
`sheet_row` is what makes an update a targeted range write instead of a search.

Column definitions are generated from the existing header tuples
(`transaction_schema.COLS`, `headers.py`) so the schema cannot drift from the
sheet layout.

## The sync cycle

An APScheduler interval job, alongside the existing daily cron in
`app/cron/scheduler.py`. Every 30s:

1. Find `sheet_id`s with any dirty row. **None → return without a single API
   call.** An idle app makes no requests at all.
2. For each, get an access token the way `run_daily_jobs` already does —
   `refresh_google_token(stored["refreshToken"])`. (That path currently serves
   one stored user; the syncer needs it per user with dirty rows.)
3. Per table:
   - **new rows** (`sheet_row IS NULL`) → one `values.append`. The response's
     `updatedRange` gives the block; row numbers follow by offset since order is
     preserved.
   - **changed rows** (`dirty=1, sheet_row NOT NULL`) → one
     `values.batchUpdate` carrying every row's range.
   - **deletes** → there are none. Soft-delete is already a field update.
4. Clear `dirty` only after the call succeeds. A failure leaves the flag set, so
   the next cycle retries; no separate queue.

**Cost: at most two requests per table per cycle, regardless of row count.**

Failures back off and are surfaced — `last_error` and `last_push_at` feed a
"last synced N minutes ago" line in settings, the same way `emailsGaveUp` is
surfaced now. Silent drift is the failure mode worth guarding against.

## Use cases

The states that matter are the combinations of *what is local* and *what is in
the sheet*.

| # | local | sheet | action |
|---|---|---|---|
| 1 | empty | empty | fresh onboarding — create both, as today |
| 2 | **empty** | **has data** | **hydrate**: read the sheet once into SQLite, set `sheet_row` from the row positions, mark clean. Never push in this state. |
| 3 | has data | has data, local dirty | normal: push the delta |
| 4 | has data | has data, clean | no API call |
| 5 | has data | tab missing / empty | sheet was reset or deleted → clear `sheet_row` for that table and re-append everything |
| 6 | has data | unreadable (429, network, auth) | do nothing, stay dirty, retry, surface staleness |
| 7 | has data | hand-edited | that row is overwritten on its next push; the rest heals on the periodic full reconcile |

**Case 2 is the one to get right.** It covers a rebuilt VPS, a lost disk, and
the first deploy of this change — every existing user starts here. Hydration is
recorded as `hydrated_at` in `sync_state` so it runs exactly once per
`(sheet_id, table)` and can never re-run over live local data.

Two further cases worth naming:

- **Google token revoked or expired** — the app keeps working entirely. Reads
  and writes are local; sync resumes when the token does. This is a new
  capability, not just a saving.
- **Sheet deleted by the user in Drive** — distinguish from case 6 by the error.
  A 404 means recreate; a 429 means retry.

## Safety rules

These are the ones that can destroy data, so they are invariants, not
guidelines:

1. **Never push when the local table is empty for that `sheet_id` and the sheet
   is not.** An empty local store means "not hydrated yet", never "the user
   deleted everything". Without this, one failed hydration blanks the sheet.
2. **Never delete sheet rows.** Soft-delete only, as today.
3. **Hydration runs only when local is empty and `hydrated_at` is unset.**
4. **Clear `dirty` only after a confirmed successful write.**
5. **A read failure must raise, never return empty.** Exactly the bug fixed in
   `33ff493`; the same rule applies to hydration.

## Phases

Each phase is independently deployable and testable, which matters because this
is running live.

**Phase 0 — schema, no behaviour change.** `app/db/` with connection handling
(WAL, `aiosqlite` or thread-offload), schema generated from the header tuples,
migrations. Nothing reads it yet.

**Phase 1 — hydrate.** One-time import per `sheet_id`. Verify by comparing row
counts and a checksum of ids against the sheet. Still nothing reads it.

**Phase 2 — reads move to SQLite.** Behind the existing `app/sheets` facade, so
call sites do not change. Reads are idempotent, so this is the low-risk half and
can be verified by diffing against the sheet. Writes still go directly to
Sheets.

*This phase alone kills the 200-row page, `loadAll`, the "This year" bug, and
every read-side quota problem.*

**Phase 3 — writes move to SQLite + the syncer.** Writes become local plus a
dirty flag; the syncer becomes the only thing that writes to Sheets.

**Phase 4 — remove the scaffolding.** Delete the direct-write paths, the row
index caches in `transactions.py` and `parsed_emails.py`, and the
quota-driven batching contortions. Drop `parsed_emails` and `analysis_cache`
from the sheet.

## What this deletes

- `loadAll`, `MAX_ALL_PAGES`, `ALL_PAGE_SIZE`, the partial-history UI state
- the 200-row page and its pagination maths in `_get_transactions_sync`
- `_row_index_cache` and `_index_cache`
- `with_sheets_retry` at every call site — only the syncer needs it
- the "This year is wrong past 200 rows" bug, without writing an aggregate endpoint
- `deduplicate_new_transactions`'s candidate scan, which becomes a SQL query,
  and with it most of the reason `MAX_AI_CALLS` exists

## Risks

- **The VPS disk becomes the database.** Today a server loss costs nothing.
  After this it costs up to one sync interval. Backup stops being optional —
  and `data/users.json` is already in that category, currently unbacked.
- **Schema drift** between SQLite and the sheet — mitigated by generating both
  from one definition.
- **Multiple workers** would need care around SQLite writes. The current single
  uvicorn worker makes this a non-issue; it stops being one if that changes.

## Out of scope

Two-way sync. Editing the sheet by hand is not supported and this plan assumes
it never becomes supported. If that changes, essentially all of the above
changes with it.

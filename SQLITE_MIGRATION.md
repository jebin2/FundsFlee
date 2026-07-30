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

## Storage — the database *is* the spreadsheet

**One SQLite file per spreadsheet**: `data/sheets/{sheet_id}.db`, beside
`data/users.json` — same directory, same backup story, same 0600 treatment.

That is what makes the 1:1 hold. A single shared database would need a
`sheet_id` column on every table, and the tables would stop resembling the tabs.
One file per sheet means:

- **table name = tab name**
- **column = column, in the same order**
- **row = row** — table row *n* is sheet row *n + 1* (the header is row 1)
- no tenant column, because the file *is* the tenant

It also makes deleting a user's data a file delete, and backup a directory copy.

### Tables

| table | mirrored to sheet | note |
|---|---|---|
| `transactions` | yes | the 27 columns from `transaction_schema.COLS`, in COLS order |
| `categories` | yes | |
| `meta` | yes | key/value, as the tab is |
| `item_suggestions` | yes | |
| `parsed_emails` | **no** | import bookkeeping you never read — a whole tab of quota disappears |
| `analysis_cache` | **no** | derived; regenerate rather than mirror |

Every mirrored table carries **exactly the tab's columns and nothing else**. All
values are `TEXT`, because that is what the sheet holds; typing happens in the
app layer, as it does today.

Column definitions are generated from the existing header tuples
(`transaction_schema.COLS`, `headers.py`), so one definition drives the SQLite
schema, the sheet header, and the sync ranges. They cannot drift apart.

### Where the bookkeeping lives

Sync state cannot go on the data tables without breaking the resemblance, so it
goes in two sidecar tables prefixed `_`, which are never mirrored:

```sql
_dirty(tab TEXT, row_num INTEGER, PRIMARY KEY (tab, row_num))
_sync(tab TEXT PRIMARY KEY, hydrated_at TEXT, last_push_at TEXT,
      last_row_pushed INTEGER, last_error TEXT)
```

`_dirty` is populated by **SQLite triggers** on every mirrored table:

```sql
CREATE TRIGGER transactions_ai AFTER INSERT ON transactions
  BEGIN INSERT OR IGNORE INTO _dirty VALUES ('transactions', new.rowid); END;
CREATE TRIGGER transactions_au AFTER UPDATE ON transactions
  BEGIN INSERT OR IGNORE INTO _dirty VALUES ('transactions', new.rowid); END;
```

So application code never marks anything dirty — it writes a row and the
tracking happens underneath. There is no way to forget it, which is the usual
way a sync layer starts silently dropping changes.

### No `sheet_row` column is needed

Because rows are only ever appended and never removed — soft-delete is already
a field update, not a deletion — **a row's position is its identity**. Sheet row
is `rowid + 1`, always. That is precisely why the 1:1 model is worth having:
the mapping that would otherwise need a column and a cache is implied by the
ordering.

This does mean `rowid` must be stable, so `VACUUM` is off the table and the
tables are `WITHOUT ROWID`-free (they need real rowids).

## The sync cycle

An APScheduler interval job, alongside the existing daily cron in
`app/cron/scheduler.py`. Every 30s:

1. Find databases with a non-empty `_dirty`. **None → return without a single
   API call.** An idle app makes no requests at all.
2. For each, get an access token the way `run_daily_jobs` already does —
   `refresh_google_token(stored["refreshToken"])`. (That path currently serves
   one stored user; the syncer needs it per user with dirty rows.)
3. Per dirty tab, read the dirty row numbers and collapse them into ranges:
   - **contiguous rows past `last_row_pushed`** → one `values.update` over
     `tab!A{first}:{last}` with those rows' values. This is the bulk import
     case: 2000 new rows go out as one request.
   - **scattered edits** → one `values.batchUpdate` carrying a range per run of
     adjacent rows. Editing one transaction is one range.
   - **deletes** → there are none.
4. Clear those `_dirty` entries only after the call succeeds. A failure leaves
   them, so the next cycle retries; no separate queue, no lost writes.

Because row number is `rowid + 1`, every range is computed arithmetically —
nothing has to be looked up, in the sheet or in a cache.

**Cost: one or two requests per dirty tab per cycle, regardless of row count.**

### Full rewrite as the repair path

Separately from the delta push, a **full rewrite** — dump the whole table over
`tab!A2:{last}` — is the repair primitive. It is what runs when the sheet was
reset (case 5), and what a periodic reconcile uses to heal hand-edits (case 7)
and any drift.

It is not the normal path because `transactions` grows without bound and
rewriting thousands of rows on every edit is wasteful; large rewrites are
chunked. But it is the thing to reach for whenever the sheet is suspect, and
because the table is a literal image of the tab, it is a dump-and-write with no
reconciliation logic at all.

Failures back off and are surfaced — `last_error` and `last_push_at` feed a
"last synced N minutes ago" line in settings, the same way `emailsGaveUp` is
surfaced now. Silent drift is the failure mode worth guarding against.

## Use cases

The states that matter are the combinations of *what is local* and *what is in
the sheet*.

| # | local | sheet | action |
|---|---|---|---|
| 1 | empty | empty | fresh onboarding — create both, as today |
| 2 | **empty** | **has data** | **hydrate**: read the sheet once, insert rows in sheet order so `rowid` lines up, clear `_dirty`, set `hydrated_at`. Never push in this state. |
| 3 | has data | has data, local dirty | normal: push the delta |
| 4 | has data | has data, clean | no API call |
| 5 | has data | tab missing / empty | sheet was reset or deleted → recreate the tab with its header and full-rewrite the table into it |
| 6 | has data | unreadable (429, network, auth) | do nothing, leave `_dirty` alone, retry, surface staleness |
| 7 | has data | hand-edited | that row is overwritten on its next push; the rest heals on the periodic full reconcile |

**Case 2 is the one to get right.** It covers a rebuilt VPS, a lost disk, and
the first deploy of this change — every existing user starts here. Hydration is
recorded as `hydrated_at` in `_sync` so it runs exactly once per tab and can
never re-run over live local data. It must insert in sheet order and skip no
rows, because a gap would shift every subsequent row's identity.

Two further cases worth naming:

- **Google token revoked or expired** — the app keeps working entirely. Reads
  and writes are local; sync resumes when the token does. This is a new
  capability, not just a saving.
- **Sheet deleted by the user in Drive** — distinguish from case 6 by the error.
  A 404 means recreate; a 429 means retry.

## Safety rules

These are the ones that can destroy data, so they are invariants, not
guidelines:

1. **Never push when the local table is empty and the sheet is not.** An empty local store means "not hydrated yet", never "the user
   deleted everything". Without this, one failed hydration blanks the sheet.
2. **Never delete sheet rows.** Soft-delete only, as today.
3. **Hydration runs only when local is empty and `hydrated_at` is unset.**
4. **Clear `_dirty` entries only after a confirmed successful write.**
5. **Never delete a local row, and never `VACUUM`.** Row position is row
   identity; renumbering silently repoints every row at the wrong sheet line.
6. **A read failure must raise, never return empty.** Exactly the bug fixed in
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
- `_row_index_cache` and `_index_cache` — position is arithmetic now
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
- **Row identity is positional**, which is what makes the 1:1 model cheap and
  also what makes a stray `DELETE` or `VACUUM` corrupting. Enforced by rule 5
  and by there being no delete path in the app.
- **Multiple workers** would need care around SQLite writes. The current single
  uvicorn worker makes this a non-issue; it stops being one if that changes.

## Out of scope

Two-way sync. Editing the sheet by hand is not supported and this plan assumes
it never becomes supported. If that changes, essentially all of the above
changes with it.

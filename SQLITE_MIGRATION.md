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

**Every tab, every column, every row.** No exceptions, no local-only tables, no
derived data left out:

| table | columns |
|---|---|
| `transactions` | the 27 of `transaction_schema.COLS`, in COLS order |
| `categories` | `CATEGORIES_HEADERS` |
| `analysis_cache` | `ANALYSIS_CACHE_HEADERS` |
| `item_suggestions` | `ITEM_SUGGESTIONS_HEADERS` |
| `meta` | `META_HEADERS` |
| `parsed_emails` | `PARSED_EMAILS_HEADERS` |

An earlier draft kept `parsed_emails` and `analysis_cache` local-only to save
quota. That reasoning does not survive this design: once the syncer batches,
`parsed_emails` costs one request per cycle rather than one per message. The
saving was worth nothing and the asymmetry cost real clarity — a partial mirror
means every question about the sheet needs qualifying with "except those two".

Every mirrored table carries **exactly the tab's columns and nothing else**. All
values are `TEXT`, because that is what the sheet holds; typing happens in the
app layer, as it does today.

Column definitions are generated from the existing header tuples in
`headers.py` and `transaction_schema.COLS`, so one definition drives the SQLite
schema, the sheet header, and the sync ranges. They cannot drift apart.

### Deletion is soft, everywhere

There is **no hard delete in either store**. A removed transaction is a field
update — `is_deleted` — exactly as today, so the row keeps its position in both
the table and the tab.

This is not only a data-retention choice. It is what makes row position stable,
which is what makes the position-is-identity mapping below work at all.

### Where the bookkeeping lives

`_outbox` and `_sync` live in the mirror file, underscore-prefixed. All six tabs
are still exact mirrors; these two are visibly not tabs.

```sql
_outbox(tab TEXT, row_num INTEGER)          -- append-only; rowid is the sequence
_sync(tab TEXT PRIMARY KEY, hydrated_at TEXT, last_push_at TEXT,
      last_row_pushed INTEGER, last_error TEXT)
```

They were going to live in a separate `{sheet_id}.sync.db` so the mirror held
nothing but tabs. **SQLite forbids qualified table names inside triggers**, so
that design cannot have both a separate file and automatic marking — and
atomicity settled which to give up. A mark in another file cannot commit with
the row it describes, because WAL mode provides no cross-database atomic
commit, so a crash between the two would leave a row that never syncs.

Marking is done by triggers on every mirrored table:

```sql
CREATE TRIGGER transactions_dirty_insert AFTER INSERT ON transactions
  BEGIN INSERT INTO _outbox VALUES ('transactions', new.rowid + 1); END;
```

Application code never marks anything dirty — it writes a row and the tracking
happens underneath, in the same transaction. There is no way for a code path to
forget, which is the usual way a sync layer starts silently dropping changes.

There is **no DELETE trigger**, because there is no delete.

### No `sheet_row` column is needed

Because rows are only ever appended and never removed — see soft delete above —
**a row's position is its identity**. Sheet row
is `rowid + 1`, always. That is precisely why the 1:1 model is worth having:
the mapping that would otherwise need a column and a cache is implied by the
ordering.

This does mean `rowid` must be stable, so `VACUUM` is off the table and the
tables are `WITHOUT ROWID`-free (they need real rowids).

## One schema, one engine

This is the part that matters more than the storage choice.

Today each tab has its own module — `transactions.py`, `categories.py`,
`meta.py`, `parsed_emails.py`, `suggestions.py`, `analysis_cache.py`, 1732 lines
— and each re-implements the same three operations: read all rows, append rows,
update a row by id. They drifted apart, and the drift is where the bugs lived:

- `parsed_emails` swallowed every exception and returned `[]`; `transactions`
  did not
- `meta` was the only module with no retry wrapper
- `transactions` had a row-index cache; `parsed_emails` had to grow one later
- `transaction_schema` had `A2:A5000`, silently ignoring row 5001

Six implementations of one idea, each with a different subset of the fixes.

**So: one declarative registry, and generic code driven by it. No per-tab
branches anywhere.**

### The registry

`app/sheets/init.py` already has this, as a private detail:

```python
_TABS = (
    ("transactions", EXPECTED_HEADERS),
    ("categories", CATEGORIES_HEADERS),
    ...
)
_HEADER_WRITES = [(f"{tab}!A1:{_col_letter(len(h))}1", h) for tab, h in _TABS]
_DATA_RANGES  = [f"{tab}!A2:{_col_letter(len(h))}" for tab, h in _TABS]
```

Its comment records exactly why it exists: *"a hand-typed A2:Z is how column AA
came to be skipped by both the header write and the reset."* The pattern is
already proven — it just needs promoting from init's private helper to the one
definition everything reads.

```python
@dataclass(frozen=True)
class TabSpec:
    name: str                  # tab name == table name
    columns: tuple[str, ...]   # header tuple, in sheet order
    key: str                   # the column holding the stable id

TABS = (
    TabSpec("transactions",    EXPECTED_HEADERS,         key="id"),
    TabSpec("categories",      CATEGORIES_HEADERS,       key="id"),
    TabSpec("analysis_cache",  ANALYSIS_CACHE_HEADERS,   key="id"),
    TabSpec("item_suggestions", ITEM_SUGGESTIONS_HEADERS, key="key"),
    TabSpec("meta",            META_HEADERS,             key="key"),
    TabSpec("parsed_emails",   PARSED_EMAILS_HEADERS,    key="email_id"),
)
```

### What is generated from it

Everything. None of these is written per tab:

| derived | from |
|---|---|
| `CREATE TABLE` DDL | `name`, `columns` |
| the dirty triggers | `name` |
| sheet header range and values | `name`, `columns` |
| sheet data range `A2:{last}` | `name`, `columns` |
| `INSERT` / `UPDATE` / `SELECT` SQL | `columns`, `key` |
| hydration | the whole spec |
| the sync push | the whole spec |
| init and reset | the whole spec |

### The engine

One generic repository, six instances:

```python
class Repo:
    def __init__(self, conn, spec: TabSpec): ...
    def all(self) -> list[dict]: ...
    def get(self, key: str) -> dict | None: ...
    def insert(self, row: dict) -> int: ...        # returns rowid
    def insert_many(self, rows: list[dict]): ...
    def update(self, key: str, fields: dict): ...
```

Hydration, push, init and reset are each **one function taking a `TabSpec`**,
called in a loop over `TABS`. Adding a tab is one line in the registry; adding a
column is one entry in a header tuple.

### Where per-tab code is still allowed

Only where there is genuine domain logic, and only as a thin adapter over the
generic repo — never re-implementing plumbing:

- `row_to_transaction` typing and date normalisation
- the transaction id/date validation in `transaction_schema`
- `meta`'s key/value convenience wrappers

The rule: **if it is about rows and ranges, it is generic; if it is about what a
field means, it is domain.**

### No dirty checks in application code

Application code never reads or writes `_outbox`. Triggers fill it, the syncer
clears it. There is no `if dirty` in a service, a job, or a router — the same
way no code today decides whether to flush a database transaction.

## The sync cycle

An APScheduler interval job in `app/cron/sync_scheduler.py`, alongside the
existing daily cron. Every 60s:

1. Find databases with a non-empty `_outbox`. **None → return without a single
   API call.** An idle app makes no requests at all.
2. For each, get an access token. The work list comes from the disk rather than
   from a list of logged-in users, because after a restart nobody is signed in
   and the changes still have to go out. Two sources, in order: a user seen this
   process (`remember_owner`, called from `require_session` — the auth library
   already holds and refreshes their credentials), then the stored cron session,
   which is what makes an unattended server work. A sheet with neither stays
   queued; nothing is lost by waiting.
3. Per tab, claim everything queued up to a high-water `rowid`, collapse the row
   numbers into contiguous runs, and write each run as one `ValueRange` in a
   single `values.batchUpdate`. Updates and appends are the same operation —
   whole rows written at their own addresses.
4. Clear the claimed entries only after the call succeeds. A failure leaves them,
   so the next cycle retries. Failures are isolated per tab: a quota error on
   `transactions` must not strand a two-row settings save.

Because row number is `rowid + 1`, every range is computed arithmetically —
nothing is looked up, in the sheet or in a cache.

**Measured cost:** a 50-message email import makes **zero** API calls while it
runs, and goes out in **5 requests** on the next tick. A first push of 5000 rows
is 4 requests. One edit on a 5050-row sheet is 2. An idle tick is 0.

### Why the outbox is a queue, not a set of marks

`_dirty` was a deduped `(tab, row_num)` table. That cannot be claimed safely: an
upsert leaves the row's `rowid` where it was, so a write landing *during* a push
would have its mark deleted by the push it was not part of — and that change
would never reach the sheet.

`_outbox` is append-only, and its implicit `rowid` is the sequence number. The
syncer claims up to a high-water mark, pushes, and deletes only up to that mark.
A write that lands mid-push gets a higher `rowid` and survives. It grows only
within one interval, and every push empties it.

### Why whole rows, and why exact addresses

Every push writes **whole rows**, not changed cells. That is what makes a push
idempotent: a retry after a 429 rewrites the same values rather than having to
work out what the previous attempt managed to send. It is also why a failure can
simply leave the queue alone.

Rows are addressed **exactly** (`tab!A{first}:{last}`), never with
`values.append`. `append` positions itself after the last row *holding data*,
which is not the same as the last row the mirror knows about: blanking the last
category row moves the landing spot up by one and puts the two stores
permanently out of step. Exact addressing has one cost — `values.update` refuses
a range past the grid, and a new spreadsheet stops at 1000 rows — so the syncer
tracks each tab's capacity and grows it with `appendDimension` when needed. The
capacity is read once per process and then tracked through its own growth; a
stale reading heals by re-reading rather than stalling.

### One interpreted column

`valueInputOption` is per request, so the transactions `date` column is written
in a second request as `USER_ENTERED` while everything else goes `RAW`. Doing
the whole row as `USER_ENTERED` would evaluate a merchant like `=Zomato` as a
formula and reformat every ISO timestamp on it. Which columns those are is
declared on the `TabSpec` (`user_entered`), not branched on in the syncer.

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
| 2 | **empty** | **has data** | **hydrate**: read the sheet once, insert rows in sheet order so `rowid` lines up, clear `_outbox`, set `hydrated_at`. Never push in this state. |
| 3 | has data | has data, local dirty | normal: push the delta |
| 4 | has data | has data, clean | no API call |
| 5 | has data | tab missing / empty | sheet was reset or deleted → recreate the tab with its header and full-rewrite the table into it |
| 6 | has data | unreadable (429, network, auth) | do nothing, leave `_outbox` alone, retry, surface staleness |
| 7 | has data | hand-edited | that row is overwritten on its next push; the rest heals on the periodic full reconcile |

### Case 2 in full: no local database

This is the bootstrap path and the one that must be exactly right, because
every existing user starts here and so does every rebuilt server.

On the first request for a `sheet_id` whose database file does not exist:

1. Create `data/sheets/{sheet_id}.db` and run the DDL generated from `TABS`.
2. For each `spec` in `TABS`, read `{spec.name}!A2:{last}` from the sheet and
   insert every row **in sheet order**, so `rowid` lines up with the sheet line.
   Rows are inserted verbatim — no parsing, no filtering, no skipping blanks in
   the middle, because a gap shifts the identity of everything below it.
3. Clear `_outbox` (the inserts fired the triggers) and set `hydrated_at`.
4. Verify: row count per tab matches, and a checksum of the key column matches.
   On mismatch, delete the file and fail loudly rather than serve half a
   database.

It is one function over the registry, not six. If the sheet is also empty this
is simply the onboarding path with nothing to copy, which is why cases 1 and 2
share the code.

**Hydration is triggered by the first write**, and every mirror call happens
*after* its sheet write has succeeded. That ordering matters: the sheet already
contains the write by then, so hydration copies it in, and applying it a second
time would duplicate the row. `mirror._ensure` reports whether it built the
mirror during this call, and the operation is skipped when it did.

Hydration is recorded as `hydrated_at` in `_sync` so it runs exactly once per
tab and can never re-run over live local data.

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
2. **Never delete a row in either store.** Soft-delete only, as today.
3. **Hydration runs only when local is empty and `hydrated_at` is unset.**
4. **Clear `_outbox` entries only after a confirmed successful write.**
5. **Never delete a local row, and never `VACUUM`.** Row position is row
   identity; renumbering silently repoints every row at the wrong sheet line.
6. **A read failure must raise, never return empty.** Exactly the bug fixed in
   `33ff493`; the same rule applies to hydration.

## Phases

Each phase is independently deployable and testable, which matters because this
is running live.

**Phase 0 — registry and engine, no behaviour change.** *(done — `app/db/`)* Promote `_TABS` to a
public `TabSpec` registry. `app/db/` with connection handling (WAL, `aiosqlite`
or thread-offload), DDL and triggers generated from the registry, and the
generic `Repo`. Nothing reads it yet. This phase is mostly deletion of
duplicated plumbing.

**Phase 1 — hydrate.** *(done — `app/db/hydrate.py`)* One generic function over
`TABS`: if the local database is missing, create it from the registry and fill
every tab from the sheet, in sheet order. Verified by row count and a checksum
of the key columns per tab; on mismatch the file is discarded and the failure is
loud. Hydrated rows are explicitly un-marked, since they came from the sheet and
are not pending changes. Still nothing reads it.

**Phase 2 — dual-write.** *(done — `app/db/mirror.py`, `app/db/verify.py`)*
Every sheet write is also applied locally. Reads are untouched, so this phase
cannot break anything a user sees, and it is the phase that produces evidence:
run the app normally, then `python scripts/verify_mirror.py` diffs every tab
cell for cell.

This corrects the original ordering, which had reads move first. That was
wrong — reads served from a mirror nothing updates go stale on the first write.
Dual-write has to come first.

Mirror failures are logged, not raised, **for this phase only**: the sheet is
still authoritative, so a missed local write costs drift, which verify detects,
and failing a user's save because the mirror hiccuped would be worse. That
inverts the moment reads move over.

**Phase 3 — reads move to SQLite.** *(done)* Behind the existing `app/sheets`
facade, so no call site outside it changed. `mirror.rows()` returns positional
lists in sheet order — the exact shape `values().get` returns — so each module
moved by replacing one read, and every parser downstream was left alone.

Mirror write failures became hard failures in the same change: while the mirror
served nothing, swallowing was right; now it would show a user their data
without their last change and call it success.

Gone with it: `_row_index_cache`, `_index_cache`, and the sheet reads inside
write paths (finding a meta key's row, a category's row, a transaction's row).

*Reads now cost nothing. The 200-row page is a slice, and "This year" is a
filter over the whole history rather than over page one.*

**Phase 3b — the syncer.** *(done — `app/db/sync.py`,
`app/cron/sync_scheduler.py`)* Writes land in the mirror and return; the sheet is
caught up on a 60s interval, plus once on clean shutdown. `app/sheets` no longer
touches the Sheets API on any data path — only `init.py` (create and reset),
`migrations.py` (tab and header structure), `hydrate.py` (in), `sync.py` (out)
and `verify.py` (audit) do.

Two things changed shape in this phase, both because the write ordering
reversed:

- `_dirty` became `_outbox` (see above). The old table is dropped on first open;
  nothing is lost, because while it was in use every write reached the sheet
  first.
- The bootstrap guard was **removed**. Phase 2 skipped the write that triggered
  hydration, because the sheet already contained it. It does not any more, so
  keeping that skip would silently drop the first write after every rebuild.

Also gone: `transaction_update_to_cells` / `fields_to_cells` / `letter`, which
existed to address individual sheet cells.

**Phase 4 — remove the scaffolding.** Dual-write is already gone with 3b. What
remains: fold the five per-tab modules into `Repo`, drop the quota-driven
batching contortions in the import job, and retire `verify_mirror.py` from its
role as a phase gate. Every tab stays in the sheet; nothing is dropped.

## What this deletes

- `loadAll`, `MAX_ALL_PAGES`, `ALL_PAGE_SIZE`, the partial-history UI state
- the 200-row page and its pagination maths in `_get_transactions_sync`
- `_row_index_cache` and `_index_cache` — position is arithmetic now
- five of the six per-tab sheet modules, replaced by one `Repo` over `TabSpec`
- `with_sheets_retry` at every call site — only the syncer needs it
- the "This year is wrong past 200 rows" bug, without writing an aggregate endpoint
- `deduplicate_new_transactions`'s candidate scan, which becomes a SQL query,
  and with it most of the reason `MAX_AI_CALLS` exists

## Risks

- **The VPS disk becomes the database.** Before this a server loss cost nothing.
  Now it costs up to one sync interval — 60 seconds of writes. Backup stops being optional —
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

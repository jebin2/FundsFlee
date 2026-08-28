"""DDL generated from the registry. Nothing here is written per tab.

Every column is TEXT because that is what a spreadsheet cell is; typing happens
in the app layer, as it does today. Identifiers are always quoted — parsed_emails
has a column literally called "from".

Bookkeeping was going to live in a separate ATTACHed file so the mirror held
tabs and nothing else. SQLite forbids qualified table names inside triggers, so
that design cannot have both a separate file and automatic marking. Atomicity
decided it: a mark written in a different file cannot commit with the row it
describes — WAL mode gives no cross-database atomic commit — so a crash between
the two would leave a row that never syncs. _outbox and _sync therefore live
beside the tabs, underscore-prefixed, and every one of the six tabs is still an
exact mirror.
"""
from app.db.registry import TABS, TabSpec


def q(identifier: str) -> str:
    """Quote an identifier. Not optional — "from" is a column name."""
    return '"' + identifier.replace('"', '""') + '"'


def create_table_sql(spec: TabSpec) -> str:
    cols = ",\n  ".join(f"{q(c)} TEXT NOT NULL DEFAULT ''" for c in spec.columns)
    # No PRIMARY KEY on the key columns: the sheet can hold duplicates and a
    # constraint here would reject rows the mirror is supposed to reproduce
    # faithfully. Uniqueness is the app's business, not the mirror's.
    return f"CREATE TABLE IF NOT EXISTS {q(spec.name)} (\n  {cols}\n)"


def key_index_sql(spec: TabSpec) -> str:
    cols = ", ".join(q(c) for c in spec.key)
    name = f"ix_{spec.name}_key"
    return f"CREATE INDEX IF NOT EXISTS {q(name)} ON {q(spec.name)} ({cols})"


def trigger_sql(spec: TabSpec) -> list[str]:
    """Dirty tracking lives underneath the application, not in it.

    Application code never marks a row dirty — it writes, and the trigger
    records it. There is no way for a code path to forget, which is the usual
    way a sync layer starts silently dropping changes.

    Dropped and recreated rather than IF NOT EXISTS, so a mirror built by an
    older version picks up the current trigger body on the next open. An
    IF NOT EXISTS trigger is invisible technical debt: it survives forever with
    whatever logic it was born with.
    """
    table = q(spec.name)
    out = []
    for event in ("INSERT", "UPDATE"):
        trg = q(f"{spec.name}_dirty_{event.lower()}")
        out.append(f"DROP TRIGGER IF EXISTS {trg}")
        out.append(
            f"CREATE TRIGGER {trg} AFTER {event} ON {table} BEGIN "
            f"INSERT INTO _outbox(tab, row_num) "
            f"VALUES ('{spec.name}', new.rowid + 1); END"
        )
    # No DELETE trigger, because there is no delete. Row position is row
    # identity; removing a row would repoint every row below it at the wrong
    # sheet line. Deletion is a field update.
    return out


SYNC_DDL: tuple[str, ...] = (
    # An append-only queue, not a set of marks — and the implicit rowid is the
    # sequence number that makes a push safe against concurrent writes. The
    # syncer claims everything up to a high-water rowid, pushes it, and deletes
    # only up to that mark; a write that lands mid-push gets a higher rowid and
    # survives. A deduped (tab, row_num) table could not express that: an
    # upsert leaves the rowid where it was, so the re-dirty would be deleted
    # along with the push it was not part of, and that change would never
    # reach the sheet.
    #
    # Growth is bounded by writes per push interval, and every push empties it.
    """CREATE TABLE IF NOT EXISTS _outbox (
  tab      TEXT NOT NULL,
  row_num  INTEGER NOT NULL   -- the SHEET row, rowid + 1, as everywhere else
)""",
    "CREATE INDEX IF NOT EXISTS ix_outbox_tab ON _outbox (tab)",
    """CREATE TABLE IF NOT EXISTS _sync (
  tab              TEXT PRIMARY KEY,
  hydrated_at      TEXT,
  last_push_at     TEXT,
  last_row_pushed  INTEGER NOT NULL DEFAULT 1,
  last_error       TEXT
)""",
    # The deduped predecessor. Dropping it loses nothing: while it was in use
    # every write went to the sheet first, so everything it held was already
    # there. Nothing after this phase creates it again.
    "DROP TABLE IF EXISTS _dirty",
)


def mirror_ddl() -> list[str]:
    """Every statement needed to build an empty mirror, in order.

    Bookkeeping first: the triggers write into _outbox, so it has to exist.
    """
    out: list[str] = list(SYNC_DDL)
    for spec in TABS:
        out.append(create_table_sql(spec))
        out.append(key_index_sql(spec))
        out.extend(trigger_sql(spec))
    return out

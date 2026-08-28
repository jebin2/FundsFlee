"""The one definition of what a tab is.

Six modules under app/sheets each re-implemented read-all, append and
update-by-id, and the drift between them is where the bugs lived: one swallowed
every exception and returned [], one had no retry wrapper, one had a row-index
cache the others had to grow later, one capped its range at row 5000.

So the shape of a tab is declared once, here, and everything else — the SQLite
DDL, the dirty triggers, the sheet ranges, the generated SQL, hydration and the
sync push — is derived from it. Adding a tab is one entry; adding a column is
one entry in a header tuple.

app/sheets/init.py proved this pattern with a private _TABS, added after a
hand-typed A2:Z skipped column AA in both the header write and the reset. This
is that idea promoted to the single source of truth.
"""
from dataclasses import dataclass

# Header names and order are LOAD-BEARING — they must stay in step with
# transaction_schema.COLS, and every range is derived from their count.
EXPECTED_HEADERS = (
    "id", "date", "time", "amount", "original_amount", "original_currency",
    "merchant", "category", "subcategory", "item_name", "payment_method",
    "tags", "notes", "source", "raw_input", "location",
    "is_duplicate", "duplicate_ref", "created_at", "updated_at",
    "status", "receipt_url", "receipt_id", "quantity", "deleted", "recurrence",
    "merge_id",
)

CATEGORIES_HEADERS       = ("id", "name", "parent_id", "color", "icon", "is_default", "created_at")
ANALYSIS_CACHE_HEADERS   = ("id", "period", "period_type", "summary_json", "generated_at", "status", "drive_file_id")
ITEM_SUGGESTIONS_HEADERS = ("key", "field", "current_val", "suggested", "source", "status", "updated_at")
META_HEADERS             = ("key", "value")
PARSED_EMAILS_HEADERS    = ("email_id", "from", "subject", "parsed_at", "status", "tx_ids", "attempts")


def col_letter(count: int) -> str:
    """1-based column count -> its letter (26 -> Z, 27 -> AA)."""
    out = ""
    while count:
        count, rem = divmod(count - 1, 26)
        out = chr(65 + rem) + out
    return out


@dataclass(frozen=True)
class TabSpec:
    """A tab, a table, and the mapping between them — they are the same thing.

    name    is both the sheet tab title and the SQLite table name.
    columns is the header row, in sheet order. Order is load-bearing: it fixes
            the column letters and therefore every range.
    key     is the column(s) identifying a row. Composite for item_suggestions,
            which is keyed by (key, field).
    user_entered
            columns the sheet must interpret rather than store verbatim. Only
            transactions.date: everything else goes RAW, because USER_ENTERED
            applies per cell and would evaluate a merchant like "=Zomato" as a
            formula and reformat the ISO timestamps in created_at/updated_at.
    """
    name: str
    columns: tuple[str, ...]
    key: tuple[str, ...]
    user_entered: tuple[str, ...] = ()

    @property
    def last_col(self) -> str:
        return col_letter(len(self.columns))

    @property
    def header_range(self) -> str:
        return f"{self.name}!A1:{self.last_col}1"

    @property
    def data_range(self) -> str:
        """Open-ended on purpose. A fixed ceiling is how edits past row 5000
        came to silently no-op."""
        return f"{self.name}!A2:{self.last_col}"

    def row_range(self, sheet_row: int) -> str:
        return f"{self.name}!A{sheet_row}:{self.last_col}{sheet_row}"

    def block_range(self, first_row: int, last_row: int) -> str:
        return f"{self.name}!A{first_row}:{self.last_col}{last_row}"

    def column_range(self, column: str, first_row: int, last_row: int) -> str:
        c = col_letter(self.columns.index(column) + 1)
        return f"{self.name}!{c}{first_row}:{c}{last_row}"

    def to_row(self, record: dict) -> list[str]:
        """Record -> a sheet/SQLite row, in column order. Missing fields become
        empty strings, never None, because the sheet has no concept of null."""
        return ["" if record.get(c) is None else str(record[c]) for c in self.columns]


TABS: tuple[TabSpec, ...] = (
    TabSpec("transactions", EXPECTED_HEADERS, key=("id",),
            user_entered=("date",)),
    TabSpec("categories", CATEGORIES_HEADERS, key=("id",)),
    TabSpec("analysis_cache", ANALYSIS_CACHE_HEADERS, key=("id",)),
    TabSpec("item_suggestions", ITEM_SUGGESTIONS_HEADERS, key=("key", "field")),
    TabSpec("meta", META_HEADERS, key=("key",)),
    TabSpec("parsed_emails", PARSED_EMAILS_HEADERS, key=("email_id",)),
)

TAB_BY_NAME: dict[str, TabSpec] = {spec.name: spec for spec in TABS}


def spec(name: str) -> TabSpec:
    return TAB_BY_NAME[name]

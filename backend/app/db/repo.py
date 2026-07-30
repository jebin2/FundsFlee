"""One repository, six tabs.

Every statement is generated from the TabSpec, so there is no per-tab SQL and
no per-tab branch. What used to be six near-identical modules — each with its
own subset of the bug fixes — is this file.
"""
import sqlite3

from app.db.registry import TabSpec
from app.db.schema import q

# Exposed as _row so it cannot collide with a real column: sheet row is
# rowid + 1, always, because rows are only appended and soft-deleted. That
# arithmetic is what replaces the row-index caches.
ROW_FIELD = "_row"


class Repo:
    def __init__(self, conn: sqlite3.Connection, spec: TabSpec):
        self.conn = conn
        self.spec = spec

    # --- reading -----------------------------------------------------------

    def _select(self) -> str:
        cols = ", ".join(q(c) for c in self.spec.columns)
        return f"SELECT rowid, {cols} FROM {q(self.spec.name)}"

    def _to_dict(self, row: sqlite3.Row) -> dict:
        out = {c: row[c] for c in self.spec.columns}
        out[ROW_FIELD] = row["rowid"] + 1   # +1 for the header
        return out

    def all(self) -> list[dict]:
        cur = self.conn.execute(f"{self._select()} ORDER BY rowid")
        return [self._to_dict(r) for r in cur.fetchall()]

    def where(self, sql: str, params: tuple = ()) -> list[dict]:
        """Escape hatch for domain queries — date ranges, status filters. The
        caller supplies a WHERE body only; the projection stays generic."""
        cur = self.conn.execute(f"{self._select()} WHERE {sql} ORDER BY rowid", params)
        return [self._to_dict(r) for r in cur.fetchall()]

    def _key_clause(self, key: dict) -> tuple[str, tuple]:
        if set(key) != set(self.spec.key):
            raise ValueError(
                f"{self.spec.name} is keyed by {self.spec.key}, got {tuple(key)}")
        clause = " AND ".join(f"{q(c)} = ?" for c in self.spec.key)
        return clause, tuple(key[c] for c in self.spec.key)

    def get(self, **key) -> dict | None:
        clause, params = self._key_clause(key)
        rows = self.where(clause, params)
        return rows[0] if rows else None

    def count(self) -> int:
        return self.conn.execute(
            f"SELECT COUNT(*) FROM {q(self.spec.name)}").fetchone()[0]

    # --- writing -----------------------------------------------------------

    def insert(self, record: dict) -> int:
        """Returns the sheet row the record landed on."""
        return self.insert_many([record])[0]

    def insert_many(self, records: list[dict]) -> list[int]:
        if not records:
            return []
        cols = ", ".join(q(c) for c in self.spec.columns)
        marks = ", ".join("?" for _ in self.spec.columns)
        sql = f"INSERT INTO {q(self.spec.name)} ({cols}) VALUES ({marks})"

        rows = []
        cur = self.conn.cursor()
        for record in records:
            cur.execute(sql, self.spec.to_row(record))
            rows.append(cur.lastrowid + 1)
        return rows

    def update(self, fields: dict, **key) -> int:
        """Update the keyed row. Returns rows affected — 0 means no such row,
        which callers should treat as a failure rather than a no-op."""
        unknown = set(fields) - set(self.spec.columns)
        if unknown:
            raise ValueError(f"{self.spec.name} has no column(s) {sorted(unknown)}")
        if not fields:
            return 0

        clause, key_params = self._key_clause(key)
        assignments = ", ".join(f"{q(c)} = ?" for c in fields)
        values = tuple("" if v is None else str(v) for v in fields.values())
        cur = self.conn.execute(
            f"UPDATE {q(self.spec.name)} SET {assignments} WHERE {clause}",
            values + key_params,
        )
        return cur.rowcount

    def update_row(self, sheet_row: int, fields: dict) -> int:
        """Update by position, for callers that already know the row."""
        unknown = set(fields) - set(self.spec.columns)
        if unknown:
            raise ValueError(f"{self.spec.name} has no column(s) {sorted(unknown)}")
        assignments = ", ".join(f"{q(c)} = ?" for c in fields)
        values = tuple("" if v is None else str(v) for v in fields.values())
        cur = self.conn.execute(
            f"UPDATE {q(self.spec.name)} SET {assignments} WHERE rowid = ?",
            values + (sheet_row - 1,),
        )
        return cur.rowcount

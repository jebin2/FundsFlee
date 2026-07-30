"""SQLite mirror of the spreadsheet. See SQLITE_MIGRATION.md.

Phase 0: the registry, the generated schema and the generic repository. Nothing
reads or writes through this yet — the sheets modules are still authoritative.
"""
from app.db.connection import DB_DIR, connect, mirror_exists
from app.db.registry import TABS, TAB_BY_NAME, TabSpec, col_letter, spec
from app.db.repo import ROW_FIELD, Repo

__all__ = [
    "DB_DIR",
    "ROW_FIELD",
    "Repo",
    "TABS",
    "TAB_BY_NAME",
    "TabSpec",
    "col_letter",
    "connect",
    "mirror_exists",
    "spec",
]

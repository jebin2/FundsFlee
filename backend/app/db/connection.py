"""The only way to open a mirror database.

Creating the schema is idempotent, so this doubles as the "does the mirror
exist" bootstrap. The triggers that record dirty rows are installed here, which
is why nothing else should be opening these files for writing.

sqlite3 from the stdlib rather than aiosqlite: every existing sheets module
already runs its blocking calls through asyncio.to_thread, so this matches the
codebase and adds no dependency.
"""
import re
import sqlite3
from pathlib import Path

from app.config import settings
from app.db.schema import mirror_ddl

# Beside data/users.json — same directory, same backup story.
DB_DIR = Path(settings.user_store_file).parent / "sheets"

# Google file ids are URL-safe base64. Anything else is not a sheet id and has
# no business becoming a path.
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

# The DDL is idempotent but not free — two dozen statements. Once reads come
# from the mirror, connect() runs on every query, so it is memoised per process.
_schema_ready: set[str] = set()


def mirror_path(sheet_id: str) -> Path:
    if not _SAFE_ID.match(sheet_id):
        raise ValueError(f"refusing to open a database for unsafe id: {sheet_id!r}")
    return DB_DIR / f"{sheet_id}.db"


def discard_mirror(sheet_id: str) -> None:
    """Remove the database and its WAL sidecars. Used when hydration fails —
    a half-populated mirror would be pushed back over the sheet."""
    base = mirror_path(sheet_id)
    for suffix in ("", "-wal", "-shm"):
        base.with_name(base.name + suffix).unlink(missing_ok=True)
    _schema_ready.discard(str(base))


def mirror_exists(sheet_id: str) -> bool:
    """False means "not hydrated yet", never "the user deleted everything".
    The distinction is what stops an empty local store blanking the sheet."""
    return mirror_path(sheet_id).exists()


def connect(sheet_id: str) -> sqlite3.Connection:
    """Open the mirror, creating and migrating it if needed."""
    path = mirror_path(sheet_id)
    DB_DIR.mkdir(parents=True, mode=0o700, exist_ok=True)

    conn = sqlite3.connect(path, isolation_level=None)
    conn.row_factory = sqlite3.Row

    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")

    # Keyed by path, not sheet id: the same id under a different directory is a
    # different database, which is exactly what the tests do.
    key = str(path)
    if key not in _schema_ready:
        for stmt in mirror_ddl():
            conn.execute(stmt)
        _schema_ready.add(key)
        try:
            path.chmod(0o600)
        except OSError:
            pass

    return conn

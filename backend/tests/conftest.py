import os
import tempfile

# Must be set before app.core.auth is imported — keeps the FileUserStore
# used in tests away from the real data/users.json.
os.environ.setdefault("USER_STORE_FILE", os.path.join(tempfile.mkdtemp(), "users.json"))

import pytest

import app.db.connection as _conn_mod
import app.db.mirror as _mirror
from app.db import Repo, connect, spec


@pytest.fixture(autouse=True)
def isolated_mirror(request, tmp_path, monkeypatch):
    """Every test gets its own empty mirror, already hydrated.

    Reads come from the mirror now, so without this each test would try to
    hydrate from the real Sheets API. The db tests exercise hydration itself
    and opt out.
    """
    if request.node.fspath.basename.startswith("test_db_"):
        yield
        return

    monkeypatch.setattr(_conn_mod, "DB_DIR", tmp_path / "mirror")
    _mirror._ready.clear()
    # Schema only, no Google call, and reported as pre-existing so writes are
    # applied rather than skipped as bootstrap.
    monkeypatch.setattr(_mirror, "_ensure",
                        lambda token, sheet_id: (connect(sheet_id).close(), False)[1])
    yield
    _mirror._ready.clear()


@pytest.fixture
def seed():
    """Put positional rows into a mirror tab, as though they came from the sheet."""
    def _seed(sheet_id: str, tab: str, rows: list[list]):
        conn = connect(sheet_id)
        try:
            s = spec(tab)
            width = len(s.columns)
            Repo(conn, s).insert_rows(
                [[*r[:width], *[""] * (width - len(r))] for r in rows])
            conn.execute("DELETE FROM _outbox")
        finally:
            conn.close()
    return _seed

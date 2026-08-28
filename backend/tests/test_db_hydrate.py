"""Hydration — the bootstrap path.

Every existing user starts here, and so does every rebuilt server. The failure
that matters is a mirror that looks fine but is not, because the syncer would
push it back over the sheet.
"""
import pytest
from googleapiclient.errors import HttpError

import app.db.connection as conn_mod
import app.db.hydrate as mod
from app.db import Repo, connect, mirror_exists, spec


class FakeRequest:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class FakeSheets:
    """Serves rows per range, the way values().get does."""

    def __init__(self, by_range=None, error=None):
        self.by_range = by_range or {}
        self.error = error
        self.ranges_read: list[str] = []

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def get(self, spreadsheetId=None, range=None, **kw):
        self.ranges_read.append(range)
        if self.error:
            raise self.error
        return FakeRequest(lambda: {"values": self.by_range.get(range, [])})


def _http_error(status, message):
    resp = type("R", (), {"status": status, "reason": message})()
    return HttpError(resp, message.encode())


@pytest.fixture
def sheets_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
    return tmp_path / "sheets"


def _wire(monkeypatch, fake):
    monkeypatch.setattr(mod, "get_sheets_client", lambda token: fake)
    monkeypatch.setattr(mod, "with_sheets_retry", lambda fn: fn())


def _tx(tx_id, date="2026-07-30", merchant="Zomato", amount="450"):
    row = [""] * len(spec("transactions").columns)
    row[0], row[1], row[3], row[6] = tx_id, date, amount, merchant
    return row


class TestFillingAnEmptyMirror:
    def test_rows_land_in_sheet_order(self, sheets_dir, monkeypatch):
        fake = FakeSheets({"transactions!A2:AA": [_tx("a"), _tx("b"), _tx("c")]})
        _wire(monkeypatch, fake)

        counts = mod.hydrate_sync("tok", "sheet_abc")

        assert counts["transactions"] == 3
        rows = Repo(connect("sheet_abc"), spec("transactions")).all()
        assert [r["id"] for r in rows] == ["a", "b", "c"]

    def test_row_positions_match_the_sheet(self, sheets_dir, monkeypatch):
        _wire(monkeypatch, FakeSheets({"transactions!A2:AA": [_tx("a"), _tx("b")]}))
        mod.hydrate_sync("tok", "sheet_abc")

        rows = Repo(connect("sheet_abc"), spec("transactions")).all()
        assert [r["_row"] for r in rows] == [2, 3]

    def test_a_blank_row_keeps_its_line(self, sheets_dir, monkeypatch):
        # Sheets returns [] for a blank row. Skipping it would shift every row
        # below onto the wrong sheet line.
        _wire(monkeypatch, FakeSheets(
            {"transactions!A2:AA": [_tx("a"), [], _tx("c")]}))
        mod.hydrate_sync("tok", "sheet_abc")

        rows = Repo(connect("sheet_abc"), spec("transactions")).all()
        assert [(r["id"], r["_row"]) for r in rows] == [("a", 2), ("", 3), ("c", 4)]

    def test_short_rows_are_padded(self, sheets_dir, monkeypatch):
        # Trailing empty cells are truncated by the API.
        _wire(monkeypatch, FakeSheets({"meta!A2:B": [["region"]]}))
        mod.hydrate_sync("tok", "sheet_abc")

        assert Repo(connect("sheet_abc"), spec("meta")).get(key="region")["value"] == ""

    def test_every_tab_is_read(self, sheets_dir, monkeypatch):
        fake = FakeSheets()
        _wire(monkeypatch, fake)
        mod.hydrate_sync("tok", "sheet_abc")

        assert set(fake.ranges_read) == {
            "transactions!A2:AA", "categories!A2:G", "analysis_cache!A2:G",
            "item_suggestions!A2:G", "meta!A2:B", "parsed_emails!A2:G"}

    def test_a_reserved_word_column_survives(self, sheets_dir, monkeypatch):
        _wire(monkeypatch, FakeSheets(
            {"parsed_emails!A2:G": [["m1", "noreply@zomato.com", "Order",
                                     "2026-07-30", "parsed", "", "1"]]}))
        mod.hydrate_sync("tok", "sheet_abc")

        row = Repo(connect("sheet_abc"), spec("parsed_emails")).get(email_id="m1")
        assert row["from"] == "noreply@zomato.com"

    def test_an_empty_sheet_is_fine(self, sheets_dir, monkeypatch):
        # Case 1 and case 2 share this code: an empty sheet is hydration with
        # nothing to copy.
        _wire(monkeypatch, FakeSheets())
        assert mod.hydrate_sync("tok", "sheet_abc")["transactions"] == 0
        assert mirror_exists("sheet_abc")

    def test_a_missing_tab_is_not_an_error(self, sheets_dir, monkeypatch):
        _wire(monkeypatch, FakeSheets(error=_http_error(400, "Unable to parse range")))
        assert mod.hydrate_sync("tok", "sheet_abc")["transactions"] == 0


class TestHydratedRowsAreNotPendingChanges:
    def test_nothing_is_left_dirty(self, sheets_dir, monkeypatch):
        # The inserts fire the dirty triggers. Leaving those marks would make
        # the first sync rewrite the sheet with what it already contains.
        _wire(monkeypatch, FakeSheets({"transactions!A2:AA": [_tx("a"), _tx("b")]}))
        mod.hydrate_sync("tok", "sheet_abc")

        conn = connect("sheet_abc")
        assert conn.execute("SELECT COUNT(*) FROM _outbox").fetchone()[0] == 0

    def test_hydration_is_recorded(self, sheets_dir, monkeypatch):
        _wire(monkeypatch, FakeSheets({"transactions!A2:AA": [_tx("a")]}))
        mod.hydrate_sync("tok", "sheet_abc")

        conn = connect("sheet_abc")
        row = conn.execute(
            "SELECT hydrated_at, last_row_pushed FROM _sync WHERE tab='transactions'"
        ).fetchone()
        assert row["hydrated_at"]
        assert row["last_row_pushed"] == 2      # one row, occupying sheet row 2

    def test_a_later_local_write_does_become_dirty(self, sheets_dir, monkeypatch):
        _wire(monkeypatch, FakeSheets({"meta!A2:B": [["region", "IN"]]}))
        mod.hydrate_sync("tok", "sheet_abc")

        conn = connect("sheet_abc")
        Repo(conn, spec("meta")).update({"value": "UK"}, key="region")
        assert conn.execute("SELECT COUNT(*) FROM _outbox").fetchone()[0] == 1


class TestItRunsOnce:
    def test_a_second_call_does_not_reread_the_sheet(self, sheets_dir, monkeypatch):
        fake = FakeSheets({"transactions!A2:AA": [_tx("a")]})
        _wire(monkeypatch, fake)
        mod.hydrate_sync("tok", "sheet_abc")
        reads = len(fake.ranges_read)

        counts = mod.hydrate_sync("tok", "sheet_abc")

        assert len(fake.ranges_read) == reads      # no second read
        assert counts["transactions"] == 1         # still reports the truth

    def test_it_does_not_duplicate_rows(self, sheets_dir, monkeypatch):
        _wire(monkeypatch, FakeSheets({"transactions!A2:AA": [_tx("a"), _tx("b")]}))
        mod.hydrate_sync("tok", "sheet_abc")
        mod.hydrate_sync("tok", "sheet_abc")

        assert Repo(connect("sheet_abc"), spec("transactions")).count() == 2

    def test_it_refuses_to_copy_over_local_rows(self, sheets_dir, monkeypatch):
        # Only reachable if _sync were lost but the data was not. Merging would
        # duplicate every row, so it refuses instead.
        _wire(monkeypatch, FakeSheets({"meta!A2:B": [["region", "IN"]]}))
        conn = connect("sheet_abc")
        Repo(conn, spec("meta")).insert({"key": "local", "value": "1"})
        conn.close()

        with pytest.raises(RuntimeError, match="refusing to hydrate"):
            mod._hydrate_tab(connect("sheet_abc"),
                             FakeSheets({"meta!A2:B": [["region", "IN"]]}),
                             "sheet_abc", spec("meta"))


class TestAFailedHydrationLeavesNothing:
    def test_the_mirror_is_discarded(self, sheets_dir, monkeypatch):
        # A half-populated mirror is worse than none: the syncer would push it
        # back over the sheet.
        _wire(monkeypatch, FakeSheets(error=_http_error(429, "Quota exceeded")))

        with pytest.raises(HttpError):
            mod.hydrate_sync("tok", "sheet_abc")

        assert not mirror_exists("sheet_abc")

    def test_a_quota_error_is_not_read_as_an_empty_sheet(self, sheets_dir, monkeypatch):
        # Returning [] here would produce an empty mirror that then blanks the
        # sheet — the same class of bug as 33ff493.
        _wire(monkeypatch, FakeSheets(error=_http_error(429, "Quota exceeded")))
        with pytest.raises(HttpError):
            mod.hydrate_sync("tok", "sheet_abc")

    def test_a_retry_after_failure_can_succeed(self, sheets_dir, monkeypatch):
        _wire(monkeypatch, FakeSheets(error=_http_error(503, "backend error")))
        with pytest.raises(HttpError):
            mod.hydrate_sync("tok", "sheet_abc")

        _wire(monkeypatch, FakeSheets({"transactions!A2:AA": [_tx("a")]}))
        assert mod.hydrate_sync("tok", "sheet_abc")["transactions"] == 1


class TestVerificationCatchesCorruption:
    """The check has to earn its place — a mirror that looks fine but is not
    gets pushed back over the sheet."""

    def test_a_dropped_row_is_caught(self, sheets_dir, monkeypatch):
        _wire(monkeypatch, FakeSheets(
            {"transactions!A2:AA": [_tx("a"), _tx("b"), _tx("c")]}))

        real = mod.Repo.insert_rows
        monkeypatch.setattr(mod.Repo, "insert_rows",
                            lambda self, rows: real(self, rows[:-1]))

        with pytest.raises(RuntimeError, match="wrote 2 rows, read 3"):
            mod.hydrate_sync("tok", "sheet_abc")
        assert not mirror_exists("sheet_abc")

    def test_a_reordered_row_is_caught(self, sheets_dir, monkeypatch):
        # Same count, wrong order — every row below would sit on the wrong
        # sheet line, which a count check alone would miss.
        _wire(monkeypatch, FakeSheets(
            {"transactions!A2:AA": [_tx("a"), _tx("b"), _tx("c")]}))

        real = mod.Repo.insert_rows
        monkeypatch.setattr(mod.Repo, "insert_rows",
                            lambda self, rows: real(self, list(reversed(rows))))

        with pytest.raises(RuntimeError, match="checksum mismatch"):
            mod.hydrate_sync("tok", "sheet_abc")
        assert not mirror_exists("sheet_abc")

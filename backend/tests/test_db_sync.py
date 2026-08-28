"""The syncer: local changes out to the sheet.

Everything the app writes now goes through here, so these tests are the ones
standing between a user's data and a sheet that quietly disagrees with it. They
check three things the design turns on — that a push is batched, that it is
idempotent, and that a write racing the push is not lost.
"""
import pytest

import app.db.connection as conn_mod
import app.db.sync as sync
from app.db import Repo, connect, spec
from app.db.sync import _runs, push_sync


def _col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


class FakeRequest:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class FakeSheets:
    """Stateful enough to answer append with a real landing range, so the
    syncer's position bookkeeping is exercised rather than mocked away."""

    GRID_ROWS = 1000

    def __init__(self):
        self.rows: dict[str, list[list[str]]] = {}
        self.grid: dict[str, int] = {}
        self.calls: list[tuple] = []
        self.fail_on: str | None = None

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def _tab(self, range_: str) -> str:
        return range_.split("!", 1)[0]

    def get(self, spreadsheetId=None, fields=None, **kw):
        self.calls.append(("get", fields))
        return FakeRequest(lambda: {"sheets": [
            {"properties": {"sheetId": i, "title": name,
                            "gridProperties": {"rowCount": self.grid.get(
                                name, self.GRID_ROWS)}}}
            for i, name in enumerate(
                ["transactions", "categories", "analysis_cache",
                 "item_suggestions", "meta", "parsed_emails"])]})

    def batchUpdate(self, spreadsheetId=None, body=None, **kw):
        if "requests" in (body or {}):
            for req in body["requests"]:
                dim = req["appendDimension"]
                name = ["transactions", "categories", "analysis_cache",
                        "item_suggestions", "meta", "parsed_emails"][dim["sheetId"]]
                self.grid[name] = self.grid.get(name, self.GRID_ROWS) + dim["length"]
                self.calls.append(("grow", name, dim["length"]))
            return FakeRequest(lambda: {})

        for entry in body["data"]:
            tab = self._tab(entry["range"])
            if self.fail_on == tab:
                raise RuntimeError("sheets is down")
            last = int("".join(c for c in entry["range"].split(":")[-1]
                               if c.isdigit()))
            if last > self.grid.get(tab, self.GRID_ROWS):
                raise RuntimeError(f"{entry['range']} exceeds grid limits")
        self.calls.append(("batchUpdate", body["valueInputOption"], body["data"]))
        for entry in body["data"]:
            self._apply(entry["range"], entry["values"])
        return FakeRequest(lambda: {})

    def _apply(self, range_: str, values: list[list[str]]) -> None:
        """Write cells at a range, the way the real sheet would — so a test can
        assert on the resulting sheet rather than on the requests."""
        tab, body = range_.split("!", 1)
        start, end = body.split(":")
        first_row = int("".join(c for c in start if c.isdigit()))
        first_col = _col_index("".join(c for c in start if c.isalpha()))
        last_col = _col_index("".join(c for c in end if c.isalpha()))
        rows = self.rows.setdefault(tab, [])
        width = max(last_col + 1, max((len(r) for r in rows), default=0))
        for offset, value_row in enumerate(values):
            i = first_row - 2 + offset
            while len(rows) <= i:
                rows.append([""] * width)
            row = rows[i] + [""] * (width - len(rows[i]))
            for j, cell in enumerate(value_row):
                row[first_col + j] = cell
            rows[i] = row

    def requests_for(self, kind: str) -> list[tuple]:
        return [c for c in self.calls if c[0] == kind]


@pytest.fixture
def wired(tmp_path, monkeypatch):
    monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
    sheets = FakeSheets()
    monkeypatch.setattr(sync, "get_sheets_client", lambda token: sheets)
    monkeypatch.setattr(sync, "with_sheets_retry", lambda fn: fn())
    monkeypatch.setattr(sync, "_ensure_sheet_schema", lambda s, sid: None)
    sync._grid_rows.clear()   # the capacity memo is per process, not per test
    # A mirror the syncer will find: connect() creates it.
    connect("s1").close()
    return sheets


def write(tab: str, records: list[dict]) -> None:
    conn = connect("s1")
    try:
        Repo(conn, spec(tab)).insert_many(records)
    finally:
        conn.close()


def update(tab: str, fields: dict, **key) -> None:
    conn = connect("s1")
    try:
        Repo(conn, spec(tab)).update(fields, **key)
    finally:
        conn.close()


def queued(tab: str | None = None) -> int:
    conn = connect("s1")
    try:
        if tab:
            return conn.execute(
                "SELECT COUNT(*) FROM _outbox WHERE tab = ?", (tab,)).fetchone()[0]
        return conn.execute("SELECT COUNT(*) FROM _outbox").fetchone()[0]
    finally:
        conn.close()


class TestRuns:
    """Adjacent rows must collapse into one range. Sheets bills per request, so
    this is the difference between one write and fifty."""

    def test_adjacent_rows_become_one_span(self):
        assert _runs([2, 3, 4]) == [(2, 4)]

    def test_a_gap_splits_the_span(self):
        assert _runs([2, 3, 7, 8]) == [(2, 3), (7, 8)]

    def test_duplicates_and_disorder_are_handled(self):
        assert _runs([5, 2, 5, 3]) == [(2, 3), (5, 5)]

    def test_nothing_is_no_spans(self):
        assert _runs([]) == []


class TestAppends:
    def test_new_rows_reach_the_sheet(self, wired):
        write("meta", [{"key": "region", "value": "IN"}, {"key": "days", "value": "7"}])
        push_sync("tok", "s1")

        assert wired.rows["meta"] == [["region", "IN"], ["days", "7"]]

    def test_fifty_rows_are_one_request(self, wired):
        write("meta", [{"key": f"k{i}", "value": str(i)} for i in range(50)])
        push_sync("tok", "s1")

        writes = wired.requests_for("batchUpdate")
        assert len(writes) == 1
        assert [d["range"] for d in writes[0][2]] == ["meta!A2:B51"]
        assert len(wired.rows["meta"]) == 50

    def test_a_very_large_push_splits_across_requests(self, wired, monkeypatch):
        # The cap is on the request, not just on each range: a first push of a
        # big sheet would otherwise build one enormous body.
        monkeypatch.setattr(sync, "MAX_ROWS_PER_BLOCK", 10)
        write("meta", [{"key": f"k{i}"} for i in range(25)])
        push_sync("tok", "s1")

        writes = wired.requests_for("batchUpdate")
        assert len(writes) == 3
        assert [len(v) for _, _, data in writes for d in data
                for v in [d["values"]]] == [10, 10, 5]
        assert len(wired.rows["meta"]) == 25

    def test_a_stale_capacity_memo_heals(self, wired):
        # The memo tracks our own growth, so it can only be wrong if the tab
        # was replaced under us — a reset. Re-reading beats stalling forever.
        write("meta", [{"key": "a"}])
        push_sync("tok", "s1")
        wired.grid["meta"] = 2          # the tab came back smaller
        write("meta", [{"key": f"k{i}"} for i in range(5)])
        push_sync("tok", "s1")

        assert len(wired.rows["meta"]) == 6

    def test_the_grid_grows_before_a_row_past_its_end_is_written(self, wired):
        # values().update refuses a range past the grid, and a new sheet stops
        # at 1000 rows. Growing first is what lets rows be addressed exactly.
        wired.grid["meta"] = 3
        write("meta", [{"key": f"k{i}"} for i in range(5)])
        push_sync("tok", "s1")

        assert wired.requests_for("grow")
        assert len(wired.rows["meta"]) == 5

    def test_a_second_push_sends_nothing(self, wired):
        # Idempotence is what lets a failed push simply retry. If a clean push
        # re-sent its rows, every tick would duplicate the whole tab.
        write("meta", [{"key": "region", "value": "IN"}])
        push_sync("tok", "s1")
        wired.calls.clear()

        push_sync("tok", "s1")
        assert wired.calls == []
        assert wired.rows["meta"] == [["region", "IN"]]

    def test_later_rows_append_after_the_earlier_ones(self, wired):
        write("meta", [{"key": "a"}])
        push_sync("tok", "s1")
        write("meta", [{"key": "b"}])
        push_sync("tok", "s1")

        assert wired.rows["meta"] == [["a", ""], ["b", ""]]

    def test_the_queue_is_emptied(self, wired):
        write("meta", [{"key": "a"}])
        push_sync("tok", "s1")
        assert queued() == 0


class TestUpdates:
    def test_an_edited_row_is_rewritten_in_place(self, wired):
        write("meta", [{"key": "region", "value": "IN"}, {"key": "days", "value": "7"}])
        push_sync("tok", "s1")
        update("meta", {"value": "UK"}, key="region")
        push_sync("tok", "s1")

        assert wired.rows["meta"] == [["region", "UK"], ["days", "7"]]

    def test_an_update_addresses_its_own_row(self, wired):
        write("meta", [{"key": "a"}, {"key": "b"}, {"key": "c"}])
        push_sync("tok", "s1")
        wired.calls.clear()
        update("meta", {"value": "x"}, key="b")
        push_sync("tok", "s1")

        ranges = [d["range"] for _, _, data in wired.requests_for("batchUpdate")
                  for d in data]
        assert ranges == ["meta!A3:B3"]

    def test_adjacent_edits_share_one_range(self, wired):
        write("meta", [{"key": "a"}, {"key": "b"}, {"key": "c"}])
        push_sync("tok", "s1")
        wired.calls.clear()
        update("meta", {"value": "1"}, key="a")
        update("meta", {"value": "2"}, key="b")
        push_sync("tok", "s1")

        ranges = [d["range"] for _, _, data in wired.requests_for("batchUpdate")
                  for d in data]
        assert ranges == ["meta!A2:B3"]

    def test_a_soft_delete_rewrites_the_row_rather_than_removing_it(self, wired):
        write("categories", [{"id": "c1", "name": "Food"}, {"id": "c2", "name": "Fuel"}])
        push_sync("tok", "s1")
        conn = connect("s1")
        try:
            Repo(conn, spec("categories")).update_row(
                2, {c: "" for c in spec("categories").columns})
        finally:
            conn.close()
        push_sync("tok", "s1")

        # Two rows still, the first blank: anything else shifts Fuel up a line.
        assert len(wired.rows["categories"]) == 2
        assert wired.rows["categories"][0] == [""] * 7
        assert wired.rows["categories"][1][1] == "Fuel"


class TestTheInterpretedColumn:
    """valueInputOption is per request, so the date column has to be written on
    its own. USER_ENTERED across a whole row would evaluate a merchant like
    "=Zomato" as a formula and reformat every ISO timestamp on the row."""

    def test_the_row_goes_raw_and_the_date_goes_user_entered(self, wired):
        write("transactions", [{"id": "t1", "date": "2026-08-01", "merchant": "=Zomato"}])
        push_sync("tok", "s1")

        writes = wired.requests_for("batchUpdate")
        assert [w[1] for w in writes] == ["RAW", "USER_ENTERED"]
        # The merchant only ever travels RAW, so the sheet stores the text.
        assert writes[0][2][0]["values"][0][6] == "=Zomato"

    def test_only_the_date_column_is_reinterpreted(self, wired):
        write("transactions", [{"id": "t1", "date": "2026-08-01"},
                               {"id": "t2", "date": "2026-08-02"}])
        push_sync("tok", "s1")

        entered = next(w for w in wired.requests_for("batchUpdate")
                       if w[1] == "USER_ENTERED")
        assert [d["range"] for d in entered[2]] == ["transactions!B2:B3"]
        assert entered[2][0]["values"] == [["2026-08-01"], ["2026-08-02"]]

    def test_a_tab_without_one_gets_no_extra_request(self, wired):
        write("meta", [{"key": "a"}])
        push_sync("tok", "s1")
        assert [w[1] for w in wired.requests_for("batchUpdate")] == ["RAW"]


class TestAWriteDuringAPush:
    def test_it_survives_and_goes_out_next_time(self, wired):
        """The reason the outbox is a queue rather than a set of marks.

        A deduped table keeps the original entry on re-mark, so this write's
        mark would be deleted by the push it was not part of — and the change
        would never reach the sheet. Appending gives it a higher rowid than the
        claim, so it outlives the delete.
        """
        write("meta", [{"key": "region", "value": "IN"}])
        push_sync("tok", "s1")

        conn = connect("s1")
        try:
            # Claim as the syncer would, then let a write land before the push
            # finishes and clears what it claimed.
            high, _rows = sync._claim(conn, "meta")
            Repo(conn, spec("meta")).update({"value": "UK"}, key="region")
            conn.execute("DELETE FROM _outbox WHERE tab = ? AND rowid <= ?",
                         ("meta", high))
        finally:
            conn.close()

        assert queued("meta") == 1
        push_sync("tok", "s1")
        assert wired.rows["meta"] == [["region", "UK"]]


class TestFailures:
    def test_a_failed_tab_keeps_its_queue(self, wired):
        write("meta", [{"key": "a"}])
        wired.fail_on = "meta"
        push_sync("tok", "s1")

        assert queued("meta") == 1
        assert "meta" not in wired.rows

    def test_it_goes_out_once_the_sheet_is_back(self, wired):
        write("meta", [{"key": "a"}])
        wired.fail_on = "meta"
        push_sync("tok", "s1")
        wired.fail_on = None
        push_sync("tok", "s1")

        assert wired.rows["meta"] == [["a", ""]]
        assert queued("meta") == 0

    def test_the_error_is_recorded(self, wired):
        write("meta", [{"key": "a"}])
        wired.fail_on = "meta"
        push_sync("tok", "s1")

        conn = connect("s1")
        try:
            err = conn.execute(
                "SELECT last_error FROM _sync WHERE tab = 'meta'").fetchone()[0]
        finally:
            conn.close()
        assert "sheets is down" in err

    def test_one_tab_failing_does_not_strand_the_others(self, wired):
        # A quota error on a big tab must not hold up a two-row settings save.
        write("transactions", [{"id": "t1"}])
        write("meta", [{"key": "a"}])
        wired.fail_on = "transactions"
        push_sync("tok", "s1")

        assert wired.rows["meta"] == [["a", ""]]
        assert queued("transactions") == 1
        assert queued("meta") == 0


class TestPending:
    def test_a_sheet_with_no_mirror_has_nothing_pending(self, wired):
        assert sync.pending_count("never_made") == 0

    def test_only_sheets_with_work_are_listed(self, wired):
        assert sync.sheets_with_pending() == []
        write("meta", [{"key": "a"}])
        assert sync.sheets_with_pending() == ["s1"]
        push_sync("tok", "s1")
        assert sync.sheets_with_pending() == []

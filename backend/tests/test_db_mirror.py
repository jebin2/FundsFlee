"""Dual-write, and the diff that proves it.

The sheet is still authoritative in this phase, so a mirror failure must not
break a user's write — but it must be detectable, or Phase 3 moves reads onto
a store nobody checked.
"""
import pytest

import app.db.connection as conn_mod
import app.db.hydrate as hydrate_mod
import app.db.mirror as mirror
import app.db.verify as verify_mod
from app.db import Repo, connect, spec


class FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    def execute(self):
        return self._payload


class FakeSheets:
    def __init__(self, by_range=None):
        self.by_range = by_range or {}

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def get(self, spreadsheetId=None, range=None, **kw):
        return FakeRequest({"values": self.by_range.get(range, [])})


@pytest.fixture
def wired(tmp_path, monkeypatch):
    """Steady state: the mirror already exists, as it does on every write after
    the first. The bootstrap path gets its own tests below."""
    monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
    monkeypatch.setattr(hydrate_mod, "get_sheets_client", lambda token: FakeSheets())
    monkeypatch.setattr(hydrate_mod, "with_sheets_retry", lambda fn: fn())
    mirror._ready.clear()
    hydrate_mod.hydrate_sync("tok", "s1")
    return tmp_path


class TestWritesReachTheMirror:
    def test_an_append_lands(self, wired):
        mirror.append("tok", "s1", "meta", [{"key": "region", "value": "IN"}])
        assert Repo(connect("s1"), spec("meta")).get(key="region")["value"] == "IN"

    def test_an_update_lands(self, wired):
        mirror.append("tok", "s1", "meta", [{"key": "region", "value": "IN"}])
        mirror.update("tok", "s1", "meta", {"value": "UK"}, key="region")
        assert Repo(connect("s1"), spec("meta")).get(key="region")["value"] == "UK"

    def test_an_update_by_row_lands(self, wired):
        mirror.append("tok", "s1", "meta", [{"key": "a"}, {"key": "b"}])
        mirror.update_row("tok", "s1", "meta", 3, {"value": "second"})
        assert Repo(connect("s1"), spec("meta")).get(key="b")["value"] == "second"

    def test_blanking_keeps_the_row(self, wired):
        # Categories are removed by blanking. The row must stay, or every row
        # below it shifts onto the wrong sheet line.
        mirror.append("tok", "s1", "categories",
                      [{"id": "c1", "name": "Food"}, {"id": "c2", "name": "Fuel"}])
        mirror.blank_row("tok", "s1", "categories", 2)

        rows = Repo(connect("s1"), spec("categories")).all()
        assert len(rows) == 2
        assert rows[0]["name"] == "" and rows[1]["name"] == "Fuel"

    def test_hydration_runs_once_per_process(self, wired, monkeypatch):
        calls = []
        real = hydrate_mod.hydrate_sync
        monkeypatch.setattr(hydrate_mod, "hydrate_sync",
                            lambda t, s: (calls.append(s), real(t, s))[1])
        mirror.append("tok", "s1", "meta", [{"key": "a"}])
        mirror.append("tok", "s1", "meta", [{"key": "b"}])
        assert calls == ["s1"]


class TestTheFirstWriteAgainstAPopulatedSheet:
    """No local mirror, sheet already has data — a rebuilt server, or the first
    deploy of this feature.

    The write goes local first now, so the sheet does NOT contain it: hydration
    copies what the sheet has, and the write lands on top. Phase 2 had the
    opposite ordering and skipped this write to avoid duplicating it; keeping
    that skip here would silently lose the first write after every rebuild.
    """

    def test_the_mirror_is_built_from_the_sheet(self, wired, monkeypatch):
        sheet = {"meta!A2:B": [["region", "IN"], ["days", "7"]]}
        monkeypatch.setattr(hydrate_mod, "get_sheets_client",
                            lambda token: FakeSheets(sheet))

        mirror.append("tok", "fresh", "meta", [{"key": "theme", "value": "dark"}])

        rows = Repo(connect("fresh"), spec("meta")).all()
        assert [(r["key"], r["_row"]) for r in rows] == [
            ("region", 2), ("days", 3), ("theme", 4)]

    def test_the_write_is_not_lost(self, wired, monkeypatch):
        sheet = {"meta!A2:B": [["region", "IN"]]}
        monkeypatch.setattr(hydrate_mod, "get_sheets_client",
                            lambda token: FakeSheets(sheet))
        mirror.append("tok", "fresh", "meta", [{"key": "theme", "value": "dark"}])

        assert Repo(connect("fresh"), spec("meta")).get(key="theme")["value"] == "dark"

    def test_it_is_queued_for_the_sheet(self, wired, monkeypatch):
        # Hydrated rows are not pending, but this one is: the sheet has not
        # seen it. If it were cleared with them the change would never go out.
        sheet = {"meta!A2:B": [["region", "IN"]]}
        monkeypatch.setattr(hydrate_mod, "get_sheets_client",
                            lambda token: FakeSheets(sheet))
        mirror.append("tok", "fresh", "meta", [{"key": "theme", "value": "dark"}])

        queued = connect("fresh").execute(
            "SELECT DISTINCT row_num FROM _outbox WHERE tab = 'meta'").fetchall()
        assert [r[0] for r in queued] == [3]      # only the new row

    def test_an_update_during_bootstrap_applies(self, wired, monkeypatch):
        sheet = {"meta!A2:B": [["region", "IN"]]}
        monkeypatch.setattr(hydrate_mod, "get_sheets_client",
                            lambda token: FakeSheets(sheet))
        mirror.update("tok", "fresh", "meta", {"value": "UK"}, key="region")

        rows = Repo(connect("fresh"), spec("meta")).all()
        assert len(rows) == 1 and rows[0]["value"] == "UK"

    def test_the_next_write_lands_after_it(self, wired, monkeypatch):
        sheet = {"meta!A2:B": [["region", "IN"]]}
        monkeypatch.setattr(hydrate_mod, "get_sheets_client",
                            lambda token: FakeSheets(sheet))
        mirror.append("tok", "fresh", "meta", [{"key": "days", "value": "7"}])
        mirror.append("tok", "fresh", "meta", [{"key": "theme", "value": "dark"}])

        assert [r["key"] for r in Repo(connect("fresh"), spec("meta")).all()] == [
            "region", "days", "theme"]

    def test_every_tab_comes_across(self, wired, monkeypatch):
        sheet = {
            "meta!A2:B": [["region", "IN"]],
            "categories!A2:G": [["c1", "Food", "", "#f00", "cutlery", "true", "t"]],
            "parsed_emails!A2:G": [["m1", "a@b.c", "Order", "t", "parsed", "", "1"]],
        }
        monkeypatch.setattr(hydrate_mod, "get_sheets_client",
                            lambda token: FakeSheets(sheet))
        mirror.append("tok", "fresh", "meta", [{"key": "days", "value": "7"}])

        conn = connect("fresh")
        assert Repo(conn, spec("meta")).count() == 2
        assert Repo(conn, spec("categories")).get(id="c1")["name"] == "Food"
        assert Repo(conn, spec("parsed_emails")).get(email_id="m1")["status"] == "parsed"


class TestFailuresAreLoudNow:
    def test_a_broken_mirror_raises(self, wired, monkeypatch):
        # Inverted for phase 3. While the mirror served nothing, swallowing was
        # right — the sheet had the row and drift was merely detectable. Now
        # that reads come from here, swallowing would show the user their data
        # without their last change and call it success.
        monkeypatch.setattr(mirror, "connect",
                            lambda sid: (_ for _ in ()).throw(RuntimeError("disk gone")))
        with pytest.raises(RuntimeError):
            mirror.append("tok", "s1", "meta", [{"key": "a"}])

    def test_an_update_with_no_local_row_is_survivable(self, wired):
        mirror.update("tok", "s1", "meta", {"value": "x"}, key="ghost")

    def test_empty_writes_do_nothing(self, wired):
        mirror.append("tok", "s1", "meta", [])
        mirror.update("tok", "s1", "meta", {}, key="a")
        assert Repo(connect("s1"), spec("meta")).count() == 0


class TestVerify:
    def _wire_verify(self, monkeypatch, by_range):
        monkeypatch.setattr(verify_mod, "get_sheets_client",
                            lambda token: FakeSheets(by_range))
        monkeypatch.setattr(verify_mod, "with_sheets_retry", lambda fn: fn())

    def test_a_matching_mirror_passes(self, wired, monkeypatch):
        mirror.append("tok", "s1", "meta", [{"key": "region", "value": "IN"}])
        self._wire_verify(monkeypatch, {"meta!A2:B": [["region", "IN"]]})

        result = verify_mod.verify_sync("tok", "s1")
        assert result["ok"]
        assert result["tabs"]["meta"]["differences"] == 0

    def test_a_missing_local_row_is_reported(self, wired, monkeypatch):
        mirror.append("tok", "s1", "meta", [{"key": "region", "value": "IN"}])
        self._wire_verify(monkeypatch,
                          {"meta!A2:B": [["region", "IN"], ["days", "7"]]})

        result = verify_mod.verify_sync("tok", "s1")
        assert not result["ok"]
        assert result["tabs"]["meta"]["sample"][0]["problem"] == "only in sheet"

    def test_a_changed_cell_names_its_column(self, wired, monkeypatch):
        mirror.append("tok", "s1", "meta", [{"key": "region", "value": "IN"}])
        self._wire_verify(monkeypatch, {"meta!A2:B": [["region", "UK"]]})

        sample = verify_mod.verify_sync("tok", "s1")["tabs"]["meta"]["sample"][0]
        assert sample["problem"] == "differs"
        assert sample["columns"] == ["value"]

    def test_the_same_rows_in_a_different_order_is_a_mismatch(self, wired, monkeypatch):
        # Position is row identity. Matching as sets would pass this and then
        # every update would write to the wrong sheet line.
        mirror.append("tok", "s1", "meta", [{"key": "a"}, {"key": "b"}])
        self._wire_verify(monkeypatch, {"meta!A2:B": [["b", ""], ["a", ""]]})

        assert not verify_mod.verify_sync("tok", "s1")["ok"]

    def test_no_mirror_is_not_silently_ok(self, wired, monkeypatch):
        self._wire_verify(monkeypatch, {})
        result = verify_mod.verify_sync("tok", "never_made")
        assert not result["ok"] and "reason" in result

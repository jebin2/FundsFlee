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
    monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
    monkeypatch.setattr(hydrate_mod, "get_sheets_client", lambda token: FakeSheets())
    monkeypatch.setattr(hydrate_mod, "with_sheets_retry", lambda fn: fn())
    mirror._ready.clear()
    return tmp_path


class TestWritesReachTheMirror:
    def test_an_append_lands(self, wired):
        mirror.append("tok", "s1", "meta", [{"key": "region", "value": "IN"}])
        assert Repo(connect("s1"), spec("meta")).get(key="region")["value"] == "IN"

    def test_it_hydrates_on_first_use(self, wired, monkeypatch):
        # A write can be the first thing that touches a sheet after a restart.
        monkeypatch.setattr(hydrate_mod, "get_sheets_client",
                            lambda token: FakeSheets({"meta!A2:B": [["region", "IN"]]}))
        mirror.append("tok", "s1", "meta", [{"key": "days", "value": "7"}])

        rows = Repo(connect("s1"), spec("meta")).all()
        assert [r["key"] for r in rows] == ["region", "days"]

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


class TestFailuresDoNotBreakTheWrite:
    def test_a_broken_mirror_is_swallowed(self, wired, monkeypatch):
        # The sheet write already succeeded. Raising here would fail a user's
        # save because a store that serves nothing yet hiccuped.
        monkeypatch.setattr(mirror, "connect",
                            lambda sid: (_ for _ in ()).throw(RuntimeError("disk gone")))
        mirror.append("tok", "s1", "meta", [{"key": "a"}])   # must not raise

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

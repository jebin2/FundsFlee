"""One repository over six tabs, and the dirty tracking underneath it.

The point of the generic repo is that the six per-tab modules stop drifting
apart — the drift is where the bugs lived. So these tests run the same
operations across tabs with different shapes and keys.
"""
import pytest

import app.db.connection as conn_mod
from app.db import Repo, ROW_FIELD, connect, mirror_exists, spec


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
    return connect("sheet_abc")


def dirty(db, tab):
    return [r[0] for r in db.execute(
        "SELECT row_num FROM _dirty WHERE tab = ? ORDER BY row_num", (tab,))]


class TestOpening:
    def test_it_creates_the_mirror(self, tmp_path, monkeypatch):
        monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
        connect("sheet_abc")
        assert (tmp_path / "sheets" / "sheet_abc.db").exists()

    def test_a_missing_mirror_is_reported(self, tmp_path, monkeypatch):
        # False must mean "not hydrated yet", never "the user deleted
        # everything" — that distinction stops an empty local store blanking
        # the sheet.
        monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
        assert mirror_exists("sheet_abc") is False
        connect("sheet_abc")
        assert mirror_exists("sheet_abc") is True

    def test_a_path_traversing_id_is_refused(self, tmp_path, monkeypatch):
        monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
        with pytest.raises(ValueError):
            connect("../../etc/passwd")

    def test_opening_twice_is_harmless(self, tmp_path, monkeypatch):
        monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
        connect("sheet_abc").execute(
            "INSERT INTO meta(key, value) VALUES ('a', '1')")
        again = connect("sheet_abc")
        assert again.execute("SELECT COUNT(*) FROM meta").fetchone()[0] == 1


class TestReadingAndWriting:
    def test_insert_returns_the_sheet_row(self, db):
        repo = Repo(db, spec("meta"))
        # First data row is sheet row 2 — row 1 is the header.
        assert repo.insert({"key": "region", "value": "IN"}) == 2
        assert repo.insert({"key": "days", "value": "7"}) == 3

    def test_rows_come_back_in_sheet_order(self, db):
        repo = Repo(db, spec("meta"))
        repo.insert_many([{"key": "a", "value": "1"}, {"key": "b", "value": "2"}])
        assert [r["key"] for r in repo.all()] == ["a", "b"]

    def test_each_row_carries_its_sheet_line(self, db):
        repo = Repo(db, spec("meta"))
        repo.insert_many([{"key": "a"}, {"key": "b"}])
        assert [r[ROW_FIELD] for r in repo.all()] == [2, 3]

    def test_get_by_key(self, db):
        repo = Repo(db, spec("meta"))
        repo.insert({"key": "region", "value": "IN"})
        assert repo.get(key="region")["value"] == "IN"

    def test_get_missing_is_none(self, db):
        assert Repo(db, spec("meta")).get(key="nope") is None

    def test_update_by_key(self, db):
        repo = Repo(db, spec("meta"))
        repo.insert({"key": "region", "value": "IN"})
        assert repo.update({"value": "UK"}, key="region") == 1
        assert repo.get(key="region")["value"] == "UK"

    def test_update_of_a_missing_row_reports_zero(self, db):
        # Callers must be able to tell "no such row" from "nothing to do".
        assert Repo(db, spec("meta")).update({"value": "x"}, key="ghost") == 0

    def test_update_by_position(self, db):
        repo = Repo(db, spec("meta"))
        repo.insert_many([{"key": "a"}, {"key": "b"}])
        repo.update_row(3, {"value": "second"})
        assert repo.get(key="b")["value"] == "second"

    def test_missing_fields_are_stored_empty(self, db):
        repo = Repo(db, spec("meta"))
        repo.insert({"key": "lonely"})
        assert repo.get(key="lonely")["value"] == ""

    def test_a_reserved_word_column_round_trips(self, db):
        # parsed_emails has a column called "from".
        repo = Repo(db, spec("parsed_emails"))
        repo.insert({"email_id": "m1", "from": "noreply@zomato.com"})
        assert repo.get(email_id="m1")["from"] == "noreply@zomato.com"


class TestComposiKeys:
    def test_both_key_columns_are_required(self, db):
        repo = Repo(db, spec("item_suggestions"))
        repo.insert({"key": "tx:1", "field": "item_name", "suggested": "Milk"})
        repo.insert({"key": "tx:1", "field": "quantity", "suggested": "2"})
        assert repo.get(key="tx:1", field="quantity")["suggested"] == "2"

    def test_a_partial_key_is_rejected(self, db):
        # Silently matching the first row for tx:1 would update the wrong
        # suggestion.
        with pytest.raises(ValueError):
            Repo(db, spec("item_suggestions")).get(key="tx:1")


class TestGuardrails:
    def test_an_unknown_column_is_rejected_on_update(self, db):
        with pytest.raises(ValueError):
            Repo(db, spec("meta")).update({"nonsense": "x"}, key="a")

    def test_an_unknown_key_column_is_rejected(self, db):
        with pytest.raises(ValueError):
            Repo(db, spec("meta")).get(nonsense="x")


class TestDirtyTrackingIsAutomatic:
    """Application code never marks a row dirty. If it had to, a code path
    would eventually forget, which is how a sync layer starts silently
    dropping changes."""

    def test_an_insert_marks_itself(self, db):
        Repo(db, spec("meta")).insert({"key": "a"})
        assert dirty(db, "meta") == [1]      # rowid, sheet row 2

    def test_an_update_marks_itself(self, db):
        repo = Repo(db, spec("meta"))
        repo.insert({"key": "a"})
        db.execute("DELETE FROM _dirty")
        repo.update({"value": "v"}, key="a")
        assert dirty(db, "meta") == [1]

    def test_marks_are_per_tab(self, db):
        Repo(db, spec("meta")).insert({"key": "a"})
        Repo(db, spec("categories")).insert({"id": "c1", "name": "Food"})
        assert dirty(db, "meta") == [1]
        assert dirty(db, "categories") == [1]

    def test_repeated_edits_collapse_to_one_mark(self, db):
        repo = Repo(db, spec("meta"))
        repo.insert({"key": "a"})
        repo.update({"value": "1"}, key="a")
        repo.update({"value": "2"}, key="a")
        assert dirty(db, "meta") == [1]

    def test_a_bulk_insert_marks_every_row(self, db):
        Repo(db, spec("meta")).insert_many([{"key": f"k{i}"} for i in range(5)])
        assert dirty(db, "meta") == [1, 2, 3, 4, 5]

"""Editing notes retires what the AI suggested from the old ones.

A suggestion made from notes describes the text it read. Once that text is
edited the suggestion is about something that no longer exists, and it kept
being offered — while the transaction was ALSO never looked at again, because
any note row at all counted as "already processed".
"""
import asyncio

import pytest

import app.services.item_normalization_service as mod
from app.core.deps import SheetSession
from app.db import mirror
from app.services.item_suggestion_service import get_pending_suggestions
from app.sheets import get_item_suggestions, supersede_note_suggestions
from app.sheets.suggestions import SUPERSEDED, append_item_suggestions
from app.sheets.transaction_schema import transaction_to_row
from tests.test_transaction_schema import BASE_TX

SESSION = SheetSession(access_token="tok", refresh_token="r", sheet_id="sheet",
                       user_email="u@example.com")


def tx_row(tx_id: str, **over) -> list:
    return transaction_to_row({**BASE_TX, "id": tx_id, **over})


def suggestion(tx_id: str, field="item_name", current="Milk", suggested="Milk 1L",
               source="notes") -> dict:
    return {"key": f"tx:{tx_id}", "field": field, "current_val": current,
            "suggested": suggested, "source": source}


def pending() -> list[dict]:
    """What is actually OFFERED — through the same filter the app uses. A marker
    row is status "pending" but has suggested == current_val, so it is never
    shown; asserting on the raw status would call that a live suggestion."""
    return asyncio.run(get_pending_suggestions(SESSION))


@pytest.fixture
def a_suggested_transaction(seed):
    seed("sheet", "transactions",
         [tx_row("t1", notes="two litres of milk", item_name="Milk")])
    asyncio.run(append_item_suggestions("tok", "sheet", [suggestion("t1")]))
    return "t1"


class TestRetiringTheStaleOne:
    def test_it_is_no_longer_pending(self, a_suggested_transaction):
        asyncio.run(supersede_note_suggestions("tok", "sheet", "t1"))
        assert pending() == []

    def test_the_row_is_kept_as_a_record(self, a_suggested_transaction):
        asyncio.run(supersede_note_suggestions("tok", "sheet", "t1"))
        rows = asyncio.run(get_item_suggestions("tok", "sheet"))
        assert [r["status"] for r in rows] == [SUPERSEDED]

    def test_it_reports_how_many_it_retired(self, seed):
        seed("sheet", "transactions", [tx_row("t1", notes="milk")])
        asyncio.run(append_item_suggestions("tok", "sheet", [
            suggestion("t1", field="item_name"),
            suggestion("t1", field="quantity", current="", suggested="2L"),
        ]))
        assert asyncio.run(supersede_note_suggestions("tok", "sheet", "t1")) == 2

    def test_another_transaction_is_untouched(self, a_suggested_transaction, seed):
        seed("sheet", "transactions", [tx_row("t2", notes="bread")])
        asyncio.run(append_item_suggestions("tok", "sheet", [suggestion("t2")]))
        asyncio.run(supersede_note_suggestions("tok", "sheet", "t1"))
        assert [s["key"] for s in pending()] == ["tx:t2"]

    def test_a_normalize_suggestion_is_untouched(self, seed):
        # Those come from the item name across many rows, not from these notes.
        seed("sheet", "transactions", [tx_row("t1", notes="milk", item_name="Milk")])
        asyncio.run(append_item_suggestions("tok", "sheet",
                                            [suggestion("t1", source="normalize")]))
        asyncio.run(supersede_note_suggestions("tok", "sheet", "t1"))
        assert [s["source"] for s in pending()] == ["normalize"]

    def test_running_it_twice_retires_nothing_the_second_time(self, a_suggested_transaction):
        asyncio.run(supersede_note_suggestions("tok", "sheet", "t1"))
        assert asyncio.run(supersede_note_suggestions("tok", "sheet", "t1")) == 0


class TestTheFreshOneIsNotBlocked:
    """The append dedups on key+field against existing rows. Without excluding
    superseded ones, retiring a suggestion would silently prevent its
    replacement from ever being written."""

    def test_a_new_suggestion_for_the_same_field_lands(self, a_suggested_transaction):
        asyncio.run(supersede_note_suggestions("tok", "sheet", "t1"))
        asyncio.run(append_item_suggestions("tok", "sheet", [
            suggestion("t1", current="Milk", suggested="Milk 2L")]))
        assert [s["suggested"] for s in pending()] == ["Milk 2L"]

    def test_without_superseding_it_would_be_dropped(self, a_suggested_transaction):
        # The behaviour that makes the exclusion necessary, pinned.
        asyncio.run(append_item_suggestions("tok", "sheet", [
            suggestion("t1", current="Milk", suggested="Milk 2L")]))
        assert [s["suggested"] for s in pending()] == ["Milk 1L"]

    def test_the_transaction_counts_as_unprocessed_again(self, a_suggested_transaction):
        asyncio.run(supersede_note_suggestions("tok", "sheet", "t1"))
        rows = asyncio.run(get_item_suggestions("tok", "sheet"))
        assert mod._processed_note_keys(rows) == set()

    def test_a_live_suggestion_still_counts_as_processed(self, a_suggested_transaction):
        rows = asyncio.run(get_item_suggestions("tok", "sheet"))
        assert mod._processed_note_keys(rows) == {"tx:t1"}


class TestTheRefresh:
    def test_it_retires_and_asks_again(self, a_suggested_transaction, monkeypatch):
        async def extract(entries):
            assert [e["tx_id"] for e in entries] == ["t1"]
            return {"t1": {"item_name": "Milk 2L"}}
        monkeypatch.setattr(mod, "extract_from_notes", extract)

        result = asyncio.run(mod.refresh_note_suggestions(SESSION, "t1"))
        assert result == {"retired": 1, "added": 1}
        assert [s["suggested"] for s in pending()] == ["Milk 2L"]

    def test_it_reads_the_new_notes_not_the_old(self, seed, monkeypatch):
        seed("sheet", "transactions", [tx_row("t1", notes="now two litres")])
        seen = {}
        async def extract(entries):
            seen["notes"] = entries[0]["notes"]
            return {}
        monkeypatch.setattr(mod, "extract_from_notes", extract)
        asyncio.run(mod.refresh_note_suggestions(SESSION, "t1"))
        assert seen["notes"] == "now two litres"

    def test_cleared_notes_retire_the_suggestion_and_stop(self, seed, monkeypatch):
        seed("sheet", "transactions", [tx_row("t1", notes="")])
        asyncio.run(append_item_suggestions("tok", "sheet", [suggestion("t1")]))
        def boom(entries):
            raise AssertionError("no notes left — nothing to ask the AI about")
        monkeypatch.setattr(mod, "extract_from_notes", boom)

        assert asyncio.run(mod.refresh_note_suggestions(SESSION, "t1")) \
            == {"retired": 1, "added": 0}
        assert pending() == []

    def test_notes_too_short_cost_no_ai_call(self, seed, monkeypatch):
        seed("sheet", "transactions", [tx_row("t1", notes="ok")])
        def boom(entries):
            raise AssertionError("below the length floor")
        monkeypatch.setattr(mod, "extract_from_notes", boom)
        assert asyncio.run(mod.refresh_note_suggestions(SESSION, "t1"))["added"] == 0

    def test_a_deleted_transaction_is_not_an_error(self, seed, monkeypatch):
        monkeypatch.setattr(mod, "extract_from_notes",
                            lambda e: (_ for _ in ()).throw(AssertionError("no row")))
        assert asyncio.run(mod.refresh_note_suggestions(SESSION, "gone"))["added"] == 0

    def test_a_marker_row_is_written_when_nothing_is_found(self, a_suggested_transaction, monkeypatch):
        # Otherwise the next sweep pays for the same call all over again.
        async def extract(entries):
            return {}
        monkeypatch.setattr(mod, "extract_from_notes", extract)
        asyncio.run(mod.refresh_note_suggestions(SESSION, "t1"))
        rows = asyncio.run(get_item_suggestions("tok", "sheet"))
        live = [r for r in rows if r["status"] != SUPERSEDED]
        assert len(live) == 1
        assert live[0]["suggested"] == live[0]["current_val"]   # never offered
        assert pending() == []

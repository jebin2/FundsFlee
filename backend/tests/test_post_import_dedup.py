"""Post-import duplicate check — candidates scoped by date, not by recency.

The recency-based version broke on emailed statements: a hundred new rows
flooded the recent-200 window and pushed out the originals they duplicated.
"""
import asyncio
from types import SimpleNamespace

from app.email_import import post_import_duplicate_check as mod
from app.email_import.post_import_duplicate_check import (
    DEDUP_WINDOW_DAYS,
    deduplicate_new_transactions,
)

SESSION = SimpleNamespace(access_token="tok", sheet_id="sheet")


def _tx(tx_id, date, merchant="Swiggy", amount=450):
    return {"id": tx_id, "date": date, "merchant": merchant, "amount": amount,
            "source": "email", "notes": "", "item_name": ""}


def _wire(monkeypatch, all_txs, groups=None, error=None):
    seen = {"candidates": None, "window": None, "updates": []}

    async def fake_all(token, sheet_id):
        return all_txs

    async def fake_find(candidates, window_days=0):
        seen["candidates"] = candidates
        seen["window"] = window_days
        if error:
            raise error
        return groups or []

    async def fake_update(token, sheet_id, tx_id, fields):
        seen["updates"].append((tx_id, fields))

    monkeypatch.setattr(mod, "get_all_transactions", fake_all)
    monkeypatch.setattr(mod, "find_duplicates", fake_find)
    monkeypatch.setattr(mod, "update_transaction_field", fake_update)
    return seen


class TestScoping:
    def test_candidates_are_the_new_rows_date_span_widened(self, monkeypatch):
        all_txs = [
            _tx("old", "2026-01-01"),      # far outside — must not be sent
            _tx("near", "2026-07-13"),     # 2 days before, inside the window
            _tx("new", "2026-07-15"),
            _tx("edge", "2026-07-18"),     # exactly +3
            _tx("beyond", "2026-07-19"),   # +4, outside
        ]
        seen = _wire(monkeypatch, all_txs)
        asyncio.run(deduplicate_new_transactions(SESSION, ["new"]))
        assert sorted(t["id"] for t in seen["candidates"]) == ["edge", "near", "new"]
        assert seen["window"] == DEDUP_WINDOW_DAYS

    def test_a_statement_spanning_months_keeps_its_whole_span(self, monkeypatch):
        # The flooding case: many new rows across months. Every original in
        # that span must stay in the candidate set.
        all_txs = [_tx(f"old{i}", f"2026-0{m}-10") for i, m in enumerate((5, 6, 7))]
        all_txs += [_tx(f"new{i}", f"2026-0{m}-10") for i, m in enumerate((5, 6, 7))]
        seen = _wire(monkeypatch, all_txs)
        asyncio.run(deduplicate_new_transactions(SESSION, ["new0", "new1", "new2"]))
        assert len(seen["candidates"]) == 6

    def test_unrelated_recent_rows_are_excluded(self, monkeypatch):
        # Recency-based scoping would have sent all 50 purely for being new;
        # only the row actually near the import's date belongs.
        all_txs = ([_tx("new", "2026-01-15"), _tx("sameweek", "2026-01-16")]
                   + [_tx(f"r{i}", "2026-07-20") for i in range(50)])
        seen = _wire(monkeypatch, all_txs)
        asyncio.run(deduplicate_new_transactions(SESSION, ["new"]))
        assert sorted(t["id"] for t in seen["candidates"]) == ["new", "sameweek"]


class TestFlagging:
    def test_duplicates_are_flagged_with_a_reference(self, monkeypatch):
        all_txs = [_tx("a", "2026-07-15"), _tx("b", "2026-07-16")]
        seen = _wire(monkeypatch, all_txs,
                     groups=[{"original_id": "a", "duplicate_ids": ["b"], "reason": "same"}])
        asyncio.run(deduplicate_new_transactions(SESSION, ["b"]))
        assert seen["updates"] == [("b", {"is_duplicate": True, "duplicate_ref": "a"})]

    def test_a_failed_scan_leaves_the_import_intact(self, monkeypatch):
        all_txs = [_tx("a", "2026-07-15"), _tx("b", "2026-07-16")]
        seen = _wire(monkeypatch, all_txs, error=RuntimeError("provider down"))
        asyncio.run(deduplicate_new_transactions(SESSION, ["b"]))
        assert seen["updates"] == []  # nothing flagged, nothing lost


class TestNoOps:
    def test_no_new_ids_does_nothing(self, monkeypatch):
        seen = _wire(monkeypatch, [_tx("a", "2026-07-15")])
        asyncio.run(deduplicate_new_transactions(SESSION, []))
        assert seen["candidates"] is None

    def test_unknown_ids_do_nothing(self, monkeypatch):
        seen = _wire(monkeypatch, [_tx("a", "2026-07-15")])
        asyncio.run(deduplicate_new_transactions(SESSION, ["ghost"]))
        assert seen["candidates"] is None

    def test_a_lone_candidate_is_not_sent_to_the_ai(self, monkeypatch):
        seen = _wire(monkeypatch, [_tx("only", "2026-07-15")])
        asyncio.run(deduplicate_new_transactions(SESSION, ["only"]))
        assert seen["candidates"] is None

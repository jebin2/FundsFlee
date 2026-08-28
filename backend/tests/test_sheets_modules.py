"""The sheets data modules, now that writes are local.

Every one of these used to be an assertion about a Google API call. The calls
are gone — a write lands in the mirror and app/db/sync carries it out — so what
is worth pinning here is the data: what a read returns, and what a write leaves
behind. The requests themselves are tested in test_db_sync.py, once, instead of
per module.
"""
import asyncio

import pytest

import app.sheets.meta as meta_mod
import app.sheets.transactions as transactions_mod
from app.db import mirror
from app.sheets.transaction_schema import transaction_to_row
from tests.test_transaction_schema import BASE_TX


@pytest.fixture
def no_api(monkeypatch):
    """Nothing in these paths may reach Google. Anything that tries, fails."""
    def boom(*a, **kw):
        raise AssertionError("a write path called the Sheets API")
    for mod in (transactions_mod, meta_mod):
        monkeypatch.setattr(mod, "get_sheets_client", boom, raising=False)


def tx_row(tx_id: str, deleted: bool = False) -> list:
    return transaction_to_row({**BASE_TX, "id": tx_id, "deleted": deleted})


class TestGetTransactions:
    def test_pagination_returns_the_last_rows_first(self, no_api, seed):
        # 5 physical rows, page_size 2 -> page 1 is rows 5..6, the newest.
        seed("sheet", "transactions", [tx_row(f"t{i}") for i in range(1, 6)])

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 2))
        assert [t["id"] for t in page["transactions"]] == ["t4", "t5"]
        assert page["total"] == 5
        assert page["hasMore"] is True

    def test_last_page_clamps_to_row_2_and_has_more_false(self, no_api, seed):
        seed("sheet", "transactions", [tx_row(f"t{i}") for i in range(1, 4)])

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 2, 2))
        assert [t["id"] for t in page["transactions"]] == ["t1"]
        assert page["hasMore"] is False

    def test_deleted_rows_excluded_from_results_and_total(self, no_api, seed):
        seed("sheet", "transactions", [tx_row("t1"), tx_row("t2", deleted=True)])

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 200))
        assert [t["id"] for t in page["transactions"]] == ["t1"]
        assert page["total"] == 1  # visible count, not physical

    def test_a_deleted_row_still_occupies_its_page_slot(self, no_api, seed):
        # Page boundaries are physical rows, so a soft-deleted row is filtered
        # after slicing, not before. Otherwise pages would silently overlap.
        seed("sheet", "transactions",
             [tx_row("t1"), tx_row("t2", deleted=True), tx_row("t3")])

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 2))
        assert [t["id"] for t in page["transactions"]] == ["t3"]
        assert page["hasMore"] is True

    def test_empty_sheet(self, no_api):
        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet"))
        assert page == {"transactions": [], "total": 0, "hasMore": False}


class TestWritesLandLocally:
    def test_an_update_reaches_the_right_row(self, no_api, seed):
        seed("sheet", "transactions", [["t1"], ["t2"], ["t3"]])
        asyncio.run(transactions_mod.update_transaction_field(
            "tok", "sheet", "t2", {"merchant": "Zomato"}))

        rows = mirror.rows("tok", "sheet", "transactions")
        assert [r[6] for r in rows] == ["", "Zomato", ""]

    def test_an_update_stamps_updated_at(self, no_api, seed):
        seed("sheet", "transactions", [["t1"]])
        asyncio.run(transactions_mod.update_transaction_field(
            "tok", "sheet", "t1", {"merchant": "Zomato"}))
        assert mirror.rows("tok", "sheet", "transactions")[0][19] != ""

    def test_unknown_id_is_noop(self, no_api, seed):
        seed("sheet", "transactions", [["t1"]])
        asyncio.run(transactions_mod.update_transaction_field(
            "tok", "sheet", "missing", {"merchant": "X"}))
        assert mirror.rows("tok", "sheet", "transactions") == [
            ["t1"] + [""] * 26]

    def test_a_soft_delete_hides_the_row_but_keeps_it(self, no_api, seed):
        seed("sheet", "transactions", [["t1"]])
        asyncio.run(transactions_mod.update_transaction_field(
            "tok", "sheet", "t1", {"deleted": True}))

        assert asyncio.run(transactions_mod.get_transaction_by_id(
            "tok", "sheet", "t1")) is None
        # Still there: the row holds a sheet position that must not shift.
        assert len(mirror.rows("tok", "sheet", "transactions")) == 1

    def test_an_append_is_readable_immediately(self, no_api):
        asyncio.run(transactions_mod.append_transaction("tok", "sheet", dict(BASE_TX)))
        rows = asyncio.run(transactions_mod.get_all_transactions("tok", "sheet"))
        assert [r["id"] for r in rows] == [BASE_TX["id"]]

    def test_many_rows_keep_their_order(self, no_api):
        txs = [dict(BASE_TX, id=f"tx-{i:03d}") for i in range(50)]
        asyncio.run(transactions_mod.append_transactions("tok", "sheet", txs))

        rows = mirror.rows("tok", "sheet", "transactions")
        assert len(rows) == 50
        assert [r[0] for r in rows[:3]] == ["tx-000", "tx-001", "tx-002"]

    def test_appending_nothing_writes_nothing(self, no_api):
        asyncio.run(transactions_mod.append_transactions("tok", "sheet", []))
        assert mirror.rows("tok", "sheet", "transactions") == []


class TestMeta:
    def test_get_meta_values_parses_pairs(self, no_api, seed):
        seed("sheet", "meta", [["region", "IN"], ["empty_val"], [], ["", "x"]])
        meta = asyncio.run(meta_mod.get_meta_values("tok", "sheet"))
        assert meta == {"region": "IN", "empty_val": ""}

    def test_an_existing_key_is_updated_in_place(self, no_api, seed):
        seed("sheet", "meta", [["region"], ["name"]])
        asyncio.run(meta_mod.set_meta_value("tok", "sheet", "name", "Jebin"))

        assert mirror.rows("tok", "sheet", "meta") == [
            ["region", ""], ["name", "Jebin"]]

    def test_a_mixed_batch_updates_and_appends(self, no_api, seed):
        seed("sheet", "meta", [["region"]])
        asyncio.run(meta_mod.set_meta_values(
            "tok", "sheet", {"region": "IN", "fresh": "v"}))

        assert mirror.rows("tok", "sheet", "meta") == [
            ["region", "IN"], ["fresh", "v"]]

    def test_a_new_key_never_displaces_an_existing_row(self, no_api, seed):
        # An append that landed on an occupied row would put every later write
        # for that key on the wrong sheet line.
        seed("sheet", "meta", [["region", "IN"]])
        asyncio.run(meta_mod.set_meta_value("tok", "sheet", "new_key", "v"))
        assert mirror.rows("tok", "sheet", "meta") == [
            ["region", "IN"], ["new_key", "v"]]

    def test_an_empty_batch_touches_nothing(self, no_api):
        asyncio.run(meta_mod.set_meta_values("tok", "sheet", {}))
        assert mirror.rows("tok", "sheet", "meta") == []

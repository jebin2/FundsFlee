"""Behavioral tests for the sheets data modules with a fake Sheets client —
pagination math, soft-delete filtering, row-index caching, meta upsert."""
import asyncio

import pytest

import app.sheets.transactions as transactions_mod
import app.sheets.meta as meta_mod
from app.sheets.transaction_schema import ID_RANGE, LAST_COL, idx, transaction_to_row
from tests.test_transaction_schema import BASE_TX


class FakeRequest:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class FakeSheets:
    """Mimics googleapiclient sheets service for values().get/batchGet/append/update/batchUpdate."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.get_responses: dict[str, list] = {}      # range -> values
        self.batch_get_response: list[list] = []      # COLUMNS-major values per range

    def spreadsheets(self):
        return self

    def values(self):
        return self

    # values() methods
    def get(self, spreadsheetId=None, range=None, **kw):
        self.calls.append(("get", range))
        return FakeRequest(lambda: {"values": self.get_responses.get(range, [])})

    def batchGet(self, spreadsheetId=None, ranges=None, **kw):
        self.calls.append(("batchGet", tuple(ranges)))
        return FakeRequest(lambda: {
            "valueRanges": [{"values": v} for v in self.batch_get_response]
        })

    def append(self, spreadsheetId=None, range=None, body=None, **kw):
        self.calls.append(("append", range, body))
        return FakeRequest(lambda: {})

    def update(self, spreadsheetId=None, range=None, body=None, **kw):
        self.calls.append(("update", range, body))
        return FakeRequest(lambda: {})

    def batchUpdate(self, spreadsheetId=None, body=None, **kw):
        self.calls.append(("batchUpdate", body))
        return FakeRequest(lambda: {})


@pytest.fixture
def fake(monkeypatch):
    fake = FakeSheets()
    monkeypatch.setattr(transactions_mod, "get_sheets_client", lambda token: fake)
    monkeypatch.setattr(meta_mod, "get_sheets_client", lambda token: fake)
    # ensure_transaction_schema memo: mark the test sheet as already checked
    monkeypatch.setattr(transactions_mod, "ensure_transaction_schema_sync", lambda s, sid: None)
    transactions_mod._row_index_cache.clear()
    return fake


def tx_row(tx_id: str, deleted: bool = False) -> list:
    return transaction_to_row({**BASE_TX, "id": tx_id, "deleted": deleted})


class TestGetTransactions:
    def test_pagination_reads_last_rows_first(self, fake):
        # 5 physical rows, page_size 2 → page 1 reads rows 5..6 (A5:AA6)
        ids = [["t1"], ["t2"], ["t3"], ["t4"], ["t5"]]
        fake.batch_get_response = [[["t1", "t2", "t3", "t4", "t5"]], [["", "", "", "", ""]]]
        fake.get_responses[f"transactions!A5:{LAST_COL}6"] = [tx_row("t4"), tx_row("t5")]

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 2))
        assert [t["id"] for t in page["transactions"]] == ["t4", "t5"]
        assert page["total"] == 5
        assert page["hasMore"] is True
        assert ("get", f"transactions!A5:{LAST_COL}6") in fake.calls

    def test_last_page_clamps_to_row_2_and_has_more_false(self, fake):
        fake.batch_get_response = [[["t1", "t2", "t3"]], [[]]]
        fake.get_responses[f"transactions!A2:{LAST_COL}2"] = [tx_row("t1")]

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 2, 2))
        assert [t["id"] for t in page["transactions"]] == ["t1"]
        assert page["hasMore"] is False

    def test_deleted_rows_excluded_from_results_and_total(self, fake):
        fake.batch_get_response = [[["t1", "t2"]], [["", "TRUE"]]]
        fake.get_responses[f"transactions!A2:{LAST_COL}3"] = [tx_row("t1"), tx_row("t2", deleted=True)]

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 200))
        assert [t["id"] for t in page["transactions"]] == ["t1"]
        assert page["total"] == 1  # visible count, not physical

    def test_empty_sheet(self, fake):
        fake.batch_get_response = [[[]], [[]]]
        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet"))
        assert page == {"transactions": [], "total": 0, "hasMore": False}


class TestUpdateTransactionField:
    def test_writes_batch_update_at_cached_row(self, fake):
        fake.get_responses[ID_RANGE] = [["t1"], ["t2"], ["t3"]]
        asyncio.run(transactions_mod.update_transaction_field("tok", "sheet", "t2", {"merchant": "Zomato"}))

        batch = next(c for c in fake.calls if c[0] == "batchUpdate")
        ranges = [d["range"] for d in batch[1]["data"]]
        assert f"transactions!G3" in ranges        # merchant col G, row 3 (t2)
        assert any(r.startswith("transactions!T") for r in ranges)  # updated_at

    def test_unknown_id_is_noop(self, fake):
        fake.get_responses[ID_RANGE] = [["t1"]]
        asyncio.run(transactions_mod.update_transaction_field("tok", "sheet", "missing", {"merchant": "X"}))
        assert not any(c[0] == "batchUpdate" for c in fake.calls)

    def test_soft_delete_invalidates_row_cache(self, fake):
        fake.get_responses[ID_RANGE] = [["t1"]]
        asyncio.run(transactions_mod.update_transaction_field("tok", "sheet", "t1", {"deleted": True}))
        assert "sheet" not in transactions_mod._row_index_cache

    def test_append_invalidates_row_cache(self, fake):
        transactions_mod._row_index_cache["sheet"] = {"t1": 2}
        asyncio.run(transactions_mod.append_transaction("tok", "sheet", dict(BASE_TX)))
        assert "sheet" not in transactions_mod._row_index_cache
        append = next(c for c in fake.calls if c[0] == "append")
        assert append[1] == "transactions!A2"
        assert append[2]["values"][0][idx("id")] == "tx-001"

    def test_many_rows_go_in_one_request(self, fake):
        # Sheets bills per request against a per-minute write quota, so a
        # fifty-order import must not become fifty appends.
        txs = [dict(BASE_TX, id=f"tx-{i:03d}") for i in range(50)]
        asyncio.run(transactions_mod.append_transactions("tok", "sheet", txs))

        appends = [c for c in fake.calls if c[0] == "append"]
        assert len(appends) == 1
        rows = appends[0][2]["values"]
        assert len(rows) == 50
        assert [r[idx("id")] for r in rows[:3]] == ["tx-000", "tx-001", "tx-002"]

    def test_appending_nothing_makes_no_request(self, fake):
        asyncio.run(transactions_mod.append_transactions("tok", "sheet", []))
        assert [c for c in fake.calls if c[0] == "append"] == []


class TestMeta:
    def test_get_meta_values_parses_pairs(self, fake):
        fake.get_responses["meta!A2:B100"] = [["region", "IN"], ["empty_val"], [], ["", "x"]]
        meta = asyncio.run(meta_mod.get_meta_values("tok", "sheet"))
        assert meta == {"region": "IN", "empty_val": ""}

    def test_set_meta_value_updates_existing_row(self, fake):
        fake.get_responses["meta!A2:A100"] = [["region"], ["name"]]
        asyncio.run(meta_mod.set_meta_value("tok", "sheet", "name", "Jebin"))
        update = next(c for c in fake.calls if c[0] == "update")
        assert update[1] == "meta!B3"
        assert update[2]["values"] == [["Jebin"]]

    def test_set_meta_value_appends_new_key(self, fake):
        fake.get_responses["meta!A2:A100"] = [["region"]]
        asyncio.run(meta_mod.set_meta_value("tok", "sheet", "new_key", "v"))
        append = next(c for c in fake.calls if c[0] == "append")
        assert append[1] == "meta!A2"
        assert append[2]["values"] == [["new_key", "v"]]

"""Behavioral tests for the sheets data modules with a fake Sheets client —
pagination math, soft-delete filtering, row-index caching, meta upsert."""
import asyncio

import pytest

import app.sheets.transactions as transactions_mod
import app.sheets.meta as meta_mod
from app.sheets.transaction_schema import idx, transaction_to_row
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
        self.append_response: dict = {"updates": {"updatedRange": "transactions!A2:AA2"}}

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
        return FakeRequest(lambda: self.append_response)

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
    monkeypatch.setattr(transactions_mod, "ensure_date_column_format_sync", lambda s, sid: None)
    return fake


def tx_row(tx_id: str, deleted: bool = False) -> list:
    return transaction_to_row({**BASE_TX, "id": tx_id, "deleted": deleted})


class TestGetTransactions:
    def test_pagination_returns_the_last_rows_first(self, fake, seed):
        # 5 physical rows, page_size 2 -> page 1 is rows 5..6, the newest.
        seed("sheet", "transactions", [tx_row(f"t{i}") for i in range(1, 6)])

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 2))
        assert [t["id"] for t in page["transactions"]] == ["t4", "t5"]
        assert page["total"] == 5
        assert page["hasMore"] is True

    def test_it_costs_no_api_call(self, fake, seed):
        # The whole point of the move: paging used to be a batchGet plus a
        # ranged read, every time.
        seed("sheet", "transactions", [tx_row(f"t{i}") for i in range(1, 6)])
        asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 2))
        assert fake.calls == []

    def test_last_page_clamps_to_row_2_and_has_more_false(self, fake, seed):
        seed("sheet", "transactions", [tx_row(f"t{i}") for i in range(1, 4)])

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 2, 2))
        assert [t["id"] for t in page["transactions"]] == ["t1"]
        assert page["hasMore"] is False

    def test_deleted_rows_excluded_from_results_and_total(self, fake, seed):
        seed("sheet", "transactions", [tx_row("t1"), tx_row("t2", deleted=True)])

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 200))
        assert [t["id"] for t in page["transactions"]] == ["t1"]
        assert page["total"] == 1  # visible count, not physical

    def test_a_deleted_row_still_occupies_its_page_slot(self, fake, seed):
        # Page boundaries are physical rows, so a soft-deleted row is filtered
        # after slicing, not before. Otherwise pages would silently overlap.
        seed("sheet", "transactions",
             [tx_row("t1"), tx_row("t2", deleted=True), tx_row("t3")])

        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet", 1, 2))
        assert [t["id"] for t in page["transactions"]] == ["t3"]
        assert page["hasMore"] is True

    def test_empty_sheet(self, fake):
        page = asyncio.run(transactions_mod.get_transactions("tok", "sheet"))
        assert page == {"transactions": [], "total": 0, "hasMore": False}


class TestUpdateTransactionField:
    def test_writes_batch_update_at_the_right_row(self, fake, seed):
        seed("sheet", "transactions", [["t1"], ["t2"], ["t3"]])
        asyncio.run(transactions_mod.update_transaction_field("tok", "sheet", "t2", {"merchant": "Zomato"}))

        batch = next(c for c in fake.calls if c[0] == "batchUpdate")
        ranges = [d["range"] for d in batch[1]["data"]]
        assert "transactions!G3" in ranges        # merchant col G, row 3 (t2)
        assert any(r.startswith("transactions!T") for r in ranges)  # updated_at

    def test_unknown_id_is_noop(self, fake, seed):
        seed("sheet", "transactions", [["t1"]])
        asyncio.run(transactions_mod.update_transaction_field("tok", "sheet", "missing", {"merchant": "X"}))
        assert not any(c[0] == "batchUpdate" for c in fake.calls)

    def test_a_soft_delete_reaches_the_mirror(self, fake, seed):
        seed("sheet", "transactions", [["t1"]])
        asyncio.run(transactions_mod.update_transaction_field("tok", "sheet", "t1", {"deleted": True}))
        row = asyncio.run(transactions_mod.get_transaction_by_id("tok", "sheet", "t1"))
        assert row is None      # filtered out as deleted

    def test_an_append_reaches_the_mirror(self, fake):
        asyncio.run(transactions_mod.append_transaction("tok", "sheet", dict(BASE_TX)))
        rows = asyncio.run(transactions_mod.get_all_transactions("tok", "sheet"))
        assert [r["id"] for r in rows] == [BASE_TX["id"]]
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


class TestDateCells:
    """Only the date column may be reinterpreted by Sheets. USER_ENTERED on a
    whole row would evaluate a merchant like "=Zomato" and reformat the ISO
    timestamps in created_at/updated_at."""

    def test_row_is_written_raw(self, fake):
        asyncio.run(transactions_mod.append_transactions("tok", "sheet", [dict(BASE_TX)]))
        append = next(c for c in fake.calls if c[0] == "append")
        assert append[2] is not None
        # the append itself never uses USER_ENTERED
        assert "USER_ENTERED" not in str(append)

    def test_only_the_date_column_is_converted(self, fake):
        fake.append_response = {"updates": {"updatedRange": "transactions!A5:AA6"}}
        txs = [dict(BASE_TX, id="a", date="2026-07-29"), dict(BASE_TX, id="b", date="2026-07-30")]
        asyncio.run(transactions_mod.append_transactions("tok", "sheet", txs))

        update = next(c for c in fake.calls if c[0] == "update" and c[1].startswith("transactions!B"))
        assert update[1] == "transactions!B5:B6"
        assert update[2]["values"] == [["2026-07-29"], ["2026-07-30"]]

    def test_no_conversion_when_the_range_is_unknown(self, fake):
        fake.append_response = {}
        asyncio.run(transactions_mod.append_transactions("tok", "sheet", [dict(BASE_TX)]))
        assert [c for c in fake.calls if c[0] == "update" and c[1].startswith("transactions!B")] == []

    def test_editing_a_date_keeps_it_a_date(self, fake, seed):
        seed("sheet", "transactions", [[f"pad{i}"] for i in range(5)] + [["t1"]])
        asyncio.run(transactions_mod.update_transaction_field(
            "tok", "sheet", "t1", {"date": "2026-08-01", "merchant": "Swiggy"}))

        batches = [c for c in fake.calls if c[0] == "batchUpdate"]
        modes = {b[1]["valueInputOption"] for b in batches}
        assert modes == {"RAW", "USER_ENTERED"}

        entered = next(b for b in batches if b[1]["valueInputOption"] == "USER_ENTERED")
        assert [d["range"] for d in entered[1]["data"]] == ["transactions!B7"]

        raw = next(b for b in batches if b[1]["valueInputOption"] == "RAW")
        assert all(not d["range"].startswith("transactions!B") for d in raw[1]["data"])

    def test_an_edit_without_a_date_stays_a_single_raw_write(self, fake, seed):
        seed("sheet", "transactions", [[f"pad{i}"] for i in range(5)] + [["t1"]])
        asyncio.run(transactions_mod.update_transaction_field(
            "tok", "sheet", "t1", {"merchant": "Swiggy"}))
        batches = [c for c in fake.calls if c[0] == "batchUpdate"]
        assert len(batches) == 1
        assert batches[0][1]["valueInputOption"] == "RAW"


class TestMeta:
    def test_get_meta_values_parses_pairs(self, fake, seed):
        # Reads come from the mirror now; the sheet is written to, not read.
        seed("sheet", "meta", [["region", "IN"], ["empty_val"], [], ["", "x"]])
        meta = asyncio.run(meta_mod.get_meta_values("tok", "sheet"))
        assert meta == {"region": "IN", "empty_val": ""}

    def test_set_meta_value_updates_existing_row(self, fake, seed):
        seed("sheet", "meta", [["region"], ["name"]])
        asyncio.run(meta_mod.set_meta_value("tok", "sheet", "name", "Jebin"))
        batch = next(c for c in fake.calls if c[0] == "batchUpdate")
        assert batch[1]["data"] == [{"range": "meta!B3", "values": [["Jebin"]]}]

    def test_many_keys_cost_no_reads(self, fake, seed):
        # Each key used to read meta!A2:A100 for itself, so saving four
        # settings was four reads against a 60-per-minute quota. It is now
        # zero: the row positions come from the mirror.
        seed("sheet", "meta", [["region"], ["name"]])
        asyncio.run(meta_mod.set_meta_values("tok", "sheet", {"region": "IN", "name": "J"}))

        assert [c for c in fake.calls if c[0] == "get"] == []
        batch = next(c for c in fake.calls if c[0] == "batchUpdate")
        assert batch[1]["data"] == [
            {"range": "meta!B2", "values": [["IN"]]},
            {"range": "meta!B3", "values": [["J"]]},
        ]

    def test_a_mixed_batch_updates_and_appends(self, fake, seed):
        seed("sheet", "meta", [["region"]])
        asyncio.run(meta_mod.set_meta_values("tok", "sheet", {"region": "IN", "fresh": "v"}))
        assert next(c for c in fake.calls if c[0] == "batchUpdate")[1]["data"] == [
            {"range": "meta!B2", "values": [["IN"]]}]
        assert next(c for c in fake.calls if c[0] == "append")[2]["values"] == [["fresh", "v"]]

    def test_an_empty_batch_touches_nothing(self, fake):
        asyncio.run(meta_mod.set_meta_values("tok", "sheet", {}))
        assert fake.calls == []

    def test_set_meta_value_appends_new_key(self, fake, seed):
        seed("sheet", "meta", [["region"]])
        asyncio.run(meta_mod.set_meta_value("tok", "sheet", "new_key", "v"))
        append = next(c for c in fake.calls if c[0] == "append")
        assert append[1] == "meta!A2"
        assert append[2]["values"] == [["new_key", "v"]]

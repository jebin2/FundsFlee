"""Reset must leave a correct, empty schema behind.

The ranges used to be typed by hand, which is how transactions!A2:Z came to
skip column AA — a reset left the merge_id of every old row in place.
"""
import asyncio

import pytest

import app.sheets.init as init_mod
import app.sheets.transactions as transactions_mod
from app.sheets.headers import EXPECTED_HEADERS
from app.sheets.init import _DATA_RANGES, _HEADER_WRITES, _col_letter
from app.sheets.transaction_schema import COLS, LAST_COL


class FakeRequest:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class FakeSheets:
    def __init__(self):
        self.cleared: list[str] = []
        self.header_writes: list[str] = []

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def batchClear(self, spreadsheetId=None, body=None, **kw):
        self.cleared.extend(body["ranges"])
        return FakeRequest(lambda: {})

    def update(self, spreadsheetId=None, range=None, body=None, **kw):
        self.header_writes.append(range)
        return FakeRequest(lambda: {})

    def append(self, spreadsheetId=None, range=None, body=None, **kw):
        return FakeRequest(lambda: {})


@pytest.fixture
def fake(monkeypatch):
    fake = FakeSheets()
    monkeypatch.setattr(init_mod, "get_sheets_client", lambda token: fake)
    monkeypatch.setattr(init_mod, "seed_default_categories_sync", lambda s, sid: None)
    return fake


class TestColumnLetters:
    def test_maps_counts_past_z(self):
        assert (_col_letter(1), _col_letter(26), _col_letter(27)) == ("A", "Z", "AA")

    def test_transactions_range_covers_every_column(self):
        assert _col_letter(len(COLS)) == LAST_COL == "AA"


class TestReset:
    def test_clears_through_the_last_column(self, fake):
        asyncio.run(init_mod.reset_sheet("tok", "sheet"))
        assert f"transactions!A2:{LAST_COL}" in fake.cleared

    def test_clears_every_tab(self, fake):
        asyncio.run(init_mod.reset_sheet("tok", "sheet"))
        assert sorted(fake.cleared) == sorted(_DATA_RANGES)
        assert len(fake.cleared) == 6

    def test_leaves_the_header_row_restored(self, fake):
        asyncio.run(init_mod.reset_sheet("tok", "sheet"))
        assert f"transactions!A1:{_col_letter(len(EXPECTED_HEADERS))}1" in fake.header_writes
        assert len([w for w in fake.header_writes if "!A1:" in w]) == len(_HEADER_WRITES)

    def test_drops_the_stale_row_index(self, fake):
        # Cached id -> row numbers all point at cleared rows after a reset;
        # keeping them would let an update resurrect a row.
        transactions_mod._row_index_cache["sheet"] = {"old-tx": 5}
        asyncio.run(init_mod.reset_sheet("tok", "sheet"))
        assert "sheet" not in transactions_mod._row_index_cache

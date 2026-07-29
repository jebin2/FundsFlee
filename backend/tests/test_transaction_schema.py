"""Port of src/__tests__/transactionSchema.test.ts — same cases, same names.
(transactionList.test.ts covers frontend utils and stays with the SPA.)"""
from app.sheets.transaction_schema import (
    COLS,
    idx,
    is_deleted_row,
    letter,
    row_to_transaction,
    transaction_to_row,
    transaction_update_to_cells,
)

BASE_TX = {
    "id": "tx-001",
    "date": "2025-04-26",
    "time": "14:30",
    "amount": 450,
    "merchant": "Swiggy",
    "category": "Food & Dining",
    "payment_method": "UPI",
    "source": "sms",
    "created_at": "2025-04-26T14:30:00.000Z",
    "updated_at": "2025-04-26T14:30:00.000Z",
    "status": "done",
    "is_duplicate": False,
}


class TestTransactionToRow:
    def test_places_every_field_in_the_correct_column_index(self):
        row = transaction_to_row(BASE_TX)
        assert row[idx("id")] == "tx-001"
        assert row[idx("date")] == "2025-04-26"
        assert row[idx("time")] == "14:30"
        assert row[idx("amount")] == 450
        assert row[idx("merchant")] == "Swiggy"
        assert row[idx("category")] == "Food & Dining"
        assert row[idx("payment_method")] == "UPI"
        assert row[idx("source")] == "sms"
        assert row[idx("is_duplicate")] == "FALSE"
        assert row[idx("status")] == "done"
        assert row[idx("deleted")] == ""

    def test_serialises_is_duplicate_true_as_TRUE(self):
        row = transaction_to_row({**BASE_TX, "is_duplicate": True})
        assert row[idx("is_duplicate")] == "TRUE"

    def test_serialises_deleted_true_as_TRUE_falsy_as_empty_string(self):
        deleted = transaction_to_row({**BASE_TX, "deleted": True})
        assert deleted[idx("deleted")] == "TRUE"
        normal = transaction_to_row(BASE_TX)
        assert normal[idx("deleted")] == ""

    def test_joins_tags_array_as_comma_separated_string(self):
        row = transaction_to_row({**BASE_TX, "tags": ["food", "upi"]})
        assert row[idx("tags")] == "food,upi"

    def test_uses_empty_string_for_optional_missing_fields(self):
        row = transaction_to_row(BASE_TX)
        assert row[idx("item_name")] == ""
        assert row[idx("notes")] == ""
        assert row[idx("original_amount")] == ""


class TestRowToTransaction:
    def test_roundtrips_a_full_transaction_through_row_and_back(self):
        row = transaction_to_row(BASE_TX)
        result = row_to_transaction(row)
        assert result["id"] == BASE_TX["id"]
        assert result["date"] == BASE_TX["date"]
        assert result["amount"] == BASE_TX["amount"]
        assert result["merchant"] == BASE_TX["merchant"]
        assert result["is_duplicate"] is False
        assert result["status"] == "done"

    def test_parses_is_duplicate_TRUE_FALSE_correctly(self):
        row_true = transaction_to_row({**BASE_TX, "is_duplicate": True})
        assert row_to_transaction(row_true)["is_duplicate"] is True
        row_false = transaction_to_row({**BASE_TX, "is_duplicate": False})
        assert row_to_transaction(row_false)["is_duplicate"] is False

    def test_parses_original_amount_when_present(self):
        row = transaction_to_row({**BASE_TX, "original_amount": 5.99, "original_currency": "USD"})
        tx = row_to_transaction(row)
        assert tx["original_amount"] == 5.99
        assert tx["original_currency"] == "USD"

    def test_splits_comma_separated_tags_back_into_an_array(self):
        row = transaction_to_row({**BASE_TX, "tags": ["food", "upi"]})
        assert row_to_transaction(row)["tags"] == ["food", "upi"]

    def test_omits_optional_fields_when_empty(self):
        # TS returns undefined → key omitted in JSON; Python omits the key
        row = transaction_to_row(BASE_TX)
        tx = row_to_transaction(row)
        assert "item_name" not in tx
        assert "notes" not in tx
        assert "original_amount" not in tx
        assert "tags" not in tx

    def test_defaults_payment_method_source_status_when_missing(self):
        sparse = [""] * 25
        sparse[idx("id")] = "tx-sparse"
        tx = row_to_transaction(sparse)
        assert tx["payment_method"] == "Other"
        assert tx["source"] == "manual"
        assert tx["status"] == "done"

    def test_amount_integral_floats_collapse_to_int(self):
        # JSON parity: JS parseFloat("450") → 450, not 450.0
        row = transaction_to_row(BASE_TX)
        tx = row_to_transaction(row)
        assert isinstance(tx["amount"], int)
        assert tx["amount"] == 450


class TestIsDeletedRow:
    def test_returns_true_when_deleted_column_is_TRUE(self):
        row = transaction_to_row({**BASE_TX, "deleted": True})
        assert is_deleted_row(row) is True

    def test_returns_true_for_legacy_DELETED_notes_sentinel(self):
        row = [""] * 25
        row[idx("notes")] = "__DELETED__"
        assert is_deleted_row(row) is True

    def test_returns_false_for_a_normal_row(self):
        row = transaction_to_row(BASE_TX)
        assert is_deleted_row(row) is False


class TestTransactionUpdateToCells:
    FIXED_NOW = "2025-04-26T15:00:00.000Z"

    def test_always_includes_updated_at_in_the_batch(self):
        cells = transaction_update_to_cells({"merchant": "Zomato"}, 5, self.FIXED_NOW)
        ranges = [c["range"] for c in cells]
        assert f"transactions!{letter('updated_at')}5" in ranges
        assert f"transactions!{letter('merchant')}5" in ranges

    def test_uses_the_correct_row_number_in_the_range(self):
        cells = transaction_update_to_cells({"category": "Transport"}, 42, self.FIXED_NOW)
        for c in cells:
            assert c["range"].endswith("42")

    def test_serialises_is_duplicate_update_as_TRUE_FALSE(self):
        cells = transaction_update_to_cells({"is_duplicate": True}, 3, self.FIXED_NOW)
        dup_cell = next(c for c in cells if letter("is_duplicate") in c["range"])
        assert dup_cell["values"][0][0] == "TRUE"

    def test_serialises_deleted_true_as_TRUE_false_as_empty_string(self):
        cells_true = transaction_update_to_cells({"deleted": True}, 3, self.FIXED_NOW)
        true_cell = next(c for c in cells_true if letter("deleted") in c["range"])
        assert true_cell["values"][0][0] == "TRUE"

        cells_false = transaction_update_to_cells({"deleted": False}, 3, self.FIXED_NOW)
        false_cell = next(c for c in cells_false if letter("deleted") in c["range"])
        assert false_cell["values"][0][0] == ""

    def test_joins_tags_array_before_writing(self):
        cells = transaction_update_to_cells({"tags": ["a", "b"]}, 3, self.FIXED_NOW)
        tags_cell = next(c for c in cells if letter("tags") in c["range"])
        assert tags_cell["values"][0][0] == "a,b"

    def test_does_not_include_id_or_created_at_columns(self):
        cells = transaction_update_to_cells({"merchant": "X"}, 3, self.FIXED_NOW)
        ranges = [c["range"] for c in cells]
        assert not any(r == f"transactions!{letter('id')}3" for r in ranges)
        assert not any(r == f"transactions!{letter('created_at')}3" for r in ranges)


class TestHeadersIntegrity:
    def test_cols_match_expected_headers_order(self):
        from app.sheets.headers import EXPECTED_HEADERS
        # Every column must have a header, in the same order — merge_id at AA
        # used to fall past the header row and be written under a blank one.
        assert tuple(COLS) == EXPECTED_HEADERS
        for i, name in enumerate(EXPECTED_HEADERS):
            assert COLS[name][0] == i

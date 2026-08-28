"""Port of src/__tests__/transactionSchema.test.ts — same cases, same names.
(transactionList.test.ts covers frontend utils and stays with the SPA.)"""
from app.sheets.transaction_schema import (
    COLS,
    idx,
    is_deleted_row,
    row_to_transaction,
    transaction_to_row,
    transaction_update_to_fields,
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


class TestTransactionUpdateToFields:
    """The one normalisation a partial update goes through.

    It used to feed a batch of sheet cell writes; it now feeds a local row
    update. Same rules either way — what a boolean, a tag list and updated_at
    turn into on their way to storage.
    """
    FIXED_NOW = "2025-04-26T15:00:00.000Z"

    def test_always_includes_updated_at(self):
        fields = transaction_update_to_fields({"merchant": "Zomato"}, self.FIXED_NOW)
        assert fields["updated_at"] == self.FIXED_NOW
        assert fields["merchant"] == "Zomato"

    def test_touches_only_the_updated_columns(self):
        fields = transaction_update_to_fields({"category": "Transport"}, self.FIXED_NOW)
        assert set(fields) == {"category", "updated_at"}

    def test_serialises_is_duplicate_update_as_TRUE_FALSE(self):
        assert transaction_update_to_fields(
            {"is_duplicate": True}, self.FIXED_NOW)["is_duplicate"] == "TRUE"
        assert transaction_update_to_fields(
            {"is_duplicate": False}, self.FIXED_NOW)["is_duplicate"] == "FALSE"

    def test_serialises_deleted_true_as_TRUE_false_as_empty_string(self):
        assert transaction_update_to_fields(
            {"deleted": True}, self.FIXED_NOW)["deleted"] == "TRUE"
        assert transaction_update_to_fields(
            {"deleted": False}, self.FIXED_NOW)["deleted"] == ""

    def test_joins_tags_array_before_writing(self):
        assert transaction_update_to_fields(
            {"tags": ["a", "b"]}, self.FIXED_NOW)["tags"] == "a,b"

    def test_does_not_include_id_or_created_at(self):
        fields = transaction_update_to_fields({"merchant": "X"}, self.FIXED_NOW)
        assert "id" not in fields and "created_at" not in fields

    def test_every_field_is_a_real_column(self):
        # The mirror rejects an unknown column, so a typo here is a failed save
        # rather than a silently ignored cell as it was on the sheet.
        fields = transaction_update_to_fields(
            {"merchant": "X", "amount": 12, "nonsense": True}, self.FIXED_NOW)
        assert set(fields) <= set(COLS)


class TestHeadersIntegrity:
    def test_cols_match_expected_headers_order(self):
        from app.sheets.headers import EXPECTED_HEADERS
        # Every column must have a header, in the same order — merge_id at AA
        # used to fall past the header row and be written under a blank one.
        assert tuple(COLS) == EXPECTED_HEADERS
        for i, name in enumerate(EXPECTED_HEADERS):
            assert COLS[name][0] == i


class TestDateNormalisation:
    """The date column is stored as a real date; the read must still hand the
    app YYYY-MM-DD, because every comparison in the app is a string compare."""

    def test_iso_passes_through_untouched(self):
        assert row_to_transaction(transaction_to_row(BASE_TX))["date"] == BASE_TX["date"]

    def test_a_serial_number_is_converted(self):
        # If the column format failed to apply, Sheets hands back a day count.
        from datetime import date as _date
        serial = (_date(2026, 8, 1) - _date(1899, 12, 30)).days
        row = transaction_to_row(BASE_TX)
        row[idx("date")] = serial
        assert row_to_transaction(row)["date"] == "2026-08-01"

    def test_an_unrecognised_shape_is_left_alone(self):
        # Guessing between 07/08 and 08/07 could silently corrupt a date.
        row = transaction_to_row(BASE_TX)
        row[idx("date")] = "01/08/2026"
        assert row_to_transaction(row)["date"] == "01/08/2026"

    def test_empty_stays_empty(self):
        row = transaction_to_row(BASE_TX)
        row[idx("date")] = ""
        assert row_to_transaction(row)["date"] == ""

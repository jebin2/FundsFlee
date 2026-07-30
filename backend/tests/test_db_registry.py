"""The registry is the single definition of a tab. If a range here is wrong,
it is wrong in the DDL, the sheet header, hydration and the sync push at once —
which is the point, and why it gets tests.
"""
import pytest

from app.db.registry import TABS, TAB_BY_NAME, col_letter, spec
from app.db.schema import create_table_sql, mirror_ddl, q, trigger_sql


class TestColumnLetters:
    def test_the_first_column(self):
        assert col_letter(1) == "A"

    def test_the_last_single_letter(self):
        assert col_letter(26) == "Z"

    def test_it_carries_past_z(self):
        # 27 columns is exactly the transactions tab. A hand-typed A2:Z is how
        # column AA came to be skipped by both the header write and the reset.
        assert col_letter(27) == "AA"

    def test_it_keeps_carrying(self):
        assert col_letter(52) == "AZ"
        assert col_letter(53) == "BA"


class TestRanges:
    def test_transactions_spans_all_27_columns(self):
        assert spec("transactions").data_range == "transactions!A2:AA"

    def test_the_header_range_is_row_one_only(self):
        assert spec("meta").header_range == "meta!A1:B1"

    def test_the_data_range_is_open_ended(self):
        # A fixed ceiling is how edits past row 5000 came to silently no-op.
        assert spec("meta").data_range.endswith("!A2:B")

    def test_a_single_row_range(self):
        assert spec("parsed_emails").row_range(7) == "parsed_emails!A7:G7"

    def test_a_block_range(self):
        assert spec("categories").block_range(2, 500) == "categories!A2:G500"


class TestEveryTabIsDeclared:
    def test_all_six_tabs(self):
        assert set(TAB_BY_NAME) == {
            "transactions", "categories", "analysis_cache",
            "item_suggestions", "meta", "parsed_emails"}

    def test_every_key_is_a_real_column(self):
        for s in TABS:
            assert set(s.key) <= set(s.columns), s.name

    def test_item_suggestions_is_composite(self):
        # Keyed by (key, field) — a transaction can have a suggestion for more
        # than one field.
        assert spec("item_suggestions").key == ("key", "field")


class TestRowConversion:
    def test_columns_come_out_in_sheet_order(self):
        s = spec("meta")
        assert s.to_row({"value": "v", "key": "k"}) == ["k", "v"]

    def test_missing_fields_become_empty_not_none(self):
        # The sheet has no concept of null; None would serialise as "None".
        assert spec("meta").to_row({"key": "k"}) == ["k", ""]

    def test_explicit_none_becomes_empty(self):
        assert spec("meta").to_row({"key": "k", "value": None}) == ["k", ""]


class TestGeneratedSql:
    def test_reserved_words_are_quoted(self):
        # parsed_emails has a column literally called "from".
        sql = create_table_sql(spec("parsed_emails"))
        assert '"from"' in sql

    def test_a_column_is_declared_for_every_header(self):
        s = spec("transactions")
        sql = create_table_sql(s)
        for column in s.columns:
            assert q(column) in sql

    def test_triggers_cover_insert_and_update(self):
        sql = " ".join(trigger_sql(spec("meta")))
        assert "AFTER INSERT" in sql and "AFTER UPDATE" in sql

    def test_there_is_no_delete_trigger(self):
        # There is no delete. Row position is row identity, so removing a row
        # would repoint every row below it at the wrong sheet line.
        assert "AFTER DELETE" not in " ".join(trigger_sql(spec("meta")))

    def test_the_ddl_covers_every_tab(self):
        ddl = " ".join(mirror_ddl())
        for s in TABS:
            assert q(s.name) in ddl


class TestQuoting:
    def test_embedded_quotes_are_escaped(self):
        assert q('we"ird') == '"we""ird"'

    @pytest.mark.parametrize("name", ["from", "key", "value", "status"])
    def test_reserved_words_survive(self, name):
        assert q(name) == f'"{name}"'

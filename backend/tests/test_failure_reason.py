"""A failed row has to say why.

The status said "failed" and nothing said what went wrong, so the cause lived
only in a server log the person looking at the transaction cannot read — and
the UI filled the gap by guessing "receipt", whatever the row's source was.
"""
import sqlite3
import pytest

import app.db.connection as conn_mod
import app.db.registry as reg
import app.db.schema as schema_mod
from app.db import Repo, connect, spec
from app.domain.transactions.failure import MAX_REASON, reason_for
from app.sheets.transaction_schema import (
    row_to_transaction,
    transaction_to_row,
    transaction_update_to_fields,
)


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
    conn_mod._schema_ready.clear()
    yield
    conn_mod._schema_ready.clear()


class TestTheReasonIsReadable:
    def test_a_deleted_drive_file_says_so(self):
        assert "deleted" in reason_for(
            Exception("HttpError 404 ... File not found: 1AbCdEf")).lower()

    def test_a_missing_api_key_names_the_key(self):
        assert "api key" in reason_for(Exception("401 Unauthorized: invalid api key")).lower()

    def test_a_rate_limit_says_to_retry(self):
        assert "retry" in reason_for(Exception("429 RESOURCE_EXHAUSTED")).lower()

    def test_an_unknown_error_is_kept_verbatim(self):
        # Better a raw message the user can quote than "something went wrong".
        assert reason_for(ValueError("kaboom")) == "ValueError: kaboom"

    def test_a_long_message_is_trimmed_to_fit_a_cell(self):
        assert len(reason_for(ValueError("x" * 5000))) == MAX_REASON

    def test_a_plain_string_passes_through(self):
        assert reason_for("No receipt is attached.") == "No receipt is attached."


class TestItSurvivesTheRoundTrip:
    def test_it_reaches_the_row_and_comes_back(self):
        tx = {"id": "t1", "date": "2026-08-29", "time": "10:00", "amount": 10,
              "merchant": "Zomato", "category": "Food", "payment_method": "UPI",
              "source": "receipt", "created_at": "x", "updated_at": "x",
              "status": "failed", "failure_reason": "The receipt was deleted."}
        assert row_to_transaction(transaction_to_row(tx))["failure_reason"] \
            == "The receipt was deleted."

    def test_a_row_without_one_omits_the_key(self):
        # Optional fields stay absent rather than empty, as everywhere else.
        tx = {"id": "t1", "date": "d", "time": "t", "amount": 1, "merchant": "m",
              "category": "c", "payment_method": "UPI", "source": "manual",
              "created_at": "x", "updated_at": "x", "status": "done"}
        assert "failure_reason" not in row_to_transaction(transaction_to_row(tx))


class TestTheReasonDoesNotOutliveTheFailure:
    def test_succeeding_clears_it(self):
        assert transaction_update_to_fields({"status": "done"})["failure_reason"] == ""

    def test_retrying_clears_it(self):
        assert transaction_update_to_fields({"status": "queued"})["failure_reason"] == ""

    def test_failing_does_not_clear_it(self):
        assert "failure_reason" not in transaction_update_to_fields({"status": "failed"})

    def test_an_unrelated_edit_leaves_it_alone(self):
        assert "failure_reason" not in transaction_update_to_fields({"merchant": "Zomato"})

    def test_an_explicit_reason_wins(self):
        fields = transaction_update_to_fields({"status": "failed", "failure_reason": "why"})
        assert fields["failure_reason"] == "why"


class TestAMirrorBuiltBeforeTheColumn:
    """Every deployed mirror is one of these — CREATE TABLE IF NOT EXISTS does
    nothing to a table that already exists, so without a widening step the
    column would only ever reach a fresh install."""

    @pytest.fixture
    def old_mirror(self, monkeypatch):
        """A mirror built without the last column, then reopened."""
        narrow = tuple(c for c in reg.EXPECTED_HEADERS if c != "failure_reason")
        original = reg.TABS
        aged = tuple(
            reg.TabSpec(s.name, narrow if s.name == "transactions" else s.columns,
                        s.key, s.user_entered)
            for s in original
        )
        monkeypatch.setattr(reg, "TABS", aged)
        monkeypatch.setattr(schema_mod, "TABS", aged)
        conn = connect("aged")
        conn.execute("INSERT INTO transactions (id, merchant, status) "
                     "VALUES ('t1', 'Zomato', 'failed')")
        conn.close()
        monkeypatch.setattr(reg, "TABS", original)
        monkeypatch.setattr(schema_mod, "TABS", original)
        conn_mod._schema_ready.clear()
        return "aged"

    def test_the_column_is_added_on_open(self, old_mirror):
        conn = connect(old_mirror)
        assert "failure_reason" in {r[1] for r in conn.execute(
            "PRAGMA table_info(transactions)")}

    def test_it_lands_last_where_the_sheet_puts_it(self, old_mirror):
        conn = connect(old_mirror)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(transactions)")]
        assert cols == list(spec("transactions").columns)

    def test_existing_rows_survive(self, old_mirror):
        conn = connect(old_mirror)
        row = conn.execute("SELECT merchant, status, failure_reason "
                           "FROM transactions").fetchone()
        assert tuple(row) == ("Zomato", "failed", "")

    def test_it_does_not_queue_a_rewrite_of_the_whole_sheet(self, old_mirror):
        # The column is blank everywhere. Marking every row dirty would push the
        # entire sheet back to say nothing at all.
        conn = connect(old_mirror)
        assert conn.execute("SELECT COUNT(*) FROM _outbox").fetchone()[0] == 1

    def test_the_widened_table_still_reads_through_repo(self, old_mirror):
        conn = connect(old_mirror)
        assert Repo(conn, spec("transactions")).get(id="t1")["merchant"] == "Zomato"

    def test_reopening_a_current_mirror_changes_nothing(self, old_mirror):
        connect(old_mirror).close()
        conn_mod._schema_ready.clear()
        conn = connect(old_mirror)
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1

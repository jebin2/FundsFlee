"""parsed_emails — what counts as "already handled", and one row per message.

A failed email must be retried. Treating an AI outage as final meant one bad
minute lost that message permanently, recoverable only by deleting its row from
the sheet by hand.
"""
import asyncio

import pytest

import app.db.mirror as mirror
import app.sheets.parsed_emails as mod


@pytest.fixture
def fake(monkeypatch):
    """Recording an email must not reach Google. It used to be a read to find
    the row plus a write; both are local now."""
    def boom(*a, **kw):
        raise AssertionError("record_parsed_email called the Sheets API")
    monkeypatch.setattr(mod, "get_sheets_client", boom, raising=False)


def _row(email_id, status, subject="Order", attempts=1):
    return [email_id, "noreply@zomato.com", subject, "2026-07-29T00:00:00Z",
            status, "", str(attempts)]


def _record(email_id, status, attempts=1):
    return {"emailId": email_id, "from": "noreply@zomato.com", "subject": "Order",
            "parsedAt": "2026-07-30T00:00:00Z", "status": status, "txIds": [],
            "attempts": attempts}


class TestWhatCountsAsHandled:
    def test_parsed_and_skipped_are_terminal(self, fake, seed):
        seed("sheet", "parsed_emails", [_row("a", "parsed"), _row("b", "skipped")])
        ids = asyncio.run(mod.get_processed_email_ids("tok", "sheet"))
        assert ids == {"a", "b"}

    def test_failed_is_retried(self, fake, seed):
        # An AI outage is transient; the next run must look at it again.
        seed("sheet", "parsed_emails", [_row("a", "parsed"), _row("b", "failed")])
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a"}

    def test_a_mixed_sheet(self, fake, seed):
        seed("sheet", "parsed_emails", [_row("a", "parsed"), _row("b", "failed"), _row("c", "skipped"),
                     _row("d", "failed")])
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a", "c"}

    def test_blank_ids_are_ignored(self, fake, seed):
        seed("sheet", "parsed_emails", [_row("", "parsed"), _row("a", "parsed")])
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a"}

    def test_partial_is_terminal(self, fake, seed):
        # Some groups wrote rows. Retrying would import those a second time and
        # the duplicate scan only flags duplicates, so this must not come back.
        seed("sheet", "parsed_emails", [_row("a", "partial")])
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a"}


class TestStates:
    def test_status_and_attempts_are_returned_per_id(self, fake, seed):
        # The job needs the previous status, not just membership, to tell a
        # first ai_null from one that has already been retried — and the
        # attempt count to know when to stop retrying at all.
        seed("sheet", "parsed_emails", [_row("a", "parsed", attempts=1), _row("b", "failed", attempts=2)])
        assert asyncio.run(mod.get_email_states("tok", "sheet")) == {
            "a": {"status": "parsed", "attempts": 1},
            "b": {"status": "failed", "attempts": 2}}

    def test_a_missing_attempts_cell_reads_as_zero(self, fake, seed):
        seed("sheet", "parsed_emails", [["a", "f", "s", "t", "parsed", ""]])
        assert asyncio.run(mod.get_email_states("tok", "sheet"))["a"]["attempts"] == 0

    def test_giving_up_is_terminal(self, fake, seed):
        seed("sheet", "parsed_emails", [_row("a", mod.EXHAUSTED_STATUS)])
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a"}


class TestAnEmptyReadIsNeverGuessed:
    """An empty read means "reprocess everything" to the import job.

    This used to be a real hazard: the sheet read swallowed every exception and
    returned [], so one 429 would reimport the whole backlog. Reading locally
    settles it structurally — a SQLite read either returns the rows or raises,
    with no ambiguous empty in between.
    """

    def test_a_broken_mirror_raises(self, fake, monkeypatch):
        monkeypatch.setattr(
            mirror, "connect",
            lambda sid: (_ for _ in ()).throw(RuntimeError("disk gone")))
        with pytest.raises(RuntimeError):
            asyncio.run(mod.get_email_states("tok", "sheet"))

    def test_a_genuinely_empty_ledger_reads_empty(self, fake):
        assert asyncio.run(mod.get_email_states("tok", "sheet")) == {}


class TestOneRowPerMessage:
    def test_a_new_message_appends(self, fake):
        asyncio.run(mod.record_parsed_email("tok", "sheet", _record("new", "parsed")))
        rows = mirror.rows("tok", "sheet", "parsed_emails")
        assert [r[mod.COLS["email_id"]] for r in rows] == ["new"]

    def test_a_retry_updates_in_place(self, fake, seed):
        # Without this the retried email leaves a second row and the scanned
        # and failed counts in settings drift upward on every attempt.
        seed("sheet", "parsed_emails", [_row("a", "parsed"), _row("b", "failed")])
        asyncio.run(mod.record_parsed_email("tok", "sheet", _record("b", "parsed")))

        rows = mirror.rows("tok", "sheet", "parsed_emails")
        assert len(rows) == 2
        assert rows[1][mod.COLS["status"]] == "parsed"

    def test_an_append_is_addressable_afterwards(self, fake):
        # The appended row has to be findable, or the next write for that
        # message appends a second row instead of updating it.
        asyncio.run(mod.record_parsed_email("tok", "sheet", _record("new", "failed")))
        asyncio.run(mod.record_parsed_email("tok", "sheet", _record("new", "parsed")))

        rows = mirror.rows("tok", "sheet", "parsed_emails")
        assert len(rows) == 1
        assert rows[0][mod.COLS["status"]] == "parsed"

    def test_the_attempt_count_is_carried_through(self, fake, seed):
        seed("sheet", "parsed_emails", [_row("a", "failed", attempts=1)])
        asyncio.run(mod.record_parsed_email("tok", "sheet", _record("a", "failed", attempts=2)))
        assert asyncio.run(mod.get_email_states("tok", "sheet"))["a"]["attempts"] == 2

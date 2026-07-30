"""parsed_emails — what counts as "already handled", and one row per message.

A failed email must be retried. Treating an AI outage as final meant one bad
minute lost that message permanently, recoverable only by deleting its row from
the sheet by hand.
"""
import asyncio

import pytest

import app.sheets.parsed_emails as mod


class FakeRequest:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class FakeSheets:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.appended: list[list] = []
        self.updated: list[tuple[str, list]] = []

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def get(self, spreadsheetId=None, range=None, **kw):
        return FakeRequest(lambda: {"values": self.rows})

    def append(self, spreadsheetId=None, range=None, body=None, **kw):
        self.appended.append(body["values"][0])
        return FakeRequest(lambda: {})

    def update(self, spreadsheetId=None, range=None, body=None, **kw):
        self.updated.append((range, body["values"][0]))
        return FakeRequest(lambda: {})


@pytest.fixture
def fake(monkeypatch):
    fake = FakeSheets()
    monkeypatch.setattr(mod, "get_sheets_client", lambda token: fake)
    monkeypatch.setattr(mod, "ensure_parsed_emails_tab_sync", lambda s, sid: None)
    return fake


def _row(email_id, status, subject="Order"):
    return [email_id, "noreply@zomato.com", subject, "2026-07-29T00:00:00Z", status, ""]


def _record(email_id, status):
    return {"emailId": email_id, "from": "noreply@zomato.com", "subject": "Order",
            "parsedAt": "2026-07-30T00:00:00Z", "status": status, "txIds": []}


class TestWhatCountsAsHandled:
    def test_parsed_and_skipped_are_terminal(self, fake):
        fake.rows = [_row("a", "parsed"), _row("b", "skipped")]
        ids = asyncio.run(mod.get_processed_email_ids("tok", "sheet"))
        assert ids == {"a", "b"}

    def test_failed_is_retried(self, fake):
        # An AI outage is transient; the next run must look at it again.
        fake.rows = [_row("a", "parsed"), _row("b", "failed")]
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a"}

    def test_a_mixed_sheet(self, fake):
        fake.rows = [_row("a", "parsed"), _row("b", "failed"), _row("c", "skipped"),
                     _row("d", "failed")]
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a", "c"}

    def test_blank_ids_are_ignored(self, fake):
        fake.rows = [_row("", "parsed"), _row("a", "parsed")]
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a"}

    def test_partial_is_terminal(self, fake):
        # Some groups wrote rows. Retrying would import those a second time and
        # the duplicate scan only flags duplicates, so this must not come back.
        fake.rows = [_row("a", "partial")]
        assert asyncio.run(mod.get_processed_email_ids("tok", "sheet")) == {"a"}


class TestStatuses:
    def test_statuses_are_returned_per_id(self, fake):
        # The job needs the previous status, not just membership, to tell a
        # first ai_null from one that has already been retried.
        fake.rows = [_row("a", "parsed"), _row("b", "failed")]
        assert asyncio.run(mod.get_email_statuses("tok", "sheet")) == {
            "a": "parsed", "b": "failed"}


class TestOneRowPerMessage:
    def test_a_new_message_appends(self, fake):
        asyncio.run(mod.record_parsed_email("tok", "sheet", _record("new", "parsed")))
        assert len(fake.appended) == 1
        assert fake.updated == []

    def test_a_retry_updates_in_place(self, fake):
        # Without this the retried email leaves a second row and the scanned
        # and failed counts in settings drift upward on every attempt.
        fake.rows = [_row("a", "parsed"), _row("b", "failed")]
        asyncio.run(mod.record_parsed_email("tok", "sheet", _record("b", "parsed")))

        assert fake.appended == []
        range_, row = fake.updated[0]
        assert range_ == "parsed_emails!A3:F3"   # second data row
        assert row[mod.COLS["status"]] == "parsed"

    def test_the_first_row_is_addressed_correctly(self, fake):
        fake.rows = [_row("a", "failed")]
        asyncio.run(mod.record_parsed_email("tok", "sheet", _record("a", "parsed")))
        assert fake.updated[0][0] == "parsed_emails!A2:F2"

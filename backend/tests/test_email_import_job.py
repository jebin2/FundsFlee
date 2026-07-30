"""Message enumeration and what the job decides to retry.

maxResults without pagination capped a run at one page. Because Gmail lists
newest-first, that page was the same 100 messages on every run and the backlog
behind it was not slow to reach — it was unreachable.
"""
import asyncio

import pytest

import app.jobs.email_import_job as job


class FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    def execute(self):
        return self._payload


class FakeGmail:
    """Serves ids in pages, newest-first, the way Gmail does."""

    def __init__(self, ids, page_size=None):
        self.ids = ids
        self.page_size = page_size or job.LIST_PAGE_SIZE
        self.calls: list[tuple[str | None, int]] = []

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, userId=None, q=None, maxResults=None, pageToken=None):
        self.calls.append((pageToken, maxResults))
        start = int(pageToken) if pageToken else 0
        chunk = self.ids[start:start + self.page_size]
        nxt = start + self.page_size
        payload = {"messages": [{"id": i} for i in chunk]}
        if nxt < len(self.ids):
            payload["nextPageToken"] = str(nxt)
        return FakeRequest(payload)


def _list(gmail):
    return asyncio.run(job._list_all_message_ids(gmail, "q"))


class TestPagination:
    def test_a_single_page_needs_one_call(self):
        gmail = FakeGmail([f"m{i}" for i in range(10)])
        assert _list(gmail) == [f"m{i}" for i in range(10)]
        assert len(gmail.calls) == 1

    def test_it_follows_next_page_token(self):
        # The regression: everything past the first page used to be discarded.
        gmail = FakeGmail([f"m{i}" for i in range(1200)])
        assert len(_list(gmail)) == 1200
        assert len(gmail.calls) == 3

    def test_the_first_call_carries_no_token(self):
        gmail = FakeGmail(["a", "b"])
        _list(gmail)
        assert gmail.calls[0][0] is None

    def test_it_asks_for_full_pages(self):
        gmail = FakeGmail(["a"])
        _list(gmail)
        assert gmail.calls[0][1] == job.LIST_PAGE_SIZE

    def test_an_empty_mailbox_is_not_an_error(self):
        assert _list(FakeGmail([])) == []

    def test_enumeration_is_capped(self, monkeypatch):
        # One run stays bounded; oldest-first ordering resumes the rest later.
        monkeypatch.setattr(job, "MAX_MESSAGES_PER_RUN", 40)
        gmail = FakeGmail([f"m{i}" for i in range(500)], page_size=25)
        assert len(_list(gmail)) == 40

    def test_the_cap_does_not_exhaust_the_mailbox(self, monkeypatch):
        monkeypatch.setattr(job, "MAX_MESSAGES_PER_RUN", 40)
        gmail = FakeGmail([f"m{i}" for i in range(500)], page_size=25)
        _list(gmail)
        assert len(gmail.calls) == 2   # stopped once the cap was reached


class TestRetryDecision:
    def test_a_dead_ai_chain_is_retried(self):
        assert job._is_retryable_reason("parse_error", "m1", {}) is True

    def test_a_dead_chain_is_retried_even_after_a_previous_failure(self):
        # An outage can outlast one run; parse_error never becomes terminal.
        assert job._is_retryable_reason("parse_error", "m1", {"m1": "failed"}) is True

    def test_a_first_ai_null_is_retried_once(self):
        # Usually "no debit here", occasionally a non-JSON response. One retry
        # tells them apart.
        assert job._is_retryable_reason("ai_null", "m1", {}) is True

    def test_a_second_ai_null_is_final(self):
        # Otherwise every marketing email loops forever.
        assert job._is_retryable_reason("ai_null", "m1", {"m1": "failed"}) is False

    def test_a_real_verdict_is_not_retried(self):
        assert job._is_retryable_reason("no_amount", "m1", {}) is False

    def test_no_reason_is_not_retried(self):
        assert job._is_retryable_reason(None, "m1", {}) is False

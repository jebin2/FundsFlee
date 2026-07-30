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

    def test_enumeration_is_not_truncated_to_the_run_cap(self, monkeypatch):
        # The cap limits how many messages get PARSED, not how many get listed.
        # Truncating the listing keeps the NEWEST N, and since listing is
        # newest-first that is the same page every run — the original bug.
        monkeypatch.setattr(job, "MAX_MESSAGES_PER_RUN", 40)
        gmail = FakeGmail([f"m{i}" for i in range(500)], page_size=25)
        assert len(_list(gmail)) == 500

    def test_listing_has_a_safety_valve(self, monkeypatch):
        monkeypatch.setattr(job, "MAX_LIST_PAGES", 3)
        gmail = FakeGmail([f"m{i}" for i in range(500)], page_size=25)
        assert len(_list(gmail)) == 75
        assert len(gmail.calls) == 3


class TestSelectingWhatToProcess:
    def test_the_oldest_unprocessed_goes_first(self):
        # Gmail hands back newest-first; m0 is the newest, m3 the oldest.
        assert job._select_pending(["m0", "m1", "m2", "m3"], set()) == [
            "m3", "m2", "m1", "m0"]

    def test_processed_messages_are_dropped(self):
        assert job._select_pending(["m0", "m1", "m2"], {"m1"}) == ["m2", "m0"]

    def test_the_cap_takes_the_oldest_not_the_newest(self, monkeypatch):
        # The regression that made pagination pointless: capping the newest-first
        # side returns the same messages every run and the older mail is never
        # reached, no matter how many runs happen.
        monkeypatch.setattr(job, "MAX_MESSAGES_PER_RUN", 2)
        assert job._select_pending(["new", "mid", "old"], set()) == ["old", "mid"]

    def test_successive_runs_advance_through_the_backlog(self, monkeypatch):
        monkeypatch.setattr(job, "MAX_MESSAGES_PER_RUN", 2)
        listed = ["m4", "m3", "m2", "m1", "m0"]   # newest-first, as Gmail sends

        done: set[str] = set()
        seen: list[str] = []
        for _ in range(3):
            batch = job._select_pending(listed, done)
            seen.extend(batch)
            done.update(batch)

        # Every message reached, oldest first, with no repeats.
        assert seen == ["m0", "m1", "m2", "m3", "m4"]

    def test_an_exhausted_backlog_yields_nothing(self):
        assert job._select_pending(["a", "b"], {"a", "b"}) == []


class TestWhatCountsAsAGroupFailure:
    def test_a_raised_ai_call_is_a_failure(self):
        assert job._group_hard_failed("parse_error") is True

    def test_no_debit_in_this_group_is_not_a_failure(self):
        # A forwarded batch mixes payments with delivery notices. Counting the
        # notices as failures would mark ordinary mail "partial" and claim rows
        # were lost when none were.
        assert job._group_hard_failed("ai_null") is False

    def test_a_verdict_is_not_a_failure(self):
        assert job._group_hard_failed("no_amount") is False

    def test_success_is_not_a_failure(self):
        assert job._group_hard_failed(None) is False


class TestRetryingAnEmptyMessage:
    def test_a_dead_ai_chain_is_retried(self):
        assert job._should_retry_empty(["parse_error"], "m1", {}) is True

    def test_a_dead_chain_is_retried_even_after_a_previous_failure(self):
        # An outage can outlast one run; parse_error never becomes terminal.
        assert job._should_retry_empty(["parse_error"], "m1", {"m1": "failed"}) is True

    def test_a_first_ai_null_is_retried_once(self):
        # Usually "no debit here", occasionally a non-JSON response.
        assert job._should_retry_empty(["ai_null"], "m1", {}) is True

    def test_a_second_ai_null_is_final(self):
        # Otherwise every marketing email loops forever.
        assert job._should_retry_empty(["ai_null"], "m1", {"m1": "failed"}) is False

    def test_a_hard_failure_outranks_a_spent_ai_null(self):
        assert job._should_retry_empty(
            ["ai_null", "parse_error"], "m1", {"m1": "failed"}) is True

    def test_a_real_verdict_is_not_retried(self):
        assert job._should_retry_empty(["no_amount"], "m1", {}) is False

    def test_nothing_to_report_is_not_retried(self):
        assert job._should_retry_empty([], "m1", {}) is False

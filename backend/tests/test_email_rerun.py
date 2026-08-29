"""Re-reading one email.

An email row could not be retried at all — the pipeline lived only inside the
daily import, and the row keeps "subject | from" in raw_input, never the body.
So a re-run goes back to Gmail, and because a mail can hold several payments it
can discard rows the person edited. Everything here is about not losing those
rows by accident.
"""
import asyncio

import pytest

import app.services.email_rerun_service as mod
from app.core.deps import SheetSession
from app.db import mirror, spec
from app.sheets.parsed_emails import find_email_for_tx
from app.sheets.transaction_schema import transaction_to_row
from tests.test_transaction_schema import BASE_TX

SESSION = SheetSession(access_token="tok", refresh_token="r", sheet_id="sheet",
                       user_email="u@example.com")


def tx_row(tx_id: str, **over) -> list:
    return transaction_to_row({**BASE_TX, "id": tx_id, "source": "email", **over})


def email_row(email_id: str, tx_ids: list[str], subject: str = "Zomato order") -> list:
    return [email_id, "noreply@zomato.com", subject, "2026-08-01",
            "parsed", ",".join(tx_ids), "1"]


@pytest.fixture
def wired(monkeypatch, seed):
    """One email that produced two rows, and a Gmail that returns a message."""
    seed("sheet", "transactions", [tx_row("t1"), tx_row("t2")])
    seed("sheet", "parsed_emails", [email_row("m1", ["t1", "t2"])])

    monkeypatch.setattr(mod, "get_gmail_client", lambda token: object())
    monkeypatch.setattr(mod, "read_email_import_config",
                        _async({"region": "IN", "attachments": False}))
    monkeypatch.setattr(mod, "fetch_message", _async({
        "id": "m1", "from": "noreply@zomato.com", "subject": "Zomato order",
        "payload": {}, "body_text": "You paid 450", "received_time": "12:30",
        "received_date": "2026-08-01"}))
    monkeypatch.setattr(mod, "deduplicate_new_transactions", _async(None))
    return seed


def _async(value):
    async def f(*a, **kw):
        if isinstance(value, Exception):
            raise value
        return value
    return f


def _parsed(*transactions, skip_reasons=()):
    return _async({
        "parsed_rows": [(t, "Zomato order", "noreply@zomato.com") for t in transactions],
        "skip_reasons": list(skip_reasons), "failed_groups": 0, "groups": 1,
    })


def a_transaction(merchant="Zomato", amount=450):
    return {"date": "2026-08-01", "time": "12:30", "merchant": merchant,
            "category": "Food", "payment_method": "UPI", "amount": amount,
            "items": []}


def rows_now(tab="transactions"):
    return mirror.rows("tok", "sheet", tab)


def live_ids() -> list[str]:
    idx = spec("transactions").columns
    return [r[0] for r in rows_now() if r[0] and r[idx.index("deleted")] != "TRUE"]


class TestFindingTheEmail:
    def test_a_row_maps_back_to_its_message(self, wired):
        found = asyncio.run(find_email_for_tx("tok", "sheet", "t2"))
        assert found["email_id"] == "m1"
        assert found["tx_ids"] == ["t1", "t2"]

    def test_an_unrelated_row_maps_to_nothing(self, wired):
        assert asyncio.run(find_email_for_tx("tok", "sheet", "nope")) is None


class TestThePreview:
    def test_it_lists_every_row_the_email_produced(self, wired):
        result = asyncio.run(mod.preview(SESSION, "t1"))
        assert [t["id"] for t in result["transactions"]] == ["t1", "t2"]
        assert result["subject"] == "Zomato order"

    def test_it_marks_a_row_that_was_edited_by_hand(self, wired, seed):
        seed("sheet", "transactions",
             [tx_row("t3", created_at="2026-08-01T00:00:00Z",
                     updated_at="2026-08-02T00:00:00Z")])
        seed("sheet", "parsed_emails", [email_row("m2", ["t3"])])
        result = asyncio.run(mod.preview(SESSION, "t3"))
        assert result["transactions"][0]["edited"] is True

    def test_an_untouched_row_is_not_marked_edited(self, wired):
        result = asyncio.run(mod.preview(SESSION, "t1"))
        assert result["transactions"][0]["edited"] is False

    def test_it_changes_nothing(self, wired):
        before = rows_now()
        asyncio.run(mod.preview(SESSION, "t1"))
        assert rows_now() == before

    def test_a_non_email_row_is_refused(self, wired, seed):
        seed("sheet", "transactions", [tx_row("t9", source="receipt")])
        with pytest.raises(mod.RerunError) as err:
            asyncio.run(mod.preview(SESSION, "t9"))
        assert err.value.status == 400

    def test_a_row_with_no_recorded_email_is_refused(self, wired, seed):
        seed("sheet", "transactions", [tx_row("orphan")])
        with pytest.raises(mod.RerunError) as err:
            asyncio.run(mod.preview(SESSION, "orphan"))
        assert err.value.status == 404
        assert "edit" in str(err.value).lower()


class TestTheRerun:
    def test_it_writes_what_the_fresh_parse_found(self, wired, monkeypatch):
        monkeypatch.setattr(mod, "parse_message", _parsed(a_transaction("Swiggy", 280)))
        result = asyncio.run(mod.rerun(SESSION, "t1"))
        assert result["written"] == 1
        merchants = [r[spec("transactions").columns.index("merchant")]
                     for r in rows_now() if r[0] in result["transactionIds"]]
        assert merchants == ["Swiggy"]

    def test_it_retires_every_old_row(self, wired, monkeypatch):
        monkeypatch.setattr(mod, "parse_message", _parsed(a_transaction()))
        result = asyncio.run(mod.rerun(SESSION, "t1"))
        assert result["replaced"] == 2
        assert "t1" not in live_ids() and "t2" not in live_ids()

    def test_the_old_rows_are_soft_deleted_not_removed(self, wired, monkeypatch):
        monkeypatch.setattr(mod, "parse_message", _parsed(a_transaction()))
        asyncio.run(mod.rerun(SESSION, "t1"))
        # Row position is row identity — a removed row would repoint every row
        # below it at the wrong line in the sheet.
        assert [r[0] for r in rows_now()][:2] == ["t1", "t2"]

    def test_the_email_record_points_at_the_new_rows(self, wired, monkeypatch):
        monkeypatch.setattr(mod, "parse_message", _parsed(a_transaction()))
        result = asyncio.run(mod.rerun(SESSION, "t1"))
        recorded = asyncio.run(find_email_for_tx("tok", "sheet", result["transactionIds"][0]))
        assert recorded["email_id"] == "m1"
        assert recorded["tx_ids"] == result["transactionIds"]

    def test_a_mail_holding_several_payments_writes_all_of_them(self, wired, monkeypatch):
        monkeypatch.setattr(mod, "parse_message",
                            _parsed(a_transaction("Zomato", 450),
                                    a_transaction("Blinkit", 120)))
        assert asyncio.run(mod.rerun(SESSION, "t1"))["written"] == 2

    def test_it_runs_the_duplicate_scan_on_what_it_wrote(self, wired, monkeypatch):
        seen = {}
        async def scan(session, ids):
            seen["ids"] = ids
        monkeypatch.setattr(mod, "parse_message", _parsed(a_transaction()))
        monkeypatch.setattr(mod, "deduplicate_new_transactions", scan)
        result = asyncio.run(mod.rerun(SESSION, "t1"))
        assert seen["ids"] == result["transactionIds"]


class TestWhenItCannotRun:
    def test_a_deleted_mail_leaves_every_row_alone(self, wired, monkeypatch):
        monkeypatch.setattr(mod, "fetch_message", _async(Exception("404 not found")))
        before = rows_now()
        with pytest.raises(mod.RerunError) as err:
            asyncio.run(mod.rerun(SESSION, "t1"))
        assert err.value.status == 404
        assert "deleted" in str(err.value).lower()
        assert rows_now() == before

    def test_a_parse_that_finds_nothing_leaves_every_row_alone(self, wired, monkeypatch):
        # Replacing real rows with nothing is silent data loss.
        monkeypatch.setattr(mod, "parse_message", _parsed(skip_reasons=["ai_null"]))
        before = rows_now()
        with pytest.raises(mod.RerunError) as err:
            asyncio.run(mod.rerun(SESSION, "t1"))
        assert err.value.status == 422
        assert rows_now() == before

    def test_the_reason_reaches_the_message(self, wired, monkeypatch):
        monkeypatch.setattr(mod, "parse_message", _parsed(skip_reasons=["ai_null"]))
        with pytest.raises(mod.RerunError) as err:
            asyncio.run(mod.rerun(SESSION, "t1"))
        assert "ai_null" in str(err.value)


class TestASecondClickWhileOneIsRunning:
    """The frontend disables its own button, which covers a double-tap and
    nothing else — closing the sheet and clicking again from the list, a second
    tab, or a phone reissuing the POST all start a second run. Two overlapping
    runs read the same tx_ids, both append and both retire the originals, so
    the mail's transactions end up doubled rather than replaced. The duplicate
    scan only FLAGS duplicates, so nothing downstream cleans that up.
    """

    @pytest.fixture(autouse=True)
    def clean(self):
        mod._in_flight.clear()
        yield
        mod._in_flight.clear()

    def test_the_second_one_is_refused(self, wired, monkeypatch):
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_parse(*a, **kw):
            started.set()
            await release.wait()
            return {"parsed_rows": [(a_transaction(), "s", "f")],
                    "skip_reasons": [], "failed_groups": 0, "groups": 1}

        monkeypatch.setattr(mod, "parse_message", slow_parse)

        async def scenario():
            first = asyncio.create_task(mod.rerun(SESSION, "t1"))
            await started.wait()
            with pytest.raises(mod.RerunError) as err:
                await mod.rerun(SESSION, "t2")   # same email, other row
            assert err.value.status == 409
            release.set()
            await first

        asyncio.run(scenario())

    def test_only_one_set_of_rows_is_written(self, wired, monkeypatch):
        started = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def slow_parse(*a, **kw):
            calls.append(1)
            started.set()
            await release.wait()
            return {"parsed_rows": [(a_transaction(), "s", "f")],
                    "skip_reasons": [], "failed_groups": 0, "groups": 1}

        monkeypatch.setattr(mod, "parse_message", slow_parse)

        async def scenario():
            first = asyncio.create_task(mod.rerun(SESSION, "t1"))
            await started.wait()
            with pytest.raises(mod.RerunError):
                await mod.rerun(SESSION, "t1")
            release.set()
            return await first

        result = asyncio.run(scenario())
        # One AI call, one new row, and the two originals retired exactly once.
        assert calls == [1]
        assert live_ids() == result["transactionIds"]

    def test_the_lock_is_released_when_a_run_fails(self, wired, monkeypatch):
        monkeypatch.setattr(mod, "fetch_message", _async(Exception("404")))
        with pytest.raises(mod.RerunError):
            asyncio.run(mod.rerun(SESSION, "t1"))
        # Otherwise one failure would block that email until the next restart.
        assert not mod.is_rerunning("sheet", "m1")

    def test_a_different_email_is_not_blocked(self, wired, monkeypatch, seed):
        seed("sheet", "transactions", [tx_row("t3")])
        seed("sheet", "parsed_emails", [email_row("m2", ["t3"], "Blinkit order")])
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_parse(*a, **kw):
            started.set()
            await release.wait()
            return {"parsed_rows": [(a_transaction(), "s", "f")],
                    "skip_reasons": [], "failed_groups": 0, "groups": 1}

        monkeypatch.setattr(mod, "parse_message", slow_parse)

        async def scenario():
            first = asyncio.create_task(mod.rerun(SESSION, "t1"))
            await started.wait()
            # m2 is a different message — it has no reason to wait on m1.
            assert not mod.is_rerunning("sheet", "m2")
            release.set()
            await first

        asyncio.run(scenario())

    def test_the_preview_says_one_is_running(self, wired, monkeypatch):
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_parse(*a, **kw):
            started.set()
            await release.wait()
            return {"parsed_rows": [(a_transaction(), "s", "f")],
                    "skip_reasons": [], "failed_groups": 0, "groups": 1}

        monkeypatch.setattr(mod, "parse_message", slow_parse)

        async def scenario():
            first = asyncio.create_task(mod.rerun(SESSION, "t1"))
            await started.wait()
            assert (await mod.preview(SESSION, "t1"))["rerunning"] is True
            release.set()
            await first

        asyncio.run(scenario())

    def test_a_quiet_email_is_not_reported_as_running(self, wired):
        assert asyncio.run(mod.preview(SESSION, "t1"))["rerunning"] is False

"""Dedup windowing — same-day parity at window 0, +/-N day joins above it."""
import asyncio
import json

import pytest

from app.ai import dedup
from app.ai.dedup import find_duplicates


def _tx(tx_id, date, merchant="Swiggy", amount=450, source="email", notes=""):
    return {"id": tx_id, "date": date, "merchant": merchant, "amount": amount,
            "source": source, "notes": notes, "item_name": ""}


def _fake_ai(monkeypatch, groups_by_call=None, capture=None, error=None):
    calls = []

    async def fake(prompt, system, max_tokens=1024):
        calls.append(prompt)
        if capture is not None:
            capture.append(prompt)
        if error:
            raise error
        if groups_by_call is None:
            return "[]"
        idx = len(calls) - 1
        payload = groups_by_call[idx] if idx < len(groups_by_call) else []
        return json.dumps(payload)

    monkeypatch.setattr(dedup, "generate_text", fake)
    return calls


class TestSameDayParity:
    def test_window_zero_compares_only_within_a_day(self, monkeypatch):
        prompts = []
        _fake_ai(monkeypatch, capture=prompts)
        txs = [_tx("a", "2026-07-15"), _tx("b", "2026-07-16")]
        asyncio.run(find_duplicates(txs))
        assert prompts == []  # neither day has 2 rows

    def test_window_zero_keeps_the_ported_prompt(self, monkeypatch):
        prompts = []
        _fake_ai(monkeypatch, capture=prompts)
        asyncio.run(find_duplicates([_tx("a", "2026-07-15"), _tx("b", "2026-07-15")]))
        assert "within this single day: 2026-07-15" in prompts[0]
        assert '"date"' not in prompts[0]  # date is redundant within one day

    def test_window_zero_finds_same_day_duplicates(self, monkeypatch):
        _fake_ai(monkeypatch, [[{"original_id": "a", "duplicate_ids": ["b"], "reason": "same"}]])
        out = asyncio.run(find_duplicates([_tx("a", "2026-07-15"), _tx("b", "2026-07-15")]))
        assert out[0]["duplicate_ids"] == ["b"]


class TestWindowed:
    def test_rows_a_few_days_apart_are_compared(self, monkeypatch):
        # The card case: alert on the 15th, statement posts it on the 17th.
        prompts = []
        _fake_ai(monkeypatch, [[{"original_id": "a", "duplicate_ids": ["b"], "reason": "posting date"}]],
                 capture=prompts)
        txs = [_tx("a", "2026-07-15"), _tx("b", "2026-07-17", source="import")]
        out = asyncio.run(find_duplicates(txs, window_days=3))
        assert out[0]["duplicate_ids"] == ["b"]
        assert "2026-07-12 to 2026-07-18" in prompts[0]

    def test_windowed_payload_carries_dates(self, monkeypatch):
        prompts = []
        _fake_ai(monkeypatch, capture=prompts)
        asyncio.run(find_duplicates([_tx("a", "2026-07-15"), _tx("b", "2026-07-17")], window_days=3))
        assert '"date":"2026-07-15"' in prompts[0]

    def test_rows_beyond_the_window_are_not_compared(self, monkeypatch):
        prompts = []
        _fake_ai(monkeypatch, capture=prompts)
        txs = [_tx("a", "2026-07-01"), _tx("b", "2026-07-20")]
        asyncio.run(find_duplicates(txs, window_days=3))
        assert prompts == []  # neither window contains a second row

    def test_identical_candidate_sets_are_not_re_sent(self, monkeypatch):
        # Two dates inside one window produce the same candidate set; sending it
        # twice would double the AI spend for no new information.
        calls = _fake_ai(monkeypatch)
        txs = [_tx("a", "2026-07-15"), _tx("b", "2026-07-16")]
        asyncio.run(find_duplicates(txs, window_days=3))
        assert len(calls) == 1

    def test_a_row_is_claimed_as_duplicate_only_once(self, monkeypatch):
        # Overlapping windows can both report the same pair.
        _fake_ai(monkeypatch, [
            [{"original_id": "a", "duplicate_ids": ["b"], "reason": "first"}],
            [{"original_id": "a", "duplicate_ids": ["b"], "reason": "again"}],
        ])
        txs = [_tx("a", "2026-07-01"), _tx("b", "2026-07-02"),
               _tx("c", "2026-07-20"), _tx("d", "2026-07-21")]
        out = asyncio.run(find_duplicates(txs, window_days=3))
        assert sum(len(g["duplicate_ids"]) for g in out) == 1

    def test_unparseable_dates_do_not_crash(self, monkeypatch):
        _fake_ai(monkeypatch)
        txs = [_tx("a", "not-a-date"), _tx("b", "also-bad")]
        assert asyncio.run(find_duplicates(txs, window_days=3)) == []


class TestErrorContract:
    def test_ai_failures_propagate(self, monkeypatch):
        # duplicate_detection_service distinguishes an AI outage from "no
        # duplicates found" — swallowing here would break that.
        _fake_ai(monkeypatch, error=RuntimeError("provider down"))
        with pytest.raises(RuntimeError):
            asyncio.run(find_duplicates([_tx("a", "2026-07-15"), _tx("b", "2026-07-15")]))

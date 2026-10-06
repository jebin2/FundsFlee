"""The "Sync Now" button and the minute timer share one push at a time.

Overlapping passes would claim the same queued rows and write them twice.
"""
import asyncio

import app.cron.sync_scheduler as mod


def test_manual_push_waits_for_the_timer(monkeypatch):
    active, peak = 0, 0

    async def fake_push(token, sheet_id):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return {"transactions": {"rows": 1}}

    async def token_for(sheet_id):
        return "tok"

    monkeypatch.setattr(mod, "push", fake_push)
    monkeypatch.setattr(mod, "sheets_with_pending", lambda: ["sheet1"])
    monkeypatch.setattr(mod, "_access_token_for", token_for)

    async def both():
        # A fresh lock, bound to this test's event loop.
        monkeypatch.setattr(mod, "_push_lock", asyncio.Lock())
        return await asyncio.gather(mod.push_pending(), mod.push_now("tok", "sheet1"))

    timer, manual = asyncio.run(both())
    assert peak == 1
    assert timer == {"sheet1": {"transactions": {"rows": 1}}}
    assert manual == {"transactions": {"rows": 1}}

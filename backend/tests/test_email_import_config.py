"""Email import config — the attachments default is a product decision, not an
accident, so it gets a test. Unset must mean ON: a forwarded batch or an emailed
statement carries everything in its attachments, and with the flag off those
emails can only ever be skipped as too_short."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import app.email_import.config as config_mod
import app.services.email_import_service as service_mod

SESSION = SimpleNamespace(access_token="tok", sheet_id="sheet")


def _with_meta(monkeypatch, meta):
    async def fake_meta(token, sheet_id):
        return meta

    monkeypatch.setattr(config_mod, "get_meta_values", fake_meta)
    monkeypatch.setattr(service_mod, "get_meta_values", fake_meta)


def _read(monkeypatch, meta):
    _with_meta(monkeypatch, meta)
    return asyncio.run(config_mod.read_email_import_config(SESSION))


def _status(monkeypatch, meta):
    _with_meta(monkeypatch, meta)
    return asyncio.run(service_mod.get_email_import_status(SESSION))


class TestAttachmentsDefault:
    def test_unset_means_on(self, monkeypatch):
        assert _read(monkeypatch, {})["attachments"] is True

    def test_explicit_off_is_respected(self, monkeypatch):
        assert _read(monkeypatch, {"email_import_attachments": "0"})["attachments"] is False

    def test_explicit_on(self, monkeypatch):
        assert _read(monkeypatch, {"email_import_attachments": "1"})["attachments"] is True

    def test_status_and_config_agree(self, monkeypatch):
        for meta in ({}, {"email_import_attachments": "0"}, {"email_import_attachments": "1"}):
            assert _read(monkeypatch, meta)["attachments"] == _status(monkeypatch, meta)["attachments"]


class TestSaving:
    def _capture(self, monkeypatch):
        written = {}

        async def fake_set(token, sheet_id, values):
            written.update(values)

        monkeypatch.setattr(service_mod, "set_meta_values", fake_set)
        return written

    def test_off_writes_an_explicit_zero(self, monkeypatch):
        # Writing "" would read back as ON under the new default, so switching
        # the toggle off has to persist something the reader recognises.
        written = self._capture(monkeypatch)
        asyncio.run(service_mod.save_email_import_config(SESSION, {"attachments": False}))
        assert written["email_import_attachments"] == "0"

    def test_on_writes_one(self, monkeypatch):
        written = self._capture(monkeypatch)
        asyncio.run(service_mod.save_email_import_config(SESSION, {"attachments": True}))
        assert written["email_import_attachments"] == "1"

    def test_off_survives_a_round_trip(self, monkeypatch):
        written = self._capture(monkeypatch)
        asyncio.run(service_mod.save_email_import_config(SESSION, {"attachments": False}))
        assert _read(monkeypatch, {"email_import_attachments": written["email_import_attachments"]})["attachments"] is False

    def test_untouched_when_not_in_the_patch(self, monkeypatch):
        written = self._capture(monkeypatch)
        asyncio.run(service_mod.save_email_import_config(SESSION, {"daysBack": 14}))
        assert "email_import_attachments" not in written


class TestAnAbandonedLock:
    """The lock is cleared in a finally block, which does not run when the
    process is killed mid-import. The job applied an age rule and the status
    endpoint did not, so a restart left the UI saying "Scanning emails…"
    forever."""

    def _ago(self, seconds):
        return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()

    def test_a_fresh_lock_is_reported(self):
        started = self._ago(30)
        assert config_mod.active_running_at(started) == started

    def test_a_stale_lock_reads_as_not_running(self):
        assert config_mod.active_running_at(self._ago(config_mod.LOCK_STALE_SECONDS + 1)) is None

    def test_no_lock_is_not_running(self):
        assert config_mod.active_running_at(None) is None
        assert config_mod.active_running_at("") is None

    def test_an_unparseable_lock_does_not_wedge_the_ui(self):
        assert config_mod.active_running_at("not a date") is None

    def test_a_z_suffixed_timestamp_is_understood(self):
        # now_iso() writes this form; treating it as unparseable would report
        # every run as finished the moment it started.
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + "Z"
        assert config_mod.active_running_at(stamp) == stamp

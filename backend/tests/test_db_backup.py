"""Backups, and the only question that matters about one: does it restore?

Every test here goes through a real snapshot and reads it back. A backup that
is never opened is a guess, and the point of the sqlite3 online-backup API over
a file copy is precisely that a copied WAL database opens fine while missing
the tail of its last transaction.
"""
import json
import sqlite3
import tarfile
import time
from pathlib import Path

import pytest

import app.db.backup as backup
import app.db.connection as conn_mod
from app.db import Repo, connect, spec


@pytest.fixture
def wired(tmp_path, monkeypatch):
    monkeypatch.setattr(conn_mod, "DB_DIR", tmp_path / "sheets")
    monkeypatch.setattr(backup, "DB_DIR", tmp_path / "sheets")
    monkeypatch.setattr(backup.settings, "backup_dir", str(tmp_path / "backups"))
    monkeypatch.setattr(backup.settings, "user_store_file", str(tmp_path / "users.json"))
    monkeypatch.setattr(backup.settings, "cron_session_file", str(tmp_path / "cron.json"))
    return tmp_path


def seed_mirror(sheet_id: str, rows: int = 3) -> None:
    conn = connect(sheet_id)
    try:
        Repo(conn, spec("meta")).insert_many(
            [{"key": f"k{i}", "value": str(i)} for i in range(rows)])
    finally:
        conn.close()


def members(archive: Path) -> list[str]:
    with tarfile.open(archive) as tar:
        return sorted(tar.getnames())


def extract(archive: Path, into: Path) -> Path:
    with tarfile.open(archive) as tar:
        tar.extractall(into)
    return into


class TestWhatIsCaptured:
    def test_every_mirror_is_in_the_archive(self, wired):
        seed_mirror("s1")
        seed_mirror("s2")
        result = backup.run_backup_sync()

        assert members(Path(result["file"])) == ["sheets/s1.db", "sheets/s2.db"]

    def test_the_credential_files_come_too(self, wired):
        # Without these a restored mirror still cannot reach anyone's Google
        # account — the database alone is not a recovery.
        seed_mirror("s1")
        (wired / "users.json").write_text(json.dumps({"user_x": {"sheet_id": "s1"}}))
        (wired / "cron.json").write_text(json.dumps({"sheetId": "s1"}))

        names = members(Path(backup.run_backup_sync()["file"]))
        assert "users.json" in names and "cron-session.json" in names

    def test_a_missing_credential_file_is_not_fatal(self, wired):
        seed_mirror("s1")
        assert "users.json" not in members(Path(backup.run_backup_sync()["file"]))

    def test_it_survives_having_nothing_to_back_up(self, wired):
        result = backup.run_backup_sync()
        assert Path(result["file"]).exists()
        assert result["counts"] == {}

    def test_row_counts_are_reported(self, wired):
        # Logged on every run, so a backup that suddenly holds far fewer rows
        # than the last one is visible rather than silent.
        seed_mirror("s1", rows=5)
        assert backup.run_backup_sync()["counts"]["s1"]["meta"] == 5


class TestItActuallyRestores:
    def test_the_snapshot_holds_the_rows(self, wired):
        seed_mirror("s1", rows=4)
        archive = Path(backup.run_backup_sync()["file"])

        out = extract(archive, wired / "restored")
        conn = sqlite3.connect(out / "sheets" / "s1.db")
        try:
            keys = [r[0] for r in conn.execute("SELECT key FROM meta ORDER BY rowid")]
        finally:
            conn.close()
        assert keys == ["k0", "k1", "k2", "k3"]

    def test_a_restored_mirror_opens_as_a_mirror(self, wired, monkeypatch):
        # Not just readable by sqlite3 — usable by the app, schema and all.
        seed_mirror("s1", rows=2)
        archive = Path(backup.run_backup_sync()["file"])
        out = extract(archive, wired / "restored")

        monkeypatch.setattr(conn_mod, "DB_DIR", out / "sheets")
        conn_mod._schema_ready.clear()
        assert [r["key"] for r in Repo(connect("s1"), spec("meta")).all()] == ["k0", "k1"]

    def test_a_snapshot_taken_mid_write_is_still_consistent(self, wired):
        # The reason for the online-backup API rather than a file copy: a WAL
        # database copied while open loses the tail of its last transaction.
        seed_mirror("s1", rows=2)
        live = connect("s1")
        try:
            Repo(live, spec("meta")).insert({"key": "during", "value": "x"})
            archive = Path(backup.run_backup_sync()["file"])
        finally:
            live.close()

        out = extract(archive, wired / "restored")
        conn = sqlite3.connect(out / "sheets" / "s1.db")
        try:
            assert conn.execute(
                "SELECT COUNT(*) FROM meta").fetchone()[0] == 3
        finally:
            conn.close()

    def test_a_corrupt_source_is_refused_not_archived(self, wired):
        seed_mirror("s1")
        (conn_mod.DB_DIR / "s2.db").write_bytes(b"this is not a database")
        with pytest.raises(sqlite3.DatabaseError):
            backup.run_backup_sync()

        # Nothing half-written left behind to be mistaken for a good backup.
        assert list(backup.backup_dir().glob("*.tar.gz")) == []


class TestRetention:
    def test_old_archives_are_pruned(self, wired):
        seed_mirror("s1")
        for _ in range(5):
            backup.run_backup_sync()
            time.sleep(0.01)

        old = time.time() - backup.KEEP_DAYS * 86400 - 60
        for path in backup.backup_dir().glob("*.tar.gz"):
            import os
            os.utime(path, (old, old))
        backup.prune()

        # Aged out, but never down to nothing.
        assert len(list(backup.backup_dir().glob("*.tar.gz"))) == backup.KEEP_AT_LEAST

    def test_recent_archives_are_kept(self, wired):
        seed_mirror("s1")
        for _ in range(4):
            backup.run_backup_sync()
            time.sleep(0.01)
        assert len(list(backup.backup_dir().glob("*.tar.gz"))) == 4


class TestSecrets:
    def test_the_archive_is_not_world_readable(self, wired):
        # It carries OAuth refresh tokens.
        seed_mirror("s1")
        archive = Path(backup.run_backup_sync()["file"])
        assert archive.stat().st_mode & 0o077 == 0

    def test_the_directory_is_not_world_readable(self, wired):
        seed_mirror("s1")
        backup.run_backup_sync()
        assert backup.backup_dir().stat().st_mode & 0o077 == 0

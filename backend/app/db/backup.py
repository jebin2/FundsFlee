"""Backups, now that the disk holds the data.

Before the mirror, losing this server cost nothing: the sheet was authoritative
and a rebuild hydrated from it. That is inverted now. `data/sheets/*.db` is the
database, the sheet is its mirror, and `data/users.json` holds the OAuth refresh
tokens that are the only way back into a user's Google account. None of it was
backed up.

A snapshot is taken with SQLite's online backup API rather than a file copy.
Copying a WAL database while it is being written produces a file that opens
fine and is missing the tail of its most recent transaction — the worst kind of
broken, because you find out when you need it.

Every snapshot is checked before it is kept, for the same reason: an unverified
backup is a guess.

**To restore:** stop the app, unpack the tarball over `backend/data/`, start it.
The mirror is authoritative, so whatever the sheet has drifted to is irrelevant;
the syncer pushes the restored rows back over it.

**This does not protect against losing the disk.** Point `BACKUP_DIR` at another
volume, or copy the tarballs off the machine — they are self-contained and
already mode 0600.
"""
import asyncio
import os
import sqlite3
import tarfile
import tempfile
import time
from datetime import datetime
from pathlib import Path

from app.config import settings
from app.core.logger import log
from app.db.connection import DB_DIR
from app.db.registry import TABS

KEEP_DAYS = 14

# However old they are, never leave the machine with no backup at all — a server
# that was off for a month would otherwise prune its way down to nothing on the
# first run back.
KEEP_AT_LEAST = 3

PREFIX = "fundsflee-"
SUFFIX = ".tar.gz"


def backup_dir() -> Path:
    return Path(settings.backup_dir)


def _free_name(out_dir: Path) -> Path:
    """A name nothing else holds. The stamp is per second, so a manual run
    landing in the same second as the scheduled one would otherwise overwrite
    it — losing a backup silently, which is the one thing this must not do."""
    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    candidate = out_dir / f"{PREFIX}{stamp}{SUFFIX}"
    n = 1
    while candidate.exists():
        candidate = out_dir / f"{PREFIX}{stamp}-{n}{SUFFIX}"
        n += 1
    return candidate


def _snapshot(src: Path, dest: Path) -> dict[str, int]:
    """Copy a live database safely, then prove the copy is readable.

    Returns row counts per tab, which are logged: a backup that suddenly holds
    far fewer rows than the last one is the signal worth seeing.
    """
    source = sqlite3.connect(src)
    try:
        target = sqlite3.connect(dest)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()

    check = sqlite3.connect(dest)
    try:
        result = check.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise RuntimeError(f"{src.name}: snapshot failed integrity check: {result}")
        return {s.name: check.execute(
            f'SELECT COUNT(*) FROM "{s.name}"').fetchone()[0] for s in TABS}
    finally:
        check.close()


def _add(tar: tarfile.TarFile, path: Path, arcname: str) -> bool:
    if not path.exists():
        return False
    tar.add(path, arcname=arcname)
    return True


def run_backup_sync() -> dict:
    """One tarball holding every mirror plus the credential files."""
    out_dir = backup_dir()
    out_dir.mkdir(parents=True, mode=0o700, exist_ok=True)

    archive = _free_name(out_dir)
    counts: dict[str, dict[str, int]] = {}

    with tempfile.TemporaryDirectory() as work:
        work_dir = Path(work)
        # Written to a temp name and renamed, so a crash mid-write never leaves
        # a truncated archive looking like a good one.
        partial = archive.with_suffix(archive.suffix + ".partial")
        with tarfile.open(partial, "w:gz") as tar:
            for db in sorted(DB_DIR.glob("*.db")) if DB_DIR.exists() else []:
                snapshot = work_dir / db.name
                counts[db.stem] = _snapshot(db, snapshot)
                tar.add(snapshot, arcname=f"sheets/{db.name}")

            # The refresh tokens. Without these a restored mirror still cannot
            # reach anyone's Google account.
            _add(tar, Path(settings.user_store_file), "users.json")
            _add(tar, Path(settings.cron_session_file), "cron-session.json")

        os.chmod(partial, 0o600)     # OAuth refresh tokens live in here
        partial.rename(archive)

    removed = prune()
    log.info("backup", "wrote snapshot", {
        "file": archive.name,
        "sizeKb": archive.stat().st_size // 1024,
        "mirrors": len(counts),
        "rows": sum(sum(c.values()) for c in counts.values()),
        "pruned": removed,
    })
    return {"file": str(archive), "counts": counts, "pruned": removed}


def prune() -> int:
    """Drop archives past KEEP_DAYS, but never below KEEP_AT_LEAST."""
    archives = sorted(
        (p for p in backup_dir().glob(f"{PREFIX}*{SUFFIX}")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    cutoff = time.time() - KEEP_DAYS * 86400
    removed = 0
    for path in archives[KEEP_AT_LEAST:]:
        if path.stat().st_mtime < cutoff:
            path.unlink(missing_ok=True)
            removed += 1
    return removed


async def run_backup() -> dict:
    return await asyncio.to_thread(run_backup_sync)

"""Server-side logger — output goes to pm2 logs / stdout.
Format: HH:MM:SS LEVEL [tag] message  key=value ...
(Mirrors src/lib/logger.ts so log tooling keeps working across the migration.)
"""
import sys
import traceback
from datetime import datetime
from typing import Any


def _fmt(level: str, tag: str, msg: str, data: dict[str, Any] | None = None) -> str:
    base = f"{datetime.now().strftime('%H:%M:%S')} {level:<5} [{tag}] {msg}"
    if not data:
        return base
    pairs = " ".join(f"{k}={v}" for k, v in data.items())
    return f"{base}  {pairs}"


class log:
    @staticmethod
    def info(tag: str, msg: str, data: dict[str, Any] | None = None) -> None:
        print(_fmt("INFO", tag, msg, data), flush=True)

    @staticmethod
    def warn(tag: str, msg: str, data: dict[str, Any] | None = None) -> None:
        print(_fmt("WARN", tag, msg, data), file=sys.stderr, flush=True)

    @staticmethod
    def error(tag: str, msg: str, err: BaseException | Any = None, data: dict[str, Any] | None = None) -> None:
        combined = dict(data or {})
        if err is not None:
            combined["err"] = str(err)
        print(_fmt("ERROR", tag, msg, combined or None), file=sys.stderr, flush=True)
        if isinstance(err, BaseException) and err.__traceback__:
            print("".join(traceback.format_tb(err.__traceback__)), file=sys.stderr, flush=True)

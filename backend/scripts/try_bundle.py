#!/usr/bin/env python
"""Run one file through the real extraction + bundle-parse path and print the logs.

Lets the attachment pipeline be exercised on the server before the Gmail import
is wired to it. Reads nothing from Sheets and writes nothing — safe to run
against production data.

    cd backend
    python scripts/try_bundle.py ~/mail.eml
    python scripts/try_bundle.py ~/statement.pdf
    python scripts/try_bundle.py ~/mail.eml --extract-only   # skip the AI call

Logs go to stdout/stderr in the usual pm2 format; redirect to share them:

    python scripts/try_bundle.py ~/mail.eml > run.log 2>&1
"""
import argparse
import asyncio
import json
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.parser import parse_units  # noqa: E402
from app.config import settings  # noqa: E402
from app.core.dates import today_iso  # noqa: E402
from app.extract.pipeline import collect_units, group_units  # noqa: E402
from app.services.expand_items import fold_items  # noqa: E402

MIME_BY_SUFFIX = {".eml": "message/rfc822", ".pdf": "application/pdf"}


def guess_mime(path: Path) -> str:
    return (MIME_BY_SUFFIX.get(path.suffix.lower())
            or mimetypes.guess_type(path.name)[0]
            or "application/octet-stream")


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path)
    ap.add_argument("--mime", help="override the detected content type")
    ap.add_argument("--region", default="India")
    ap.add_argument("--extract-only", action="store_true", help="skip the AI call")
    args = ap.parse_args()

    if not args.file.is_file():
        print(f"no such file: {args.file}", file=sys.stderr)
        return 1

    data = args.file.read_bytes()
    mime = args.mime or guess_mime(args.file)

    print(f"file     : {args.file.name} ({len(data):,} bytes)")
    print(f"mime     : {mime}")
    print(f"provider : {settings.ai_provider}  (opencode={settings.opencode_api_url})")
    print("-" * 72)

    units = await collect_units(data, mime, source=args.file.name)

    print("-" * 72)
    for u in units:
        if u["kind"] == "document":
            print(f"  document  {u['source']}  pages={u['page_count']}  chars={len(u['text']):,}")
        elif u["kind"] == "email":
            print(f"  email     from={u['from'][:60]}  chars={len(u['text']):,}")
        elif u["kind"] == "images":
            print(f"  images    {u['source']}  {u['mime']}  pages={len(u['pages'])}")
        else:
            print(f"  error     {u['source']}: {u['reason']}")

    if args.extract_only:
        print("\n(--extract-only: no AI call made)")
        return 0

    # One call per group, exactly as the import job does — a forwarded alert is
    # its own payment and must not be merged with the others.
    groups = group_units(units)
    print(f"groups   : {len(groups)}  (one AI call each)")
    print("-" * 72)

    rows = []
    for i, group in enumerate(groups, 1):
        result = await parse_units(group, args.region, today_iso())
        for tx in result["transactions"]:
            fold_items(tx)  # mirrors the email import path
        print(f"[group {i}/{len(groups)}] docType={result['docType']} "
              f"skipReason={result['skipReason']} rows={len(result['transactions'])}")
        rows.extend(result["transactions"])

    print("-" * 72)
    print(f"total rows: {len(rows)}")
    for tx in rows:
        print("  " + json.dumps(tx, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

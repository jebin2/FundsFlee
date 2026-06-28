"""Merge metadata encode/decode — port of src/domain/transactions/metadata.ts."""
import re

_MERGE_SOURCE_RE = re.compile(r"merge_source:([^\s|]+)")


def encode_merge_metadata(source_ids: list[str]) -> str:
    return f"merge_source:{','.join(source_ids)}"


def decode_merge_metadata(notes: str | None = None) -> list[str]:
    if not notes:
        return []
    match = _MERGE_SOURCE_RE.search(notes)
    if not match:
        return []
    return [s for s in match.group(1).split(",") if s]

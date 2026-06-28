"""Safe JSON parse — port of src/lib/safeJson.ts."""
import json
from typing import TypeVar

T = TypeVar("T")


def safe_json_parse(value: str | None, fallback: T) -> T:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError, ValueError):
        return fallback

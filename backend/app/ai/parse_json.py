"""Extract JSON from AI text responses — port of src/lib/ai/parseJson.ts."""
import json
import re
from typing import Literal, TypeVar

T = TypeVar("T")

_OBJECT_RE = re.compile(r"\{[\s\S]*\}")
_ARRAY_RE = re.compile(r"\[[\s\S]*\]")


def try_parse_ai_json(raw: str, expected_type: Literal["object", "array"] = "object"):
    pattern = _ARRAY_RE if expected_type == "array" else _OBJECT_RE
    match = pattern.search(raw)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except (json.JSONDecodeError, ValueError):
        return None


def parse_ai_json(raw: str, expected_type: Literal["object", "array"] = "object"):
    result = try_parse_ai_json(raw, expected_type)
    if result is None:
        raise ValueError("No JSON in AI response")
    return result

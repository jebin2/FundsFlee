"""Forcing a model's answer into the shape the app renders.

The prompt asks for a list of sentences and the model may return a list of
objects — {"insight": ..., "detail": ...} is what it actually did, and the UI
crashed rendering an object where a string belonged, taking the whole analysis
tab with it.

So the shape is enforced here rather than hoped for. Applied twice on purpose:
when an analysis is generated, and again when one is read back, because a cache
row written before this existed still holds the wrong shape and would keep
crashing until it was regenerated.
"""
from typing import Any

# The keys a model reaches for when it wraps a sentence in an object. Ordered:
# the headline first, the elaboration after.
_TEXT_KEYS = ("insight", "observation", "text", "title", "summary",
              "detail", "details", "description", "explanation")


def as_text(value: Any) -> str:
    """Anything the model returned, as one readable sentence."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        # Known keys first, in the order above; then anything else that is
        # scalar, so nothing the model said is silently dropped.
        parts = [as_text(value[k]) for k in _TEXT_KEYS if k in value]
        parts += [as_text(v) for k, v in value.items()
                  if k not in _TEXT_KEYS and not isinstance(v, (dict, list))]
        return " — ".join(dict.fromkeys(p for p in parts if p))
    if isinstance(value, list):
        return " ".join(p for p in (as_text(v) for v in value) if p)
    return str(value)


def insights(value: Any) -> list[str]:
    if not isinstance(value, list):
        value = [value] if value else []
    return [t for t in (as_text(v) for v in value) if t]


def _number(value: Any) -> float | int:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    try:
        return float(str(value).replace(",", "").replace("₹", "").strip())
    except (TypeError, ValueError):
        return 0


def tips(value: Any) -> list[dict]:
    """Optimization tips, each with every field the UI reads.

    A missing potential_saving used to reach formatINR as undefined and render
    "Save NaN/mo".
    """
    if not isinstance(value, list):
        value = [value] if value else []
    out = []
    for item in value:
        if not isinstance(item, dict):
            text = as_text(item)
            if not text:
                continue
            item = {"title": text}
        title = as_text(item.get("title"))
        description = as_text(item.get("description"))
        if not title and not description:
            continue
        out.append({
            "title": title or description,
            "description": description if title else "",
            "potential_saving": _number(item.get("potential_saving")),
            "effort": as_text(item.get("effort")) or "medium",
            "quality_impact": as_text(item.get("quality_impact")) or "minimal",
        })
    return out


def normalise(analysis: Any) -> Any:
    """A whole analysis payload, with both AI-authored lists made safe."""
    if not isinstance(analysis, dict):
        return analysis
    return {
        **analysis,
        "ai_insights": insights(analysis.get("ai_insights")),
        "optimization_tips": tips(analysis.get("optimization_tips")),
    }

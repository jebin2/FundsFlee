"""Number formatting helpers — Indian locale grouping.
Mirrors JS Number.prototype.toLocaleString("en-IN") default behavior
(integer part grouped 3-2-2…, up to 3 fraction digits, trailing zeros stripped).
"""
import re
from decimal import Decimal, ROUND_HALF_UP

_INT_PREFIX = re.compile(r"^[+-]?\d+")


def js_parse_int(s: str | None, default: int = 0) -> int:
    """JS parseInt(s, 10): leading-integer prefix parse, NaN→default.
    Mirrors `parseInt(x) || default` call sites in the TS code."""
    if s is None:
        return default
    m = _INT_PREFIX.match(str(s).lstrip())
    return int(m.group(0)) if m else default


def _group_indian(int_str: str) -> str:
    neg = int_str.startswith("-")
    if neg:
        int_str = int_str[1:]
    if len(int_str) <= 3:
        grouped = int_str
    else:
        head, tail = int_str[:-3], int_str[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        grouped = ",".join(parts) + "," + tail
    return ("-" + grouped) if neg else grouped


def to_locale_inr(value: float | int) -> str:
    """Replicates value.toLocaleString("en-IN") default (max 3 fraction digits)."""
    quantized = Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    sign = "-" if quantized < 0 else ""
    quantized = abs(quantized)
    int_part = int(quantized)
    frac = (quantized - int_part)
    grouped = _group_indian(str(int_part))
    if frac == 0:
        return sign + grouped
    frac_str = f"{frac:.3f}".split(".")[1].rstrip("0")
    return f"{sign}{grouped}.{frac_str}" if frac_str else sign + grouped

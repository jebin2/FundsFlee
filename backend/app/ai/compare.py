"""Merchant comparison — port of src/lib/ai/compare.ts."""
import math

from app.ai.client import generate_text
from app.ai.parse_json import parse_ai_json
from app.core.numbers import to_locale_inr


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def _build_stats(merchant: str, txs: list[dict]) -> dict:
    relevant = [t for t in txs if t["merchant"] == merchant and t["amount"] > 0]

    item_map: dict[str, dict] = {}
    for tx in relevant:
        name = tx.get("item_name")
        if not name:
            continue
        if name not in item_map:
            item_map[name] = {"count": 0, "total": 0}
        item_map[name]["count"] += 1
        item_map[name]["total"] += tx["amount"]

    top_items = sorted(
        ({"name": name, "count": d["count"], "avgPrice": _round(d["total"] / d["count"])}
         for name, d in item_map.items()),
        key=lambda i: i["count"], reverse=True,
    )[:5]

    amounts = [t["amount"] for t in relevant]
    total = sum(amounts)
    # preserve first-seen category order, de-duplicated (JS [...new Set(...)])
    categories: list[str] = []
    for t in relevant:
        if t["category"] not in categories:
            categories.append(t["category"])

    return {
        "merchant": merchant,
        "visits": len(relevant),
        "totalSpent": total,
        "avgPerVisit": _round(total / len(amounts)) if amounts else 0,
        "minSpend": min(amounts) if amounts else 0,
        "maxSpend": max(amounts) if amounts else 0,
        "categories": categories,
        "topItems": top_items,
    }


async def compare_merchants(
    merchants: list[str],
    transactions: list[dict],
    period: str,
    region: str,
) -> dict:
    stats = [_build_stats(m, transactions) for m in merchants]

    stats_text = "\n\n".join(
        f"""**{s['merchant']}**
- Visits: {s['visits']}
- Total spent: ₹{to_locale_inr(s['totalSpent'])}
- Avg per visit: ₹{s['avgPerVisit']}
- Range: ₹{s['minSpend']}–₹{s['maxSpend']}
- Categories: {", ".join(s['categories'])}
{("- Top items: " + ", ".join(f"{i['name']} ({i['count']}×, avg ₹{i['avgPrice']})" for i in s['topItems'])) if s['topItems'] else ""}"""
        for s in stats
    )

    raw = await generate_text(
        f"""Compare these merchants for a user in {region or "India"} over the period: {period}.

{stats_text}

Analyse and compare them on price, quantity/value, loyalty signals (repeat visits), and overall worth. Be specific and direct.

Respond with JSON only:
{{
  "summary": "2-3 sentence overview",
  "verdict": "name of the best overall merchant",
  "aspects": [
    {{
      "aspect": "Price",
      "analysis": "specific observation",
      "winner": "merchant name or null if tied",
      "scores": {{ "{merchants[0]}": 0-10, "{merchants[1]}": 0-10 }}
    }},
    {{
      "aspect": "Value for money",
      "analysis": "...",
      "winner": "...",
      "scores": {{ ... }}
    }},
    {{
      "aspect": "Visit frequency",
      "analysis": "...",
      "winner": "...",
      "scores": {{ ... }}
    }},
    {{
      "aspect": "Spend consistency",
      "analysis": "...",
      "winner": "...",
      "scores": {{ ... }}
    }}
  ],
  "recommendation": "1-2 sentence actionable advice"
}}""",
        "",
        2048,
    )

    parsed = parse_ai_json(raw)

    return {
        "merchants": merchants,
        "period": period,
        "summary": parsed["summary"],
        "verdict": parsed["verdict"],
        "aspects": parsed["aspects"],
        "recommendation": parsed["recommendation"],
    }

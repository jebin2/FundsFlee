"""Spending analysis — port of src/lib/ai/analyze.ts."""
import math

from app.ai.client import generate_text
from app.ai.parse_json import try_parse_ai_json
from app.ai import analysis_shape as shape
from app.core.numbers import to_locale_inr


def _round(x: float) -> int:
    """JS Math.round — round half toward +infinity."""
    return math.floor(x + 0.5)


async def analyze_spending(
    transactions: list[dict],
    period_label: str,
    user_region: str,
    lifestyle_tags: list[str],
) -> dict:
    total_spent = sum(t["amount"] for t in transactions)

    by_category: dict[str, float] = {}
    for t in transactions:
        by_category[t["category"]] = by_category.get(t["category"], 0) + t["amount"]

    category_summary = [
        {
            "category": category,
            "amount": amount,
            "percent": _round((amount / total_spent) * 100) if total_spent else 0,
            "count": len([t for t in transactions if t["category"] == category]),
        }
        for category, amount in sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)
    ]

    merchant_totals: dict[str, float] = {}
    for t in transactions:
        merchant_totals[t["merchant"]] = merchant_totals.get(t["merchant"], 0) + t["amount"]
    top_merchants = "\n".join(
        f"- {m}: ₹{to_locale_inr(a)}"
        for m, a in sorted(merchant_totals.items(), key=lambda kv: kv[1], reverse=True)[:5]
    )

    cat_lines = "\n".join(
        f"- {c['category']}: ₹{to_locale_inr(c['amount'])} ({c['percent']}%, {c['count']} transactions)"
        for c in category_summary
    )

    raw = await generate_text(
        f"""Analyze spending for a user in {user_region or "India"}.
Lifestyle: {", ".join(lifestyle_tags) or "not specified"}.
Period: {period_label}.
Total spent: ₹{to_locale_inr(total_spent)}.

Spending by category:
{cat_lines}

Top merchants:
{top_merchants}

Provide analysis as JSON:
{{
  "ai_insights": [3-5 plain strings, each one specific observation about their
                  spending patterns. Strings, NOT objects.],
  "optimization_tips": [
    {{
      "title": string,
      "description": string (specific to their region and lifestyle),
      "potential_saving": number (in INR per month),
      "effort": "low"|"medium"|"high",
      "quality_impact": "none"|"minimal"|"moderate"
    }}
  ]
}}

Be specific to the region (suggest local alternatives, local prices). For Indian users mention specific apps, services, and local options.""",
        "",
        2048,
    )

    ai_data = try_parse_ai_json(raw) or {"ai_insights": [], "optimization_tips": []}

    return {
        "period": period_label,
        "period_type": "month",
        "total_spent": total_spent,
        "by_category": category_summary,
        # The model is asked for strings and sometimes returns objects. The
        # shape is enforced, not trusted — the UI renders these directly.
        "ai_insights": shape.insights(ai_data.get("ai_insights")),
        "optimization_tips": shape.tips(ai_data.get("optimization_tips")),
    }

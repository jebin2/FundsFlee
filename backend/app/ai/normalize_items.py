"""Item-name normalisation — port of src/lib/ai/normalize-items.ts."""
from app.ai.client import generate_text
from app.ai.parse_json import try_parse_ai_json


async def normalize_item_names(names: list[str]) -> list[dict]:
    if len(names) == 0:
        return []

    # Items that are already unique enough — skip trivial single-item lists
    if len(names) == 1:
        return [{"canonical": names[0], "variants": names}]

    name_lines = "\n".join(f"{i + 1}. {n}" for i, n in enumerate(names))

    raw = await generate_text(
        f"""You are given a list of product names extracted from scanned receipts in India.
Some names have OCR errors, spelling mistakes, abbreviations, or case differences but refer to the same product.
Group them into canonical products.

Names:
{name_lines}

Rules:
- Merge only names that clearly refer to the same product (same brand + product + size when size matters)
- Do NOT merge different sizes (e.g. "Amul Butter 500g" ≠ "Amul Butter 200g")
- Pick the most complete/correct spelling as the canonical name
- Every input name must appear in exactly one group

Respond with JSON only:
{{
  "groups": [
    {{ "canonical": "clean product name", "variants": ["raw name 1", "raw name 2"] }}
  ]
}}""",
        "",
        2048,
    )

    parsed = try_parse_ai_json(raw)
    if not parsed:
        return [{"canonical": n, "variants": [n]} for n in names]

    groups = parsed.get("groups") or []
    # Safety: make sure every input name appears somewhere
    covered = {v for g in groups for v in g.get("variants", [])}
    for n in names:
        if n not in covered:
            groups.append({"canonical": n, "variants": [n]})
    return groups

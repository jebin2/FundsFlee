"""Compare endpoints — port of src/app/api/compare/route.ts + compare/items/route.ts."""
import json
import math

from fastapi import APIRouter, Depends, HTTPException, Request

from app.ai.normalize_items import normalize_item_names
from app.core.deps import SheetSession, require_session
from app.services.comparison_service import get_comparison_status, request_comparison
from app.sheets import get_all_transactions, get_analysis_cache, upsert_analysis_cache_row

router = APIRouter()


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def _fingerprint(names: list[str]) -> str:
    return "|".join(sorted(names))


def _build_comparisons(transactions: list[dict], groups: list[dict]) -> list[dict]:
    canon_map: dict[str, str] = {}
    for g in groups:
        for v in g["variants"]:
            canon_map[v.lower().strip()] = g["canonical"]

    data: dict[str, dict[str, dict]] = {}
    for tx in transactions:
        if not tx.get("item_name"):
            continue
        canon = canon_map.get(tx["item_name"].lower().strip(), tx["item_name"])
        if canon not in data:
            data[canon] = {}
        merchant = tx["merchant"]
        if merchant not in data[canon]:
            data[canon][merchant] = {"prices": [], "lastDate": tx["date"]}
        data[canon][merchant]["prices"].append(tx["amount"])
        if tx["date"] > data[canon][merchant]["lastDate"]:
            data[canon][merchant]["lastDate"] = tx["date"]
        if tx.get("notes"):
            data[canon][merchant]["notes"] = tx["notes"]

    result = []
    for canonical, merchants in data.items():
        if len(merchants) < 2:
            continue
        entries = [
            {
                "merchant": merchant,
                "avgPrice": _round(sum(d["prices"]) / len(d["prices"])),
                "minPrice": min(d["prices"]),
                "maxPrice": max(d["prices"]),
                "count": len(d["prices"]),
                "lastDate": d["lastDate"],
                "notes": d.get("notes"),
            }
            for merchant, d in merchants.items()
        ]
        entries.sort(key=lambda e: e["avgPrice"])
        result.append({"canonical": canonical, "entries": entries})

    result.sort(key=lambda c: len(c["entries"]), reverse=True)
    return result


@router.get("/api/compare")
async def compare_get(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    raw = request.query_params.get("merchants")
    merchants = [m for m in raw.split("|") if m] if raw else []
    period = request.query_params.get("period") or "month"
    return await get_comparison_status(session, merchants, period)


@router.post("/api/compare")
async def compare_post(request: Request, session: SheetSession = Depends(require_session)) -> dict:
    comparison = await request_comparison(session, await request.json())
    if "error" in comparison:
        raise HTTPException(status_code=400, detail="Select at least 2 merchants")
    return comparison


@router.get("/api/compare/items")
async def compare_items(session: SheetSession = Depends(require_session)) -> dict:
    access_token, sheet_id = session.access_token, session.sheet_id

    all_tx = await get_all_transactions(access_token, sheet_id)
    with_items = [t for t in all_tx if t.get("item_name") and t.get("amount", 0) > 0]
    if not with_items:
        return {"comparisons": [], "total_items": 0}

    unique_names = list(dict.fromkeys(t["item_name"] for t in with_items))
    cache_key = f"item_norm_{_fingerprint(unique_names)[:60]}"

    cached = await get_analysis_cache(access_token, sheet_id, cache_key, float("inf"))
    groups = None
    if cached and cached.get("status") == "done" and cached.get("summary_json"):
        try:
            groups = json.loads(cached["summary_json"])
        except Exception:
            groups = None
    if groups is None:
        groups = await normalize_item_names(unique_names)
        await upsert_analysis_cache_row(
            access_token, sheet_id, cache_key, "item_norm", "done",
            json.dumps(groups, ensure_ascii=False, separators=(",", ":")),
        )

    return {"comparisons": _build_comparisons(with_items, groups), "total_items": len(unique_names)}

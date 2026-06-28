"""Item suggestion service — port of src/server/services/itemSuggestionService.ts."""
import asyncio
import re

from app.core.deps import SheetSession
from app.sheets import (
    get_all_transactions,
    get_item_suggestions,
    resolve_item_suggestion,
    update_transaction_field,
)


async def get_pending_suggestions(session: SheetSession) -> list[dict]:
    suggestions, transactions = await asyncio.gather(
        get_item_suggestions(session.access_token, session.sheet_id),
        get_all_transactions(session.access_token, session.sheet_id),
    )

    result = []
    for suggestion in suggestions:
        if suggestion["status"] != "pending" or suggestion["suggested"] == suggestion["current_val"]:
            continue

        tx_ids = None
        if suggestion["source"] == "normalize":
            tx_ids = [
                tx["id"] for tx in transactions
                if tx.get("item_name") is not None
                and tx["item_name"].lower() == suggestion["current_val"].lower()
            ]

        entry = {
            "key": suggestion["key"],
            "field": suggestion["field"],
            "current_val": suggestion["current_val"],
            "suggested": suggestion["suggested"],
            "source": suggestion["source"],
        }
        if tx_ids is not None:
            entry["tx_ids"] = tx_ids
        result.append(entry)

    return result


async def resolve_pending_suggestion(session: SheetSession, request: dict) -> None:
    if request["action"] == "accept":
        suggestions = await get_item_suggestions(session.access_token, session.sheet_id)
        suggestion = next(
            (item for item in suggestions if item["key"] == request["key"] and item["field"] == request["field"]),
            None,
        )

        if suggestion:
            transactions = await get_all_transactions(session.access_token, session.sheet_id)

            if suggestion["source"] == "normalize":
                to_update = [
                    tx for tx in transactions
                    if tx.get("item_name") is not None
                    and tx["item_name"].lower() == suggestion["current_val"].lower()
                ]
                await asyncio.gather(*[
                    update_transaction_field(session.access_token, session.sheet_id, tx["id"], {
                        request["field"]: suggestion["suggested"],
                    })
                    for tx in to_update
                ])
            else:
                tx_id = re.sub(r"^tx:", "", request["key"])
                tx = next((item for item in transactions if item["id"] == tx_id), None)
                if tx:
                    await update_transaction_field(session.access_token, session.sheet_id, tx_id, {
                        request["field"]: suggestion["suggested"],
                    })

    await resolve_item_suggestion(
        session.access_token,
        session.sheet_id,
        request["key"],
        request["field"],
        "accepted" if request["action"] == "accept" else "rejected",
    )

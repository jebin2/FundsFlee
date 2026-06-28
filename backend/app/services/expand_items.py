"""Receipt item expansion — port of src/server/services/expandItems.ts."""
import uuid

from app.sheets import append_transaction, update_transaction_field
from app.core.deps import SheetSession


def item_quantity(qty: float | None, unit: str | None = None) -> str | None:
    # `qty` may be None when the AI omits it (JS: `undefined > 1` → false).
    if qty is not None and qty > 1:
        return f"{qty}{f' {unit}' if unit else ''}"
    return f"1 {unit}" if unit else None


def unit_price_note(qty: float | None, unit_price: float | None = None) -> str | None:
    return f"₹{unit_price}/unit" if unit_price is not None and qty is not None and qty > 1 else None


async def expand_items_to_rows(
    session: SheetSession,
    placeholder_id: str,
    base: dict,
    items: list[dict],
    now: str,
    total_amount: float | None = None,
) -> None:
    for item in items:
        tx = {
            "id": str(uuid.uuid4()),
            **base,
            "amount": item["price"],
            "category": item.get("category") or base["category"],
            "item_name": item.get("name"),
            "quantity": item_quantity(item.get("qty"), item.get("unit")),
            "notes": unit_price_note(item.get("qty"), item.get("unit_price")) or base.get("notes"),
            "status": "done",
            "created_at": now,
            "updated_at": now,
        }
        await append_transaction(session.access_token, session.sheet_id, tx)

    if total_amount is not None:
        items_total = sum(i["price"] for i in items)
        diff = float(f"{total_amount - items_total:.2f}")
        if diff > 0.01:
            adjust_tx = {
                "id": str(uuid.uuid4()),
                **base,
                "amount": diff,
                "item_name": "Other Items",
                "quantity": None,
                "notes": None,
                "status": "done",
                "created_at": now,
                "updated_at": now,
            }
            await append_transaction(session.access_token, session.sheet_id, adjust_tx)

    await update_transaction_field(
        session.access_token, session.sheet_id, placeholder_id,
        {"deleted": True, "status": "done"},
    )

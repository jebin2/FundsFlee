"""Receipt item expansion — port of src/server/services/expandItems.ts."""
import uuid

from app.sheets import append_transactions, update_transaction_field
from app.core.deps import SheetSession


def item_quantity(qty: float | None, unit: str | None = None) -> str | None:
    # `qty` may be None when the AI omits it (JS: `undefined > 1` → false).
    if qty is not None and qty > 1:
        return f"{qty}{f' {unit}' if unit else ''}"
    return f"1 {unit}" if unit else None


def unit_price_note(qty: float | None, unit_price: float | None = None) -> str | None:
    return f"₹{unit_price}/unit" if unit_price is not None and qty is not None and qty > 1 else None


def build_item_rows(
    base: dict,
    items: list[dict],
    now: str,
    total_amount: float | None = None,
) -> list[dict]:
    """One row per priced item, plus a balancer for whatever the items do not
    account for. Shared so a photographed receipt and an uploaded order PDF
    expand identically — only the entry point differs."""
    rows: list[dict] = []
    for item in items:
        rows.append({
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
        })

    if total_amount is not None:
        items_total = sum(i["price"] for i in items)
        diff = float(f"{total_amount - items_total:.2f}")
        # The rows must sum to what was actually charged. A shortfall is
        # tax/delivery the lines did not name; an excess is a discount applied
        # to the order. Without the second case an Amazon order with ₹1,025 off
        # would report the full list price as spend.
        if abs(diff) > 0.01:
            rows.append({
                "id": str(uuid.uuid4()),
                **base,
                "amount": diff,
                "item_name": "Other Items" if diff > 0 else "Discount",
                "quantity": None,
                "notes": None,
                "status": "done",
                "created_at": now,
                "updated_at": now,
            })
    return rows


def priced_items(items) -> list[dict]:
    """Only priced lines can become rows — splitting a total across unpriced
    items would be inventing the numbers."""
    return [i for i in (items or []) if isinstance(i, dict) and i.get("price") is not None]


async def expand_items_to_rows(
    session: SheetSession,
    placeholder_id: str,
    base: dict,
    items: list[dict],
    now: str,
    total_amount: float | None = None,
) -> None:
    # A receipt with a dozen items is one request, not thirteen.
    await append_transactions(
        session.access_token, session.sheet_id,
        build_item_rows(base, items, now, total_amount),
    )

    await update_transaction_field(
        session.access_token, session.sheet_id, placeholder_id,
        {"deleted": True, "status": "done"},
    )

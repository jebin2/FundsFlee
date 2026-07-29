"""Turning a parsed transaction into the rows that go in the sheet.

Every writer funnels through rows_from_parsed, and every writer that started
from a queued placeholder finishes through finish_placeholder. Five near-copies
of this logic is what produced a run of bugs where one path got a fix and the
others did not.

fold_items lives here rather than beside the prompt because it is row shaping,
not parsing — and keeping it here stops the AI layer depending on services.
"""
import uuid

from app.core.deps import SheetSession
from app.core.logger import log
from app.sheets import append_transactions, update_transaction_field


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


def fold_items(tx: dict) -> None:
    """Put line items on the transaction itself, for flows that keep one row."""
    items = tx.get("items") or []
    if not items:
        return
    listing = "; ".join(
        f"{i['qty']:g} × {i['name']}" + (f" ({i['unit']})" if i.get("unit") else "")
        for i in items
    )
    if len(items) == 1:
        tx["item_name"] = items[0]["name"]
        qty_label = item_quantity(items[0]["qty"], items[0].get("unit"))
        if qty_label:
            tx["quantity"] = qty_label
    else:
        tx["item_name"] = f"{items[0]['name']} +{len(items) - 1} more"

    existing = (tx.get("notes") or "").strip()
    tx["notes"] = f"{listing} · {existing}" if existing else listing


def rows_from_parsed(
    base: dict,
    parsed: dict,
    now: str,
    total_amount: float | None = None,
) -> list[dict]:
    """The one rule: a priced, itemised bill becomes a row per item; anything
    else stays a single row with the item names folded into notes."""
    items = priced_items(parsed.get("items"))
    total = total_amount if total_amount is not None else parsed.get("amount")

    if len(items) > 1:
        return build_item_rows(base, items, now, total)

    fold_items(parsed)
    single = items[0] if items else None
    notes = parsed.get("notes")
    unit_note = unit_price_note(single.get("qty"), single.get("unit_price")) if single else None
    if unit_note and unit_note not in (notes or ""):
        notes = f"{notes} · {unit_note}" if notes else unit_note

    return [{
        **base,
        "id": str(uuid.uuid4()),
        "amount": total,
        "item_name": parsed.get("item_name") or (single.get("name") if single else None),
        "quantity": parsed.get("quantity")
        or (item_quantity(single.get("qty"), single.get("unit")) if single else None),
        "notes": notes,
        "status": "done",
        "created_at": now,
        "updated_at": now,
    }]


async def finish_placeholder(
    session: SheetSession,
    placeholder_id: str,
    rows: list[dict],
    now: str,
) -> list[str]:
    """Complete a queued placeholder with the rows a parse produced.

    One row fills the placeholder in place: the queued row becomes the
    transaction, keeping its receipt_url and costing one sheet row instead of
    two. Many rows are appended and the placeholder is soft-deleted, left as
    the audit stub they point at via receipt_id.

    The statement job used to append even for a single row, so an uploaded
    one-line PDF left a dead placeholder behind while the same thing from a
    photo did not.

    Returns the ids of the transactions now in the sheet, so the caller can
    hand them to the duplicate scan.
    """
    if not rows:
        await update_transaction_field(
            session.access_token, session.sheet_id, placeholder_id, {"status": "failed"})
        return []

    if len(rows) == 1:
        fields = {k: v for k, v in rows[0].items() if k not in ("id", "created_at")}
        fields["status"] = "done"
        fields["updated_at"] = now
        await update_transaction_field(
            session.access_token, session.sheet_id, placeholder_id, fields)
        return [placeholder_id]

    log.info("rows", "expanded to item rows", {"placeholderId": placeholder_id, "rows": len(rows)})
    await append_transactions(session.access_token, session.sheet_id, rows)
    await update_transaction_field(
        session.access_token, session.sheet_id, placeholder_id,
        {"deleted": True, "status": "done"})
    return [r["id"] for r in rows]

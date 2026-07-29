"""The single parser — every entry point lands here."""
import asyncio
import json

import pytest

import app.ai.parser as mod
from app.ai.parser import (
    CONFIDENCE_FLOOR,
    NO_FLOOR,
    fold_items,
    image_unit,
    parse_units,
    text_unit,
    validate_transaction,
)

TODAY = "2026-07-29"


def _row(amount, merchant="Nandhana Palace", **over):
    row = {
        "amount": amount, "merchant": merchant, "category": "Food & Dining",
        "payment_method": "UPI", "date": TODAY, "time": "12:58",
        "notes": "Order 8407112492", "confidence": 0.95, "uncertain_fields": [],
    }
    row.update(over)
    return row


def _email(text="Rs 426.11 debited for your Nandhana Palace order. Payment successful.",
           subject="Your Zomato order"):
    return {"kind": "email", "text": text, "from": "noreply@zomato.com",
            "subject": subject, "date": None, "group": 0}


def _doc(text="Order Summary Total 426.11", source="Order_ID.pdf"):
    return {"kind": "document", "text": text, "source": source, "group": 0}


def _fake_text(monkeypatch, payload, capture=None):
    async def fake(prompt, system, max_tokens=1024):
        if capture is not None:
            capture["prompt"], capture["system"] = prompt, system
        if isinstance(payload, Exception):
            raise payload
        return payload if isinstance(payload, str) else json.dumps(payload)
    monkeypatch.setattr(mod, "generate_text", fake)


def _fake_image(monkeypatch, payloads):
    calls = []

    async def fake(b64, mime, text, system, max_tokens=2048):
        idx = len(calls)
        calls.append({"b64": b64, "mime": mime, "text": text})
        p = payloads[idx] if idx < len(payloads) else {"doc_type": "purchase", "transactions": []}
        if isinstance(p, Exception):
            raise p
        return p if isinstance(p, str) else json.dumps(p)
    monkeypatch.setattr(mod, "generate_with_image", fake)
    return calls


def _run(units, **kw):
    kw.setdefault("apply_cheap_guards", False)
    return asyncio.run(parse_units(units, "India", TODAY, **kw))


class TestMerging:
    def test_component_invoices_collapse_to_one_payment(self, monkeypatch):
        _fake_text(monkeypatch, {"doc_type": "purchase", "transactions": [_row(426.11)]})
        out = _run([_email(), _doc(), _doc(source="Order_Invoice.pdf")])
        assert [t["amount"] for t in out["transactions"]] == [426.11]

    def test_a_purchase_that_multiplies_collapses_to_the_largest(self, monkeypatch):
        _fake_text(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(426.11), _row(360.15, "NANDHANA FOODS PRIVATE LIMITED"), _row(17.58, "ETERNAL LIMITED")]})
        out = _run([_email(), _doc()])
        assert [t["amount"] for t in out["transactions"]] == [426.11]

    def test_statements_keep_every_row(self, monkeypatch):
        _fake_text(monkeypatch, {"doc_type": "statement", "transactions": [
            _row(450, "Swiggy"), _row(1299, "Amazon"), _row(5000, "Rahul Sharma")]})
        out = _run([_doc(text="HDFC statement ...")])
        assert out["docType"] == "statement"
        assert [t["amount"] for t in out["transactions"]] == [450, 1299, 5000]


class TestValidationEverywhere:
    """The gauntlet used to run on 2 of 5 paths; now it runs on all of them."""

    BAD = {"doc_type": "statement", "transactions": [
        _row(450, "Swiggy"),
        _row(0),                              # non-positive
        _row(900_000, "Huge"),                # above the ceiling
        _row(100, "Unknown"),                 # undeterminable merchant
        _row(100, "Old", date="2000-01-01"),  # outside the date window
        _row(100, "Bad", date="not-a-date"),
    ]}

    def test_statement_rows_are_validated(self, monkeypatch):
        _fake_text(monkeypatch, self.BAD)
        out = _run([_doc(text="statement")], min_confidence=NO_FLOOR)
        assert [t["merchant"] for t in out["transactions"]] == ["Swiggy"]

    def test_text_entry_is_validated(self, monkeypatch):
        _fake_text(monkeypatch, self.BAD)
        out = _run([text_unit("some sms")], min_confidence=NO_FLOOR)
        assert [t["merchant"] for t in out["transactions"]] == ["Swiggy"]

    def test_confidence_floor_applies_to_automatic_imports(self, monkeypatch):
        _fake_text(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(100, "Vague", confidence=0.2)]})
        assert _run([_email()], min_confidence=CONFIDENCE_FLOOR)["transactions"] == []

    def test_interactive_entry_keeps_low_confidence_rows(self, monkeypatch):
        # The user is watching and can correct it; silently dropping is worse.
        _fake_text(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(100, "Vague", confidence=0.2)]})
        assert len(_run([text_unit("x")], min_confidence=NO_FLOOR)["transactions"]) == 1

    def test_missing_confidence_is_treated_as_certain(self):
        # Absent != doubtful. Treating it as 0 would discard real payments over
        # one missing field.
        row = _row(450, "Swiggy")
        row.pop("confidence")
        assert validate_transaction(row, TODAY) is not None

    def test_enums_are_coerced_not_rejected(self):
        tx = validate_transaction(_row(450, category="Nonsense", payment_method="Crypto"), TODAY)
        assert tx["category"] == "Others"
        assert tx["payment_method"] == "Other"

    def test_subcategory_survives_validation(self):
        tx = validate_transaction(_row(450, subcategory="Biryani"), TODAY)
        assert tx["subcategory"] == "Biryani"


class TestPlatform:
    """The ordering app has to be recorded somewhere, or "how much did I spend
    on Zomato?" is unanswerable — the merchant column is the restaurant."""

    def test_platform_becomes_a_tag(self):
        tx = validate_transaction(_row(504.47, "Nandhana Palace", platform="Zomato"), TODAY)
        assert tx["tags"] == ["Zomato"]
        assert tx["merchant"] == "Nandhana Palace"   # merchant is still the payee

    def test_no_platform_leaves_tags_unset(self):
        assert "tags" not in validate_transaction(_row(450, "Local Cafe"), TODAY)

    def test_null_platform_is_ignored(self):
        assert "tags" not in validate_transaction(_row(450, platform=None), TODAY)

    def test_blank_platform_is_ignored(self):
        assert "tags" not in validate_transaction(_row(450, platform="   "), TODAY)

    def test_platform_is_trimmed(self):
        assert validate_transaction(_row(450, platform="  Swiggy "), TODAY)["tags"] == ["Swiggy"]

    def test_platform_reaches_the_row(self):
        from app.sheets.transaction_schema import idx, transaction_to_row
        tx = validate_transaction(_row(450, platform="Zomato"), TODAY)
        row = transaction_to_row({**tx, "id": "x", "source": "email",
                                  "created_at": "t", "updated_at": "t"})
        assert row[idx("tags")] == "Zomato"


class TestItems:
    ORDER = [{"name": "High Protein - Supreme Boneless Chicken Biryani", "qty": 1},
             {"name": "Andhra Pappula Podi - 200Gms", "qty": 1}]

    def test_items_survive_validation_with_prices(self):
        tx = validate_transaction(
            _row(500, items=[{"name": "Biryani", "qty": 2, "price": 325, "unit_price": 162.5}]), TODAY)
        assert tx["items"][0]["price"] == 325
        assert tx["items"][0]["unit_price"] == 162.5

    def test_folding_puts_names_in_notes(self):
        tx = validate_transaction(_row(504.47, items=self.ORDER, notes="Order ID: 8121273968"), TODAY)
        fold_items(tx)
        assert tx["notes"] == (
            "1 × High Protein - Supreme Boneless Chicken Biryani; "
            "1 × Andhra Pappula Podi - 200Gms · Order ID: 8121273968")
        assert tx["item_name"] == "High Protein - Supreme Boneless Chicken Biryani +1 more"

    def test_folding_a_single_item(self):
        tx = validate_transaction(_row(325, notes=None, items=[{"name": "Biryani", "qty": 2}]), TODAY)
        fold_items(tx)
        assert tx["item_name"] == "Biryani"
        assert tx["quantity"] == "2"
        assert tx["notes"] == "2 × Biryani"

    def test_malformed_items_are_dropped(self):
        tx = validate_transaction(_row(100, items=["str", {"qty": 2}, None], notes="keep"), TODAY)
        assert "items" not in tx
        fold_items(tx)
        assert tx["notes"] == "keep"


class TestImageEntry:
    def test_image_units_use_the_image_chain(self, monkeypatch):
        calls = _fake_image(monkeypatch, [{"doc_type": "purchase", "transactions": [_row(450, "Cafe")]}])
        out = _run([image_unit("BASE64", "image/jpeg")], min_confidence=NO_FLOOR)
        assert [t["merchant"] for t in out["transactions"]] == ["Cafe"]
        assert calls[0]["mime"] == "image/jpeg"
        assert calls[0]["b64"] == "BASE64"

    def test_scanned_pages_are_one_call_each_and_accumulate(self, monkeypatch):
        pages = {"kind": "images", "pages": ["p1", "p2", "p3"], "mime": "image/png", "group": 0}
        calls = _fake_image(monkeypatch, [
            {"doc_type": "statement", "transactions": [_row(100, "A")]},
            {"doc_type": "statement", "transactions": [_row(200, "B")]},
            {"doc_type": "statement", "transactions": [_row(300, "C")]},
        ])
        out = _run([pages], min_confidence=NO_FLOOR)
        assert len(calls) == 3
        assert [t["merchant"] for t in out["transactions"]] == ["A", "B", "C"]
        assert "page 1 of 3" in calls[0]["text"]

    def test_text_context_reaches_the_image_call(self, monkeypatch):
        calls = _fake_image(monkeypatch, [{"doc_type": "purchase", "transactions": [_row(1, "X")]}])
        _run([_email(text="Receipt attached for Rs 1"), image_unit("B64", "image/png")],
             min_confidence=NO_FLOOR)
        assert "Receipt attached" in calls[0]["text"]


class TestCheapGuards:
    def test_short_body_never_reaches_the_ai(self, monkeypatch):
        called = []

        async def fake(*a, **kw):
            called.append(1)
            return "{}"
        monkeypatch.setattr(mod, "generate_text", fake)
        out = asyncio.run(parse_units([_email(text="Zomato order bills")], "India", TODAY))
        assert out["skipReason"] == "too_short"
        assert called == []

    def test_body_without_money_words_never_reaches_the_ai(self, monkeypatch):
        called = []

        async def fake(*a, **kw):
            called.append(1)
            return "{}"
        monkeypatch.setattr(mod, "generate_text", fake)
        text = "Someone just logged in to your account from a new device. " * 3
        out = asyncio.run(parse_units([_email(text=text)], "India", TODAY))
        assert out["skipReason"] == "no_signal"
        assert called == []

    def test_guards_do_not_apply_when_documents_are_present(self, monkeypatch):
        # A statement mail is often a bare subject line plus the PDF.
        _fake_text(monkeypatch, {"doc_type": "statement", "transactions": [_row(450, "Swiggy")]})
        out = asyncio.run(parse_units([_email(text="see attached"), _doc()], "India", TODAY))
        assert len(out["transactions"]) == 1


class TestSkipPaths:
    def test_nothing_parseable(self):
        assert _run([])["skipReason"] == "nothing_to_parse"

    def test_provider_failure_is_reported_not_raised(self, monkeypatch):
        _fake_text(monkeypatch, RuntimeError("all providers down"))
        assert _run([_email()])["skipReason"] == "parse_error"

    def test_unparseable_response(self, monkeypatch):
        _fake_text(monkeypatch, "I cannot help with that")
        assert _run([_email()])["skipReason"] == "ai_null"

    def test_no_debit_reported(self, monkeypatch):
        _fake_text(monkeypatch, {"doc_type": "purchase", "transactions": []})
        assert _run([_email()])["skipReason"] == "ai_null"

    def test_every_row_invalid(self, monkeypatch):
        _fake_text(monkeypatch, {"doc_type": "purchase", "transactions": [_row(0)]})
        assert _run([_email()])["skipReason"] == "validation_failed"


class TestPromptAssembly:
    def test_units_are_labelled(self, monkeypatch):
        cap = {}
        _fake_text(monkeypatch, {"doc_type": "purchase", "transactions": [_row(426.11)]}, cap)
        _run([_email(), _doc(source="Order_Invoice.pdf")])
        assert "--- EMAIL BODY ---" in cap["prompt"]
        assert "--- ATTACHED DOCUMENT: Order_Invoice.pdf ---" in cap["prompt"]
        assert f"Today's date is {TODAY}." in cap["prompt"]
        assert "Merge, do not multiply" in cap["system"]

    def test_text_units_are_labelled(self, monkeypatch):
        cap = {}
        _fake_text(monkeypatch, {"doc_type": "purchase", "transactions": [_row(1)]}, cap)
        _run([text_unit("Rs 1 debited")])
        assert "--- TEXT ---" in cap["prompt"]


@pytest.mark.parametrize("entry", ["text", "image", "email", "document"])
def test_every_entry_shares_one_prompt(monkeypatch, entry):
    """The point of the refactor: one system prompt, whatever the entry."""
    seen = {}
    units = {
        "text": [text_unit("Rs 100 debited at Cafe")],
        "email": [_email()],
        "document": [_doc()],
        "image": [image_unit("B64", "image/png")],
    }[entry]

    async def fake_text(prompt, system, max_tokens=1024):
        seen["system"] = system
        return json.dumps({"doc_type": "purchase", "transactions": []})

    async def fake_image(b64, mime, text, system, max_tokens=2048):
        seen["system"] = system
        return json.dumps({"doc_type": "purchase", "transactions": []})

    monkeypatch.setattr(mod, "generate_text", fake_text)
    monkeypatch.setattr(mod, "generate_with_image", fake_image)
    _run(units)
    assert seen["system"] == mod.SYSTEM_PROMPT

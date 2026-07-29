"""Bundle parser — one email + its attachments collapse to one payment."""
import asyncio
import json

import pytest

from app.ai import parse_bundle
from app.ai.parse_bundle import (
    MAX_DOC_CHARS,
    MAX_EMAIL_CHARS,
    build_bundle_prompt,
    parse_email_bundle,
)

TODAY = "2026-07-29"


def _row(amount, merchant="Nandhana Palace", **over):
    row = {
        "amount": amount, "merchant": merchant, "category": "Food & Dining",
        "payment_method": "UPI", "date": TODAY, "time": "12:58",
        "item_name": None, "notes": "Order 8407112492",
        "confidence": 0.95, "uncertain_fields": [],
    }
    row.update(over)
    return row


def _units():
    """Shaped like the real Zomato email: body + three component PDFs."""
    return [
        {"kind": "email", "text": "Your order from Nandhana Palace. Total Rs 426.11",
         "from": "noreply@zomato.com", "subject": "Your Zomato order", "date": None},
        {"kind": "document", "text": "Order Summary ... Total 426.11", "source": "Order_ID.pdf"},
        {"kind": "document", "text": "Tax Invoice NANDHANA FOODS PRIVATE LIMITED 360.15",
         "source": "Order_Invoice.pdf"},
        {"kind": "document", "text": "Tax Invoice ETERNAL LIMITED 17.58",
         "source": "User_Charge_Invoice.pdf"},
    ]


def _fake_ai(monkeypatch, payload, capture=None):
    async def fake(prompt, system, max_tokens=1024):
        if capture is not None:
            capture["prompt"] = prompt
            capture["system"] = system
        if isinstance(payload, Exception):
            raise payload
        return payload if isinstance(payload, str) else json.dumps(payload)

    monkeypatch.setattr(parse_bundle, "generate_text", fake)


def _run(units=None, region="India", today=TODAY):
    return asyncio.run(parse_email_bundle(units if units is not None else _units(), region, today))


class TestMerging:
    def test_component_invoices_collapse_to_one_payment(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [_row(426.11)]})
        out = _run()
        assert len(out["transactions"]) == 1
        assert out["transactions"][0]["amount"] == 426.11
        assert out["docType"] == "purchase"

    def test_a_purchase_that_multiplies_is_collapsed_to_the_largest(self, monkeypatch):
        # Guard for the model ignoring the merge rule: 426.11 + 360.15 + 17.58
        # must never all land as spend.
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(426.11), _row(360.15, "NANDHANA FOODS PRIVATE LIMITED"), _row(17.58, "ETERNAL LIMITED"),
        ]})
        out = _run()
        assert len(out["transactions"]) == 1
        assert out["transactions"][0]["amount"] == 426.11

    def test_statements_keep_every_row(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "statement", "transactions": [
            _row(450, "Swiggy"), _row(1299, "Amazon"), _row(5000, "Rahul Sharma"),
        ]})
        out = _run()
        assert out["docType"] == "statement"
        assert [t["amount"] for t in out["transactions"]] == [450, 1299, 5000]


class TestItems:
    """Line items from the email body land on the transaction."""

    ORDER = [{"name": "High Protein - Supreme Boneless Chicken Biryani", "qty": 1},
             {"name": "Andhra Pappula Podi - 200Gms", "qty": 1}]

    def test_item_names_go_into_notes(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(504.47, items=self.ORDER, notes="Order ID: 8121273968")]})
        tx = _run()["transactions"][0]
        assert tx["notes"] == (
            "1 × High Protein - Supreme Boneless Chicken Biryani; "
            "1 × Andhra Pappula Podi - 200Gms · Order ID: 8121273968")

    def test_multiple_items_summarise_in_item_name(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(504.47, items=self.ORDER)]})
        tx = _run()["transactions"][0]
        assert tx["item_name"] == "High Protein - Supreme Boneless Chicken Biryani +1 more"

    def test_single_item_becomes_the_item_name(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(325, items=[{"name": "Chicken Biryani", "qty": 1}])]})
        tx = _run()["transactions"][0]
        assert tx["item_name"] == "Chicken Biryani"
        assert "quantity" not in tx  # qty 1 adds no noise

    def test_quantity_is_recorded_when_more_than_one(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(650, notes=None, items=[{"name": "Chicken Biryani", "qty": 2}])]})
        tx = _run()["transactions"][0]
        assert tx["quantity"] == "2"
        assert tx["notes"] == "2 × Chicken Biryani"

    def test_units_are_kept(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(120, notes=None, items=[{"name": "Milk", "qty": 2, "unit": "L"}])]})
        assert _run()["transactions"][0]["notes"] == "2 × Milk (L)"

    def test_fractional_quantities_do_not_render_as_floats(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(120, items=[{"name": "Tomatoes", "qty": 1.5, "unit": "kg"}])]})
        assert "1.5 × Tomatoes" in _run()["transactions"][0]["notes"]

    def test_no_items_leaves_the_transaction_untouched(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(426.11, items=[], notes="Order ID: 1")]})
        tx = _run()["transactions"][0]
        assert tx["notes"] == "Order ID: 1"

    def test_malformed_items_are_ignored(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [
            _row(426.11, items=["just a string", {"qty": 2}, None], notes="keep me")]})
        assert _run()["transactions"][0]["notes"] == "keep me"


class TestValidation:
    def test_rows_failing_the_gauntlet_are_dropped(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "statement", "transactions": [
            _row(450, "Swiggy"),
            _row(0),                              # non-positive amount
            _row(900_000, "Huge"),                # above the ceiling
            _row(100, "Meh", confidence=0.2),     # below the confidence floor
            _row(100, "Unknown"),                 # merchant undeterminable
            _row(100, "Old", date="2000-01-01"),  # outside the date window
        ]})
        out = _run()
        assert [t["merchant"] for t in out["transactions"]] == ["Swiggy"]

    def test_all_rows_invalid_reports_validation_failed(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [_row(0)]})
        out = _run()
        assert out["transactions"] == []
        assert out["skipReason"] == "validation_failed"

    def test_unknown_doc_type_falls_back_to_purchase(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "nonsense", "transactions": [_row(426.11)]})
        assert _run()["docType"] == "purchase"


class TestSkipPaths:
    def test_no_parseable_units(self):
        out = _run([{"kind": "images", "pages": ["x"], "mime": "image/png"}])
        assert out["skipReason"] == "nothing_to_parse"

    def test_units_without_text_are_ignored(self):
        assert _run([{"kind": "document", "text": "", "source": "empty.pdf"}])["skipReason"] == "nothing_to_parse"

    def test_ai_failure_is_reported_not_raised(self, monkeypatch):
        _fake_ai(monkeypatch, RuntimeError("opencode timed out"))
        out = _run()
        assert out["transactions"] == [] and out["skipReason"] == "parse_error"

    def test_unparseable_ai_output(self, monkeypatch):
        _fake_ai(monkeypatch, "sorry, I cannot help with that")
        assert _run()["skipReason"] == "ai_null"

    def test_empty_transaction_list(self, monkeypatch):
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": []})
        assert _run()["skipReason"] == "ai_null"


class TestPromptBuilding:
    def test_every_unit_is_labelled(self):
        prompt = build_bundle_prompt(_units(), "India", TODAY)
        assert "--- EMAIL BODY ---" in prompt
        assert "--- ATTACHED DOCUMENT: Order_Invoice.pdf ---" in prompt
        assert "From: noreply@zomato.com" in prompt
        assert f"Today's date is {TODAY}." in prompt

    def test_region_is_optional(self):
        assert "User is in" not in build_bundle_prompt(_units(), "", TODAY)

    def test_truncation_is_per_unit_not_flat(self):
        # Z/Q appear in none of the labels, so the counts measure only the body.
        units = [
            {"kind": "email", "text": "Z" * 9_000, "from": "a@b.c", "subject": "s"},
            {"kind": "document", "text": "Q" * 40_000, "source": "big.pdf"},
        ]
        prompt = build_bundle_prompt(units, "", TODAY)
        assert prompt.count("Z") == MAX_EMAIL_CHARS
        assert prompt.count("Q") == MAX_DOC_CHARS

    def test_truncated_documents_are_flagged_to_the_model(self):
        units = [{"kind": "document", "text": "x", "source": "s.pdf", "truncated": True}]
        assert "(truncated)" in build_bundle_prompt(units, "", TODAY)

    def test_system_prompt_is_sent(self, monkeypatch):
        cap = {}
        _fake_ai(monkeypatch, {"doc_type": "purchase", "transactions": [_row(426.11)]}, cap)
        _run()
        assert "Merge, do not multiply" in cap["system"]
        assert "Order_Invoice.pdf" in cap["prompt"]

"""Item expansion — the rows written must sum to what was actually charged."""
from app.services.expand_items import build_item_rows, priced_items

NOW = "2026-07-30T00:00:00.000Z"
BASE = {"date": "2026-07-04", "time": "00:00", "merchant": "Amazon",
        "category": "Shopping", "payment_method": "Card", "source": "import"}


def _total(rows):
    return round(sum(r["amount"] for r in rows), 2)


class TestSumsToTheCharge:
    def test_a_discount_is_recorded_so_spend_is_not_inflated(self):
        # The real Amazon order: three items listing 11,098 but 10,072.05 charged.
        items = [{"name": "Air Fryer", "qty": 1, "price": 9499.0},
                 {"name": "Egg Boiler", "qty": 1, "price": 1000.0},
                 {"name": "Containers", "qty": 1, "price": 599.0}]
        rows = build_item_rows(BASE, items, NOW, 10072.05)
        assert _total(rows) == 10072.05
        assert rows[-1]["item_name"] == "Discount"
        assert rows[-1]["amount"] == -1025.95

    def test_a_shortfall_becomes_other_items(self):
        # Tax and delivery the lines never named.
        items = [{"name": "Rice", "qty": 1, "price": 400.0}]
        rows = build_item_rows(BASE, items, NOW, 450.0)
        assert _total(rows) == 450.0
        assert rows[-1]["item_name"] == "Other Items"
        assert rows[-1]["amount"] == 50.0

    def test_an_exact_match_adds_no_balancer(self):
        items = [{"name": "Rice", "qty": 1, "price": 400.0},
                 {"name": "Dal", "qty": 1, "price": 100.0}]
        rows = build_item_rows(BASE, items, NOW, 500.0)
        assert len(rows) == 2
        assert _total(rows) == 500.0

    def test_rounding_noise_adds_no_balancer(self):
        items = [{"name": "Rice", "qty": 1, "price": 400.0}]
        assert len(build_item_rows(BASE, items, NOW, 400.005)) == 1

    def test_no_total_means_no_balancer(self):
        items = [{"name": "Rice", "qty": 1, "price": 400.0}]
        assert len(build_item_rows(BASE, items, NOW)) == 1


class TestRowShape:
    def test_each_item_becomes_its_own_row(self):
        items = [{"name": "Rice", "qty": 2, "unit": "kg", "price": 400.0, "unit_price": 200.0},
                 {"name": "Dal", "qty": 1, "price": 100.0}]
        rows = build_item_rows(BASE, items, NOW)
        assert [r["item_name"] for r in rows] == ["Rice", "Dal"]
        assert rows[0]["quantity"] == "2 kg"
        assert rows[0]["notes"] == "₹200.0/unit"
        assert all(r["merchant"] == "Amazon" and r["status"] == "done" for r in rows)

    def test_item_category_overrides_the_bill_category(self):
        items = [{"name": "Shampoo", "qty": 1, "price": 200.0, "category": "Personal Care"}]
        assert build_item_rows(BASE, items, NOW)[0]["category"] == "Personal Care"

    def test_rows_get_distinct_ids(self):
        items = [{"name": "A", "qty": 1, "price": 1.0}, {"name": "B", "qty": 1, "price": 2.0}]
        rows = build_item_rows(BASE, items, NOW)
        assert rows[0]["id"] != rows[1]["id"]


class TestPricedItems:
    def test_unpriced_lines_are_excluded(self):
        # A Zomato email names dishes without pricing them; splitting the total
        # across those would be inventing numbers.
        items = [{"name": "Biryani", "qty": 1, "price": 325.0}, {"name": "Podi", "qty": 1}]
        assert [i["name"] for i in priced_items(items)] == ["Biryani"]

    def test_handles_missing_and_malformed(self):
        assert priced_items(None) == []
        assert priced_items(["nope", {"name": "x"}]) == []


class TestEveryWriterSharesTheRule:
    """The rule is only real if every path that turns a parse into rows applies
    it. Two were missed on the first pass: text_parse_job expanded with
    unfiltered items (build_item_rows indexes item["price"], so an unpriced
    line raised KeyError) and the shortcut route ignored items entirely."""

    WRITERS = [
        "app/services/receipt_processing_service.py",
        "app/jobs/statement_parse_job.py",
        # The email path builds its rows in email_import/message.py, which the
        # import job and the single-mail re-run both call.
        "app/email_import/message.py",
        "app/jobs/text_parse_job.py",
        "app/routers/shortcut.py",
    ]

    def test_all_of_them_go_through_the_shared_builder(self):
        # Stronger than checking each one filters correctly: if they all call
        # rows_from_parsed, the rule cannot diverge between them at all.
        import pathlib as _p
        root = _p.Path(__file__).resolve().parents[1]
        missing = [w for w in self.WRITERS if "rows_from_parsed" not in (root / w).read_text()]
        assert missing == [], f"writers not using the shared builder: {missing}"

    def test_every_import_path_runs_the_duplicate_scan(self):
        # An uploaded PDF can duplicate a purchase already imported from its
        # confirmation email. Before this, only the email path ever checked.
        import pathlib as _p
        root = _p.Path(__file__).resolve().parents[1]
        importers = [
            "app/services/receipt_processing_service.py",
            "app/jobs/statement_parse_job.py",
            "app/jobs/email_import_job.py",
            "app/jobs/text_parse_job.py",
        ]
        missing = [w for w in importers
                   if "deduplicate_new_transactions" not in (root / w).read_text()]
        assert missing == [], f"import paths not scanning for duplicates: {missing}"

    def test_adapters_do_not_drop_rows(self):
        # parse_transaction_text / parse_receipt_image used to return
        # transactions[0], so a pasted or photographed statement imported its
        # first line and silently lost the rest.
        import pathlib as _p
        root = _p.Path(__file__).resolve().parents[1]
        for adapter in ("app/ai/parse_text.py", "app/ai/parse_image.py"):
            src = (root / adapter).read_text()
            assert "rows[0] if rows else {}" not in src, adapter

    def test_none_of_them_expand_unfiltered(self):
        import pathlib as _p
        root = _p.Path(__file__).resolve().parents[1]
        offenders = [w for w in self.WRITERS
                     if 'parsed.get("items") or []' in (root / w).read_text()]
        assert offenders == [], f"expanding unfiltered items: {offenders}"

"""Gmail query builder — sender and subject filters OR'd together."""
from app.email_import.gmail_query import build_gmail_query


class TestSenderOnly:
    def test_single_sender_needs_no_grouping(self):
        assert build_gmail_query(["hdfc"], 7) == "from:hdfc newer_than:7d"

    def test_multiple_senders_are_grouped(self):
        assert build_gmail_query(["hdfc", "icici"], 7) == "{from:hdfc OR from:icici} newer_than:7d"

    def test_last_run_replaces_the_day_window(self):
        q = build_gmail_query(["hdfc"], 7, "2026-07-15T10:30:00Z")
        assert q.startswith("from:hdfc after:")
        assert "newer_than" not in q


class TestSubject:
    def test_subject_only(self):
        assert build_gmail_query([], 7, None, ["transaction alert"]) == \
            'subject:"transaction alert" newer_than:7d'

    def test_subject_is_ored_with_sender_not_anded(self):
        # A forwarded alert carries the forwarder's address, so requiring both
        # would never match it.
        q = build_gmail_query(["hdfc"], 7, None, ["debited"])
        assert q == '{from:hdfc OR subject:"debited"} newer_than:7d'

    def test_multi_word_subjects_stay_one_term(self):
        q = build_gmail_query([], 7, None, ["your order from"])
        assert 'subject:"your order from"' in q

    def test_embedded_quotes_cannot_break_the_query(self):
        q = build_gmail_query([], 7, None, ['say "hi"'])
        assert q == 'subject:"say hi" newer_than:7d'

    def test_blank_entries_are_dropped(self):
        q = build_gmail_query(["hdfc"], 7, None, ["", "   "])
        assert q == "from:hdfc newer_than:7d"

    def test_several_of_each(self):
        q = build_gmail_query(["hdfc", "icici"], 7, None, ["debited", "order"])
        assert q == '{from:hdfc OR from:icici OR subject:"debited" OR subject:"order"} newer_than:7d'


class TestBackwardCompatibility:
    def test_omitting_subject_matches_the_ported_output(self):
        assert build_gmail_query(["a", "b"], 3) == build_gmail_query(["a", "b"], 3, None, [])
        assert build_gmail_query(["a"], 3) == build_gmail_query(["a"], 3, None, None)

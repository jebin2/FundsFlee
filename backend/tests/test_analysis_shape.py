"""The AI's answer, forced into the shape the UI renders.

The prompt asks for a list of sentences. The model returned a list of objects —
{"insight": ..., "detail": ...} — and React refused to render one, which took
out the whole analysis tab with "Something went wrong" (error #31: objects are
not valid as a React child).
"""
import pytest

from app.ai import analysis_shape as shape


class TestTheCaseThatBrokeIt:
    def test_an_object_becomes_a_sentence(self):
        assert shape.insights([{"insight": "You spent a lot on food",
                                "detail": "42% of the total"}]) \
            == ["You spent a lot on food — 42% of the total"]

    def test_nothing_the_model_said_is_dropped(self):
        # An unexpected key still reaches the reader rather than vanishing.
        assert shape.insights([{"insight": "Food is high", "trend": "rising"}]) \
            == ["Food is high — rising"]

    def test_the_headline_comes_before_the_elaboration(self):
        assert shape.insights([{"detail": "second", "insight": "first"}]) \
            == ["first — second"]


class TestOrdinaryAnswers:
    def test_strings_pass_through(self):
        assert shape.insights(["one", "two"]) == ["one", "two"]

    def test_blank_entries_are_dropped(self):
        assert shape.insights(["one", "", None, "  "]) == ["one"]

    def test_a_bare_string_becomes_a_list(self):
        assert shape.insights("just one") == ["just one"]

    def test_nothing_at_all(self):
        assert shape.insights(None) == []
        assert shape.insights([]) == []

    def test_a_nested_list_is_flattened_into_text(self):
        assert shape.insights([["a", "b"]]) == ["a b"]

    def test_a_number_is_not_dropped(self):
        assert shape.insights([42]) == ["42"]


class TestTips:
    def test_a_well_formed_tip_survives(self):
        tip = shape.tips([{"title": "Cook", "description": "Eat in",
                           "potential_saving": 2000, "effort": "low",
                           "quality_impact": "minimal"}])[0]
        assert tip == {"title": "Cook", "description": "Eat in",
                       "potential_saving": 2000, "effort": "low",
                       "quality_impact": "minimal"}

    def test_a_string_tip_becomes_a_titled_one(self):
        assert shape.tips(["Cook at home"])[0]["title"] == "Cook at home"

    def test_every_field_the_ui_reads_is_present(self):
        # formatINR(undefined) rendered "Save NaN/mo".
        tip = shape.tips(["Cook at home"])[0]
        assert set(tip) == {"title", "description", "potential_saving",
                            "effort", "quality_impact"}
        assert tip["potential_saving"] == 0

    def test_a_saving_written_as_text_is_parsed(self):
        assert shape.tips([{"title": "x", "potential_saving": "₹1,200"}])[0][
            "potential_saving"] == 1200

    def test_an_unparseable_saving_is_zero_not_nan(self):
        assert shape.tips([{"title": "x", "potential_saving": "lots"}])[0][
            "potential_saving"] == 0

    def test_an_empty_tip_is_dropped(self):
        assert shape.tips([{}, {"potential_saving": 5}]) == []

    def test_a_description_only_tip_is_promoted_to_a_title(self):
        tip = shape.tips([{"description": "Cook at home"}])[0]
        assert tip["title"] == "Cook at home" and tip["description"] == ""


class TestAWholePayload:
    def test_it_fixes_both_lists_and_keeps_the_rest(self):
        out = shape.normalise({
            "period": "August 2026", "total_spent": 4200,
            "by_category": [{"category": "Food", "amount": 1800}],
            "ai_insights": [{"insight": "A", "detail": "B"}],
            "optimization_tips": ["Cook"],
        })
        assert out["period"] == "August 2026"
        assert out["total_spent"] == 4200
        assert out["by_category"] == [{"category": "Food", "amount": 1800}]
        assert out["ai_insights"] == ["A — B"]
        assert out["optimization_tips"][0]["title"] == "Cook"

    def test_missing_lists_become_empty_ones(self):
        out = shape.normalise({"period": "x"})
        assert out["ai_insights"] == [] and out["optimization_tips"] == []

    def test_a_non_dict_is_left_alone(self):
        assert shape.normalise("nonsense") == "nonsense"

    def test_it_is_idempotent(self):
        once = shape.normalise({"ai_insights": [{"insight": "A", "detail": "B"}],
                                "optimization_tips": ["Cook"]})
        assert shape.normalise(once) == once


class TestACachedRowWrittenBeforeThisExisted:
    """The three rows already in analysis_cache hold the broken shape. They are
    served from cache, so fixing only generation would leave the tab crashing
    until each period was regenerated."""

    def test_a_cached_analysis_is_normalised_on_read(self, monkeypatch, seed):
        import asyncio, json
        import app.services.analysis_service as service
        from app.core.deps import SheetSession

        broken = json.dumps({
            "period": "August 2026", "period_type": "month", "total_spent": 4200,
            "by_category": [],
            "ai_insights": [{"insight": "You spent a lot on food",
                             "detail": "42% of the total"}],
            "optimization_tips": [],
        })

        async def cached(*a, **kw):
            return {"status": "done", "summary_json": broken,
                    "generated_at": "2026-08-01T00:00:00Z"}
        monkeypatch.setattr(service, "get_analysis_cache", cached)

        session = SheetSession(access_token="tok", refresh_token="r",
                               sheet_id="sheet", user_email="u@example.com")
        result = asyncio.run(service.get_analysis_status(session, "month"))
        assert result["analysis"]["ai_insights"] == [
            "You spent a lot on food — 42% of the total"]

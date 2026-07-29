"""Provider chain — order, and skipping providers we have no key for.

A live run showed every AI call burning a doomed round-trip against claude and
gemini (both holding stale keys) before reaching opencode. Roughly a second per
call, and the real failure was buried under 401s.
"""
import pytest

import app.ai.provider_chain as pc


@pytest.fixture
def chain(monkeypatch):
    def configure(primary="opencode", anthropic="", gemini=""):
        monkeypatch.setattr(pc, "PRIMARY", primary)
        monkeypatch.setattr(pc.settings, "anthropic_api_key", anthropic)
        monkeypatch.setattr(pc.settings, "gemini_api_key", gemini)
        return [name for name, _ in pc.text_chain()]

    return configure


class TestOrder:
    def test_the_configured_provider_goes_first(self, chain):
        assert chain("opencode", "k", "k")[0] == "opencode"
        assert chain("gemini", "k", "k")[0] == "gemini"
        assert chain("claude", "k", "k")[0] == "claude"

    def test_the_others_remain_as_fallbacks(self, chain):
        assert sorted(chain("gemini", "k", "k")) == ["claude", "gemini", "opencode"]


class TestSkippingUnconfigured:
    def test_a_provider_without_a_key_is_not_attempted(self, chain):
        assert chain("opencode", anthropic="", gemini="") == ["opencode"]

    def test_only_the_missing_one_is_dropped(self, chain):
        assert chain("opencode", anthropic="k", gemini="") == ["opencode", "claude"]

    def test_opencode_needs_no_key(self, chain):
        # It authenticates by URL, so it is always eligible.
        assert "opencode" in chain("gemini", anthropic="", gemini="k")

    def test_the_primary_itself_can_be_skipped(self, chain):
        # AI_PROVIDER=gemini with no gemini key should not keep trying it.
        assert chain("gemini", anthropic="", gemini="") == ["opencode"]


class TestNamesMatchFunctions:
    def test_the_chain_carries_its_own_names(self, chain):
        # Names and functions used to live in two separate lists that could
        # drift, mislabelling which provider actually failed.
        pairs = pc.text_chain()
        assert all(isinstance(n, str) and callable(f) for n, f in pairs)

    def test_image_chain_matches_text_chain(self, monkeypatch):
        monkeypatch.setattr(pc, "PRIMARY", "opencode")
        monkeypatch.setattr(pc.settings, "anthropic_api_key", "k")
        monkeypatch.setattr(pc.settings, "gemini_api_key", "")
        assert [n for n, _ in pc.text_chain()] == [n for n, _ in pc.image_chain()]

"""Sheet tab headers.

The definitions live in app/db/registry, which is the single source of truth for
what a tab is. They are re-exported here because the name is where the rest of
the codebase looks for them, and because app/db must not depend on app/sheets.

Header names and order are LOAD-BEARING — they must stay in step with
transaction_schema.COLS, and the write range must cover all of them.
"""
from app.db.registry import (
    ANALYSIS_CACHE_HEADERS,
    CATEGORIES_HEADERS,
    EXPECTED_HEADERS,
    ITEM_SUGGESTIONS_HEADERS,
    META_HEADERS,
    PARSED_EMAILS_HEADERS,
)

__all__ = [
    "ANALYSIS_CACHE_HEADERS",
    "CATEGORIES_HEADERS",
    "EXPECTED_HEADERS",
    "ITEM_SUGGESTIONS_HEADERS",
    "META_HEADERS",
    "PARSED_EMAILS_HEADERS",
]

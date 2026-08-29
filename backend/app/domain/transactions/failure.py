"""Why a transaction is in "failed".

The status said a row failed and nothing said why, so the only place the cause
existed was a server log line the person looking at the row cannot read. Worse,
the UI guessed: any failed row was labelled a failed receipt, whatever its
source. This records the reason next to the row instead.

The text is written for the person who will read it in the app, not for a
stack trace. Anything unrecognised still falls back to the exception, because a
raw message the user can quote is far better than "something went wrong".
"""
from app.core.logger import log
from app.sheets import update_transaction_field

# Long enough for a real API message, short enough to sit in a sheet cell and
# in a list row without becoming the whole screen.
MAX_REASON = 300

# Matched against the lowercased exception text, in order — first hit wins, so
# the specific patterns come before the general ones.
_KNOWN: tuple[tuple[tuple[str, ...], str], ...] = (
    (("filenotfound", "file not found", "notfound"),
     "The receipt image is no longer in Google Drive — it looks like it was deleted."),
    (("insufficientfilepermissions", "permission"),
     "This app no longer has permission to read the receipt from Google Drive."),
    (("429", "rate limit", "ratelimit", "quota", "resource_exhausted"),
     "The AI service was rate-limited. Retry in a few minutes."),
    (("401", "403", "unauthorized", "api key", "api_key", "authentication"),
     "The AI service rejected the request — its API key looks missing or invalid."),
    (("timeout", "timed out", "deadline"),
     "The AI service took too long to respond."),
    (("could not extract file id",),
     "The stored receipt link is not a Google Drive file link."),
    (("no receipt_url", "receipt url not found"),
     "There is no receipt attached to this transaction."),
    (("no raw_input",),
     "There is no text on this transaction to parse."),
)


def reason_for(err: BaseException | str) -> str:
    """A sentence a person can act on, falling back to the raw message."""
    text = err if isinstance(err, str) else f"{type(err).__name__}: {err}"
    lowered = text.lower()
    for needles, message in _KNOWN:
        if any(n in lowered for n in needles):
            return message
    return text[:MAX_REASON]


async def mark_failed(access_token: str, sheet_id: str, tx_id: str,
                      err: BaseException | str) -> None:
    """Set status=failed and say why. Never raises: this runs on the way out of
    an already-failing path, and losing the original error to a bookkeeping
    error would be the worse outcome."""
    try:
        await update_transaction_field(access_token, sheet_id, tx_id, {
            "status": "failed",
            "failure_reason": reason_for(err),
        })
    except Exception as write_err:
        log.error("transactions", "could not record failure reason", write_err,
                  {"txId": tx_id})

"""HTTP helpers — port of src/lib/api-error.ts + the logging in withSession.ts.

In FastAPI the per-route try/catch of `withSession` is replaced by:
  - a logging middleware (main.py) that logs `METHOD /path {status, ms}`, and
  - the global exception handlers (main.py), which map a downstream Google 401
    to `{"error": "auth_expired"}` (401) and everything else to 500.
This module provides the Google-401 detection used by that handler.
"""


def is_google_auth_error(err: BaseException) -> bool:
    """True when a downstream Google API call rejected the token (HTTP 401).
    Mirrors isGoogleAuthError() in api-error.ts (status/code/cause/response==401)."""
    # googleapiclient.errors.HttpError (newer SDKs expose status_code)
    if getattr(err, "status_code", None) == 401:
        return True
    # httplib2 response carried on HttpError.resp
    resp = getattr(err, "resp", None)
    if resp is not None and getattr(resp, "status", None) in (401, "401"):
        return True
    # Nested cause / response shapes
    cause = getattr(err, "cause", None)
    if cause is not None and getattr(cause, "code", None) == 401:
        return True
    response = getattr(err, "response", None)
    if response is not None and getattr(response, "status_code", None) == 401:
        return True
    return False

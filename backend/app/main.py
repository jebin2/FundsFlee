import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.core.auth import google_auth
from app.core.http import is_google_auth_error
from app.core.logger import log
from app.routers import (
    analyze,
    auth,
    categories,
    compare,
    cron,
    duplicates,
    email,
    items,
    parse,
    push,
    receipts,
    share,
    sheet,
    shortcut,
    transactions,
    user,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.cron.scheduler import init_cron_scheduler, shutdown_cron_scheduler

    init_cron_scheduler()  # daily 12:00 IST jobs
    try:
        yield
    finally:
        shutdown_cron_scheduler()


app = FastAPI(title="FundsFlee API", version="1.0.0", lifespan=lifespan)


# Per API.md implementation note #1: every API request logs METHOD /path {status, ms}.
@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    t0 = time.time()
    path = request.url.path
    tracked = path.startswith("/api/") or path.startswith("/auth/")
    try:
        response = await call_next(request)
    except Exception:
        if tracked:
            log.error("api", f"{request.method} {path}", None, {"ms": int((time.time() - t0) * 1000)})
        raise
    if tracked:
        log.info("api", f"{request.method} {path}",
                 {"status": response.status_code, "ms": int((time.time() - t0) * 1000)})
    return response


# Error envelope per API.md: {"error": "<message>"} — not FastAPI's {"detail": ...}
@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=exc.headers)


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    # apiError() parity: a downstream Google 401 surfaces as auth_expired.
    if is_google_auth_error(exc):
        return JSONResponse({"error": "auth_expired"}, status_code=401)
    return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "service": "fundsflee-backend"}


app.include_router(google_auth.get_router())  # /auth/google/*, /auth/logout, /auth/me
app.include_router(auth.router)               # /auth/login alias, /api/auth/session
app.include_router(sheet.router)              # /api/sheet/init, /api/reset

# Phase 4 feature routers
app.include_router(transactions.router)
app.include_router(categories.router)
app.include_router(parse.router)
app.include_router(receipts.router)
app.include_router(duplicates.router)
app.include_router(analyze.router)
app.include_router(compare.router)
app.include_router(items.router)
app.include_router(email.router)
app.include_router(cron.router)
app.include_router(user.router)
app.include_router(shortcut.router)
app.include_router(push.router)
app.include_router(share.router)

# Single-origin deploy: serve the built SPA (registered LAST so it never shadows
# the routers above). No-op in dev when frontend/dist is absent.
from app.web import mount_spa  # noqa: E402

mount_spa(app)

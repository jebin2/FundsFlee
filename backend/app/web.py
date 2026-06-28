"""Single-origin SPA serving — FastAPI hosts the built frontend/dist.

Registered LAST so it never shadows the API/auth routers. Unknown non-API paths
fall back to index.html (client-side routing); real files (hashed assets, icons,
sw.js, manifest) are served directly with appropriate cache headers.
"""
import mimetypes
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.core.logger import log

mimetypes.add_type("application/manifest+json", ".webmanifest")

# Never cache the entry doc, the SW, or its registration — they gate every update.
_NO_CACHE = {"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}


def _dist_dir() -> Path:
    if settings.frontend_dist:
        return Path(settings.frontend_dist).expanduser().resolve()
    # backend/app/web.py -> repo root -> frontend/dist
    return (Path(__file__).resolve().parents[2] / "frontend" / "dist").resolve()


def _file_response(path: Path) -> FileResponse:
    if path.name in _NO_CACHE:
        cache = "no-cache"
    else:
        # Vite emits content-hashed asset/icon filenames — safe to cache forever.
        cache = "public, max-age=31536000, immutable"
    return FileResponse(path, headers={"Cache-Control": cache})


def mount_spa(app: FastAPI) -> None:
    dist = _dist_dir()
    index = dist / "index.html"
    if not index.is_file():
        log.warn("web", "frontend dist not found — SPA not served (dev mode)", {"dist": str(dist)})
        return

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str, _request: Request) -> FileResponse:
        # API/auth/health are real endpoints — an unmatched one is a genuine 404,
        # not an SPA route. Don't hand back index.html for them.
        if full_path.startswith(("api/", "auth/")) or full_path in ("healthz",):
            raise HTTPException(status_code=404, detail="Not found")

        candidate = (dist / full_path).resolve()
        # Path-traversal guard + only serve real files; everything else → SPA shell.
        if str(candidate).startswith(str(dist)) and candidate.is_file():
            return _file_response(candidate)
        return _file_response(index)

    log.info("web", "serving SPA", {"dist": str(dist)})

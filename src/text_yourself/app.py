from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import router
from .config import Settings
from .database import Database
from .errors import ApiError, install_error_handlers
from .identity import IdentityResolver
from .logging_config import configure_json_logging
from .repository import PostgresRepository
from .service import MessageService


logger = logging.getLogger(__name__)


def create_app(settings: Settings, injected_service: MessageService | None = None) -> FastAPI:
    _validate_web_dist(settings.web_dist_path)
    configure_json_logging()
    web_root = settings.web_dist_path.resolve()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if injected_service is not None:
            app.state.message_service = injected_service
            yield
            return

        database = Database(settings)
        await database.open()
        app.state.message_service = MessageService(PostgresRepository(database), settings)
        try:
            yield
        finally:
            await database.close()

    app = FastAPI(title="Text Yourself", version="1.0.0", lifespan=lifespan)
    app.state.identity_resolver = IdentityResolver(settings)
    install_error_handlers(app)
    app.include_router(router)

    assets_path = settings.web_dist_path / "assets"
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/healthz")
    async def health(request: Request) -> JSONResponse:
        try:
            healthy = _web_dist_healthy(settings.web_dist_path) and await request.app.state.message_service.healthcheck()
        except Exception:
            logger.exception("Health check failed")
            healthy = False
        status = 200 if healthy else 503
        return JSONResponse(status_code=status, content={"status": "ok" if healthy else "unhealthy"})

    @app.get("/{path:path}", response_class=FileResponse)
    async def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise ApiError(404, "not_found", "API route not found")
        candidate = (web_root / path).resolve()
        if candidate.is_relative_to(web_root) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(web_root / "index.html")

    return app


def _validate_web_dist(web_dist_path: Path) -> None:
    if not web_dist_path.is_dir():
        raise RuntimeError(f"WEB_DIST not found at {web_dist_path}")
    if not (web_dist_path / "index.html").is_file():
        raise RuntimeError(f"WEB_DIST index not found at {web_dist_path / 'index.html'}")
    if not (web_dist_path / "assets").is_dir():
        raise RuntimeError(f"WEB_DIST assets not found at {web_dist_path / 'assets'}")
    for filename in ("manifest.webmanifest", "sw.js"):
        if not (web_dist_path / filename).is_file():
            raise RuntimeError(f"WEB_DIST file not found at {web_dist_path / filename}")


def _web_dist_healthy(web_dist_path: Path) -> bool:
    required_files = ("index.html", "manifest.webmanifest", "sw.js")
    return (web_dist_path / "assets").is_dir() and all(
        (web_dist_path / filename).is_file() for filename in required_files
    )

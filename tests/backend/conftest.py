from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from text_yourself.app import create_app
from text_yourself.config import Settings
from text_yourself.service import MessageService

from .memory_repository import MemoryRepository


HOUSEHOLD_ID = UUID("00000000-0000-4000-8000-000000000001")
USER_ID = "user@example.com"
OTHER_USER_ID = "other@example.com"


@pytest.fixture
def web_dist(tmp_path: Path) -> Path:
    path = tmp_path / "web-dist"
    (path / "assets").mkdir(parents=True)
    (path / "index.html").write_text("<!doctype html><title>Text Yourself</title>")
    (path / "manifest.webmanifest").write_text('{"name":"Text Yourself"}')
    (path / "sw.js").write_text("// test service worker")
    return path


@pytest.fixture
def repository() -> MemoryRepository:
    return MemoryRepository()


def make_settings(web_dist: Path, *, proxy: bool = False) -> Settings:
    return Settings(
        database_url="postgresql://unused",
        household_id=HOUSEHOLD_ID,
        auth_mode="proxy" if proxy else "none",
        user_display_names={USER_ID: "Taylor", OTHER_USER_ID: "Morgan"},
        default_user_id=USER_ID,
        default_display_name="Taylor",
        default_role="editor",
        web_dist_path=web_dist,
    )


@pytest.fixture
def client(web_dist: Path, repository: MemoryRepository):
    settings = make_settings(web_dist)
    app = create_app(settings, MessageService(repository, settings))
    with TestClient(app) as test_client:
        yield test_client

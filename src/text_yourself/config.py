from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import UUID


AuthMode = Literal["none", "proxy"]


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    household_id: UUID
    auth_mode: AuthMode = "none"
    user_display_names: dict[str, str] | None = None
    default_user_id: str = "user@example.com"
    default_display_name: str = "You"
    default_role: str = "editor"
    web_dist_path: Path = Path("/app/web-dist")
    pool_min_size: int = 1
    pool_max_size: int = 5

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = _required("DATABASE_URL")
        household_id = UUID(_required("HOUSEHOLD_ID"))
        auth_mode = os.environ.get("AUTH_MODE", "none")
        if auth_mode not in {"none", "proxy"}:
            raise RuntimeError("AUTH_MODE must be 'none' or 'proxy'")

        names = _display_names(os.environ.get("USER_DISPLAY_NAMES", "{}"))
        default_role = os.environ.get("DEV_USER_ROLE", "editor")
        if default_role not in {"editor", "viewer"}:
            raise RuntimeError("DEV_USER_ROLE must be 'editor' or 'viewer'")

        pool_min_size = _positive_int("DB_POOL_MIN_SIZE", 1)
        pool_max_size = _positive_int("DB_POOL_MAX_SIZE", 5)
        if pool_min_size > pool_max_size:
            raise RuntimeError("DB_POOL_MIN_SIZE cannot exceed DB_POOL_MAX_SIZE")

        return cls(
            database_url=database_url,
            household_id=household_id,
            auth_mode=auth_mode,
            user_display_names=names,
            default_user_id=os.environ.get("DEV_USER_ID", "user@example.com"),
            default_display_name=os.environ.get("DEV_USER_DISPLAY_NAME", "You"),
            default_role=default_role,
            web_dist_path=Path(os.environ.get("WEB_DIST_PATH", "/app/web-dist")),
            pool_min_size=pool_min_size,
            pool_max_size=pool_max_size,
        )


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _display_names(raw: str) -> dict[str, str]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("USER_DISPLAY_NAMES must be a JSON object") from exc
    if not isinstance(value, dict):
        raise RuntimeError("USER_DISPLAY_NAMES must be a JSON object")
    if not all(isinstance(key, str) and isinstance(label, str) and label for key, label in value.items()):
        raise RuntimeError("USER_DISPLAY_NAMES values must be non-empty strings")
    return value


def _positive_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value < 1:
        raise RuntimeError(f"{name} must be positive")
    return value

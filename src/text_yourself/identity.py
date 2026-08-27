from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from fastapi import Request

from .config import Settings
from .errors import ApiError


Role = Literal["editor", "viewer"]


@dataclass(frozen=True, slots=True)
class Identity:
    user_id: str
    display_name: str
    role: Role


class IdentityResolver:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def resolve(self, request: Request) -> Identity:
        if self._settings.auth_mode == "none":
            return Identity(
                user_id=self._settings.default_user_id,
                display_name=self._settings.default_display_name,
                role=self._settings.default_role,  # type: ignore[arg-type]
            )

        user_id = request.headers.get("x-auth-user")
        role = request.headers.get("x-auth-role")
        names = self._settings.user_display_names or {}
        if not user_id or user_id not in names:
            raise ApiError(403, "forbidden", "Unknown user")
        if role not in {"editor", "viewer"}:
            raise ApiError(403, "forbidden", "Unknown role")
        return Identity(user_id=user_id, display_name=names[user_id], role=role)  # type: ignore[arg-type]


def require_editor(identity: Identity) -> None:
    if identity.role != "editor":
        raise ApiError(403, "read_only", "This action requires the editor role")

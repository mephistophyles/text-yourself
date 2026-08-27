from __future__ import annotations

import base64
import json
from datetime import datetime
from uuid import UUID

from .errors import ApiError


def encode_cursor(*parts: object) -> str:
    values = [value.isoformat() if isinstance(value, datetime) else str(value) for value in parts]
    return base64.urlsafe_b64encode(json.dumps(values).encode()).decode().rstrip("=")


def decode_time_uuid(cursor: str) -> tuple[datetime, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        values = json.loads(raw)
        return datetime.fromisoformat(values[0]), UUID(values[1])
    except (ValueError, TypeError, IndexError, json.JSONDecodeError) as exc:
        raise ApiError(400, "invalid_cursor", "The cursor is invalid") from exc


def decode_int(cursor: str) -> int:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        values = json.loads(raw)
        return int(values[0])
    except (ValueError, TypeError, IndexError, json.JSONDecodeError) as exc:
        raise ApiError(400, "invalid_cursor", "The cursor is invalid") from exc

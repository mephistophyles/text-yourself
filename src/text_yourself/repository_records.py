from __future__ import annotations

from .cursors import encode_cursor
from .repository_base import Record


def message_columns() -> str:
    return """id, topic_id, author_id,
              CASE WHEN deleted_at IS NULL THEN body ELSE NULL END AS body,
              reply_to_id, created_at, updated_at, edited_at, deleted_at, sync_version"""


def time_page(
    rows: list[Record], limit: int, timestamp_field: str
) -> tuple[list[Record], str | None, bool]:
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1][timestamp_field], page[-1]["id"]) if has_more else None
    return page, next_cursor, has_more

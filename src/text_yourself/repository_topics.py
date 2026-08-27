from __future__ import annotations

from typing import Literal
from uuid import UUID

from .cursors import decode_time_uuid
from .identity import Identity
from .repository_base import Record, RepositoryBase
from .repository_records import time_page


class TopicRepository(RepositoryBase):
    async def create_topic(self, identity: Identity, topic_id: UUID, title: str) -> tuple[Record, bool]:
        async with self._database.transaction(identity) as connection:
            cursor = await connection.execute(
                """
                INSERT INTO topics (id, household_id, created_by, title)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                RETURNING id, created_by, title, archived_at, created_at, updated_at, sync_version
                """,
                (topic_id, self._database.household_id, identity.user_id, title),
            )
            row = await cursor.fetchone()
            if row:
                return row, True
            existing = await connection.execute(
                """SELECT id, created_by, title, archived_at, created_at, updated_at, sync_version
                   FROM topics WHERE id = %s""",
                (topic_id,),
            )
            return await existing.fetchone(), False

    async def patch_topic(
        self, identity: Identity, topic_id: UUID, title: str | None, archived: bool | None
    ) -> Record | None:
        async with self._database.transaction(identity) as connection:
            cursor = await connection.execute(
                """
                UPDATE topics
                   SET title = COALESCE(%s, title),
                       archived_at = CASE
                         WHEN %s IS NULL THEN archived_at
                         WHEN %s THEN COALESCE(archived_at, now())
                         ELSE NULL
                       END
                 WHERE id = %s
                RETURNING id, created_by, title, archived_at, created_at, updated_at, sync_version
                """,
                (title, archived, archived, topic_id),
            )
            return await cursor.fetchone()

    async def list_topics(
        self,
        identity: Identity,
        archived: Literal["active", "archived", "all"],
        cursor: str | None,
        limit: int,
    ) -> tuple[list[Record], str | None, bool]:
        cursor_time, cursor_id = decode_time_uuid(cursor) if cursor else (None, None)
        filters = {
            "active": "archived_at IS NULL",
            "archived": "archived_at IS NOT NULL",
            "all": "TRUE",
        }
        async with self._database.transaction(identity) as connection:
            result = await connection.execute(
                f"""
                SELECT id, created_by, title, archived_at, created_at, updated_at, sync_version
                  FROM topics
                 WHERE {filters[archived]}
                   AND (%s::timestamptz IS NULL OR (updated_at, id) < (%s, %s))
                 ORDER BY updated_at DESC, id DESC
                 LIMIT %s
                """,
                (cursor_time, cursor_time, cursor_id, limit + 1),
            )
            rows = await result.fetchall()
        return time_page(rows, limit, "updated_at")

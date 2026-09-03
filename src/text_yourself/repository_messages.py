from __future__ import annotations

from uuid import UUID

from .cursors import decode_time_uuid
from .identity import Identity
from .repository_base import Record, RepositoryBase
from .repository_records import message_columns, time_page


class MessageRepository(RepositoryBase):
    async def create_message(
        self,
        identity: Identity,
        message_id: UUID,
        topic_id: UUID,
        body: str,
        reply_to_id: UUID | None,
        has_voice_note: bool = False,
    ) -> tuple[Record | None, bool]:
        async with self._database.transaction(identity) as connection:
            cursor = await connection.execute(
                """
                INSERT INTO messages
                    (id, household_id, topic_id, author_id, body, reply_to_id, has_voice_note)
                SELECT %s, %s, id, %s, %s, %s, %s FROM topics WHERE id = %s
                ON CONFLICT (id) DO NOTHING
                RETURNING id, topic_id, author_id,
                          CASE WHEN deleted_at IS NULL THEN body ELSE NULL END AS body,
                          reply_to_id, created_at, updated_at, edited_at, deleted_at, sync_version,
                          has_voice_note
                """,
                (
                    message_id,
                    self._database.household_id,
                    identity.user_id,
                    body,
                    reply_to_id,
                    has_voice_note,
                    topic_id,
                ),
            )
            row = await cursor.fetchone()
            if row:
                await connection.execute("UPDATE topics SET updated_at = now() WHERE id = %s", (topic_id,))
                return row, True
            existing = await connection.execute(
                f"SELECT {message_columns()} FROM messages WHERE id = %s", (message_id,)
            )
            return await existing.fetchone(), False

    async def list_messages(
        self, identity: Identity, topic_id: UUID, cursor: str | None, limit: int
    ) -> tuple[list[Record], str | None, bool] | None:
        cursor_time, cursor_id = decode_time_uuid(cursor) if cursor else (None, None)
        async with self._database.transaction(identity) as connection:
            topic = await connection.execute("SELECT 1 FROM topics WHERE id = %s", (topic_id,))
            if not await topic.fetchone():
                return None
            result = await connection.execute(
                f"""
                SELECT {message_columns()}
                  FROM messages
                 WHERE topic_id = %s
                   AND (%s::timestamptz IS NULL OR (created_at, id) > (%s, %s))
                 ORDER BY created_at, id
                 LIMIT %s
                """,
                (topic_id, cursor_time, cursor_time, cursor_id, limit + 1),
            )
            rows = await result.fetchall()
        return time_page(rows, limit, "created_at")

    async def message_state(self, identity: Identity, message_id: UUID) -> Record | None:
        async with self._database.transaction(identity) as connection:
            cursor = await connection.execute(
                """SELECT id, author_id, topic_id, reply_to_id, deleted_at, has_voice_note
                     FROM messages WHERE id = %s""",
                (message_id,),
            )
            return await cursor.fetchone()

    async def edit_message(self, identity: Identity, message_id: UUID, body: str) -> Record | None:
        async with self._database.transaction(identity) as connection:
            cursor = await connection.execute(
                f"""
                UPDATE messages SET body = %s, edited_at = now()
                 WHERE id = %s AND author_id = %s AND deleted_at IS NULL
                RETURNING {message_columns()}
                """,
                (body, message_id, identity.user_id),
            )
            return await cursor.fetchone()

    async def delete_message(self, identity: Identity, message_id: UUID) -> Record | None:
        async with self._database.transaction(identity) as connection:
            cursor = await connection.execute(
                f"""
                UPDATE messages SET deleted_at = COALESCE(deleted_at, now())
                 WHERE id = %s AND author_id = %s
                RETURNING {message_columns()}
                """,
                (message_id, identity.user_id),
            )
            return await cursor.fetchone()

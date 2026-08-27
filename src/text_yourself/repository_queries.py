from __future__ import annotations

from .cursors import decode_int, encode_cursor
from .identity import Identity
from .repository_base import Record, RepositoryBase
from .repository_records import message_columns


class QueryRepository(RepositoryBase):
    async def sync(
        self, identity: Identity, after: int, limit: int
    ) -> tuple[list[tuple[str, Record]], int, bool]:
        fetch_limit = limit + 1
        async with self._database.transaction(identity) as connection:
            topics_result = await connection.execute(
                """SELECT id, created_by, title, archived_at, created_at, updated_at, sync_version
                     FROM topics WHERE sync_version > %s ORDER BY sync_version LIMIT %s""",
                (after, fetch_limit),
            )
            messages_result = await connection.execute(
                f"""SELECT {message_columns()} FROM messages
                     WHERE sync_version > %s ORDER BY sync_version LIMIT %s""",
                (after, fetch_limit),
            )
            topic_rows = await topics_result.fetchall()
            message_rows = await messages_result.fetchall()
        merged = [("topic", row) for row in topic_rows] + [("message", row) for row in message_rows]
        merged.sort(key=lambda item: item[1]["sync_version"])
        has_more = len(merged) > limit
        page = merged[:limit]
        next_version = page[-1][1]["sync_version"] if page else after
        return page, next_version, has_more

    async def search(
        self, identity: Identity, query: str, cursor: str | None, limit: int
    ) -> tuple[list[Record], str | None, bool]:
        before = decode_int(cursor) if cursor else 9223372036854775807
        pattern = f"%{query}%"
        async with self._database.transaction(identity) as connection:
            result = await connection.execute(
                """
                SELECT * FROM (
                    SELECT 'topic'::text AS kind, id AS topic_id, NULL::uuid AS message_id,
                           title AS topic_title, title AS excerpt, NULL::text AS author_id,
                           created_at, sync_version
                      FROM topics
                     WHERE sync_version < %s
                       AND (to_tsvector('simple', title) @@ plainto_tsquery('simple', %s)
                            OR title ILIKE %s)
                    UNION ALL
                    SELECT 'message'::text AS kind, m.topic_id, m.id AS message_id,
                           t.title AS topic_title, left(m.body, 240) AS excerpt, m.author_id,
                           m.created_at, m.sync_version
                      FROM messages m JOIN topics t ON t.id = m.topic_id
                     WHERE m.sync_version < %s AND m.deleted_at IS NULL
                       AND (to_tsvector('simple', m.body) @@ plainto_tsquery('simple', %s)
                            OR m.body ILIKE %s)
                ) matches
                ORDER BY sync_version DESC
                LIMIT %s
                """,
                (before, query, pattern, before, query, pattern, limit + 1),
            )
            rows = await result.fetchall()
        has_more = len(rows) > limit
        page = rows[:limit]
        next_cursor = encode_cursor(page[-1]["sync_version"]) if has_more else None
        return page, next_cursor, has_more

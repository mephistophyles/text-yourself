from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from text_yourself.cursors import decode_int, encode_cursor


class MemoryRepository:
    def __init__(self) -> None:
        self.topics: dict[UUID, dict] = {}
        self.messages: dict[UUID, dict] = {}
        self.version = 0
        self.clock = datetime(2026, 1, 1, tzinfo=UTC)

    async def healthcheck(self) -> bool:
        return True

    def _tick(self) -> tuple[datetime, int]:
        self.clock += timedelta(seconds=1)
        self.version += 1
        return self.clock, self.version

    async def create_topic(self, identity, topic_id, title):
        if topic_id in self.topics:
            return dict(self.topics[topic_id]), False
        timestamp, version = self._tick()
        row = {
            "id": topic_id, "created_by": identity.user_id, "title": title,
            "archived_at": None, "created_at": timestamp, "updated_at": timestamp,
            "sync_version": version,
        }
        self.topics[topic_id] = row
        return dict(row), True

    async def patch_topic(self, identity, topic_id, title, archived):
        row = self.topics.get(topic_id)
        if not row:
            return None
        timestamp, version = self._tick()
        if title is not None:
            row["title"] = title
        if archived is not None:
            row["archived_at"] = timestamp if archived else None
        row.update(updated_at=timestamp, sync_version=version)
        return dict(row)

    async def list_topics(self, identity, archived, cursor, limit):
        rows = list(self.topics.values())
        if archived == "active":
            rows = [row for row in rows if row["archived_at"] is None]
        if archived == "archived":
            rows = [row for row in rows if row["archived_at"] is not None]
        rows.sort(key=lambda row: (row["updated_at"], row["id"]), reverse=True)
        return [dict(row) for row in rows[:limit]], None, len(rows) > limit

    async def create_message(self, identity, message_id, topic_id, body, reply_to_id, voice_note_base64: str | None = None):
        if message_id in self.messages:
            return self._safe_message(self.messages[message_id]), False
        if topic_id not in self.topics:
            return None, False
        timestamp, version = self._tick()
        row = {
            "id": message_id, "topic_id": topic_id, "author_id": identity.user_id,
            "body": body, "reply_to_id": reply_to_id, "created_at": timestamp,
            "updated_at": timestamp, "edited_at": None, "deleted_at": None,
            "sync_version": version,
            "voice_note_base64": voice_note_base64,
        }
        self.messages[message_id] = row
        return dict(row), True

    async def list_messages(self, identity, topic_id, cursor, limit):
        if topic_id not in self.topics:
            return None
        rows = [row for row in self.messages.values() if row["topic_id"] == topic_id]
        rows.sort(key=lambda row: (row["created_at"], row["id"]))
        return [self._safe_message(row) for row in rows[:limit]], None, len(rows) > limit

    async def message_state(self, identity, message_id):
        row = self.messages.get(message_id)
        return dict(row) if row else None

    async def edit_message(self, identity, message_id, body):
        row = self.messages.get(message_id)
        if not row or row["author_id"] != identity.user_id or row["deleted_at"]:
            return None
        timestamp, version = self._tick()
        row.update(body=body, edited_at=timestamp, updated_at=timestamp, sync_version=version)
        return self._safe_message(row)

    async def delete_message(self, identity, message_id):
        row = self.messages.get(message_id)
        if not row or row["author_id"] != identity.user_id:
            return None
        if row["deleted_at"] is None:
            timestamp, version = self._tick()
            row.update(deleted_at=timestamp, updated_at=timestamp, sync_version=version)
        return self._safe_message(row)

    async def sync(self, identity, after, limit):
        changes = [("topic", dict(row)) for row in self.topics.values()]
        changes += [("message", self._safe_message(row)) for row in self.messages.values()]
        changes = [item for item in changes if item[1]["sync_version"] > after]
        changes.sort(key=lambda item: item[1]["sync_version"])
        page = changes[:limit]
        next_version = page[-1][1]["sync_version"] if page else after
        return page, next_version, len(changes) > limit

    async def search(self, identity, query, cursor, limit):
        before = decode_int(cursor) if cursor else 2**63 - 1
        lowered = query.lower()
        rows = self._topic_hits(lowered, before) + self._message_hits(lowered, before)
        rows.sort(key=lambda row: row["sync_version"], reverse=True)
        page = rows[:limit]
        next_cursor = encode_cursor(page[-1]["sync_version"]) if len(rows) > limit else None
        return page, next_cursor, len(rows) > limit

    def _topic_hits(self, query, before):
        return [
            {"kind": "topic", "topic_id": row["id"], "message_id": None,
             "topic_title": row["title"], "excerpt": row["title"],
             "created_at": row["created_at"], "sync_version": row["sync_version"]}
            for row in self.topics.values()
            if row["sync_version"] < before and query in row["title"].lower()
        ]

    def _message_hits(self, query, before):
        return [
            {"kind": "message", "topic_id": row["topic_id"], "message_id": row["id"],
             "topic_title": self.topics[row["topic_id"]]["title"], "excerpt": row["body"][:240],
             "created_at": row["created_at"], "sync_version": row["sync_version"]}
            for row in self.messages.values()
            if row["deleted_at"] is None and row["sync_version"] < before
            and query in row["body"].lower()
        ]

    @staticmethod
    def _safe_message(row):
        result = dict(row)
        if result["deleted_at"]:
            result["body"] = None
        return result

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from .config import Settings
from .errors import ApiError
from .identity import Identity, require_editor
from .models import VOICE_NOTE_MIME_TYPES, Message, SearchResult, Topic


class MessageService:
    def __init__(self, repository: Any, settings: Settings) -> None:
        self._repository = repository
        self._display_names = settings.user_display_names or {}
        self._default_identity = settings.default_user_id
        self._default_display = settings.default_display_name
        self._voice_note_max_bytes = settings.voice_note_max_bytes

    @property
    def voice_note_max_bytes(self) -> int:
        return self._voice_note_max_bytes

    async def healthcheck(self) -> bool:
        return await self._repository.healthcheck()

    async def create_topic(self, identity: Identity, topic_id: UUID, title: str) -> Topic:
        require_editor(identity)
        row, _created = await self._repository.create_topic(identity, topic_id, title)
        if not row or row["created_by"] != identity.user_id or row["title"] != title:
            raise ApiError(409, "id_conflict", "That topic ID is already in use")
        return self._topic(row)

    async def patch_topic(
        self, identity: Identity, topic_id: UUID, title: str | None, archived: bool | None
    ) -> Topic:
        require_editor(identity)
        if title is None and archived is None:
            raise ApiError(422, "invalid_request", "Provide a title or archived state")
        row = await self._repository.patch_topic(identity, topic_id, title, archived)
        if not row:
            raise ApiError(404, "topic_not_found", "Topic not found")
        return self._topic(row)

    async def list_topics(
        self,
        identity: Identity,
        archived: Literal["active", "archived", "all"],
        cursor: str | None,
        limit: int,
    ) -> dict[str, object]:
        rows, next_cursor, has_more = await self._repository.list_topics(
            identity, archived, cursor, limit
        )
        return {
            "items": [self._topic(row) for row in rows],
            "next_cursor": next_cursor,
            "has_more": has_more,
        }

    async def create_message(
        self,
        identity: Identity,
        topic_id: UUID,
        message_id: UUID,
        body: str,
        reply_to_id: UUID | None,
        has_voice_note: bool = False,
    ) -> Message:
        require_editor(identity)
        if reply_to_id:
            reply = await self._repository.message_state(identity, reply_to_id)
            if not reply or reply["topic_id"] != topic_id:
                raise ApiError(422, "invalid_reply", "Reply target is not in this topic")
        row, _created = await self._repository.create_message(
            identity, message_id, topic_id, body, reply_to_id, has_voice_note
        )
        if not row:
            raise ApiError(404, "topic_not_found", "Topic not found")
        if (
            row["author_id"] != identity.user_id
            or row["topic_id"] != topic_id
            or row["reply_to_id"] != reply_to_id
            or row["body"] != body
            or bool(row["has_voice_note"]) != has_voice_note
        ):
            raise ApiError(409, "id_conflict", "That message ID is already in use")
        return self._message(row)

    async def list_messages(
        self, identity: Identity, topic_id: UUID, cursor: str | None, limit: int
    ) -> dict[str, object]:
        page = await self._repository.list_messages(identity, topic_id, cursor, limit)
        if page is None:
            raise ApiError(404, "topic_not_found", "Topic not found")
        rows, next_cursor, has_more = page
        return {
            "items": [self._message(row) for row in rows],
            "next_cursor": next_cursor,
            "has_more": has_more,
        }

    async def edit_message(
        self, identity: Identity, message_id: UUID, body: str
    ) -> Message:
        require_editor(identity)
        state = await self._require_author(identity, message_id, allow_deleted=False)
        if not body and not state["has_voice_note"]:
            raise ApiError(422, "invalid_request", "A message needs a body or a voice note")
        row = await self._repository.edit_message(identity, message_id, body)
        if not row:
            raise ApiError(409, "message_changed", "Message changed before it could be edited")
        return self._message(row)

    async def delete_message(self, identity: Identity, message_id: UUID) -> Message:
        require_editor(identity)
        await self._require_author(identity, message_id, allow_deleted=True)
        row = await self._repository.delete_message(identity, message_id)
        if not row:
            raise ApiError(409, "message_changed", "Message changed before it could be deleted")
        return self._message(row)

    async def sync(self, identity: Identity, after: int, limit: int) -> dict[str, object]:
        rows, next_version, has_more = await self._repository.sync(identity, after, limit)
        changes = []
        for kind, row in rows:
            entity = self._topic(row) if kind == "topic" else self._message(row)
            changes.append({"kind": kind, "data": entity})
        return {"changes": changes, "next_version": next_version, "has_more": has_more}

    async def search(
        self, identity: Identity, query: str, cursor: str | None, limit: int
    ) -> dict[str, object]:
        normalized = query.strip()
        if not normalized:
            raise ApiError(422, "invalid_request", "Search query cannot be empty")
        rows, next_cursor, has_more = await self._repository.search(
            identity, normalized, cursor, limit
        )
        results = []
        for row in rows:
            results.append(SearchResult.model_validate(row))
        return {"results": results, "next_cursor": next_cursor, "has_more": has_more}

    async def attach_voice_note(
        self, identity: Identity, message_id: UUID, mime_type: str, audio: bytes
    ) -> Message:
        require_editor(identity)
        if mime_type not in VOICE_NOTE_MIME_TYPES:
            raise ApiError(
                415,
                "unsupported_media_type",
                f"A voice note must be one of {', '.join(VOICE_NOTE_MIME_TYPES)}",
            )
        if not audio:
            raise ApiError(422, "invalid_request", "A voice note cannot be empty")
        if len(audio) > self._voice_note_max_bytes:
            raise ApiError(
                413,
                "voice_note_too_large",
                f"A voice note cannot exceed {self._voice_note_max_bytes} bytes",
            )
        await self._require_author(identity, message_id, allow_deleted=False)
        row, _created = await self._repository.attach_voice_note(
            identity, message_id, mime_type, audio
        )
        if not row:
            raise ApiError(404, "message_not_found", "Message not found")
        return self._message(row)

    async def voice_note(self, identity: Identity, message_id: UUID) -> tuple[str, bytes]:
        row = await self._repository.voice_note(identity, message_id)
        if not row:
            raise ApiError(404, "voice_note_not_found", "This message has no voice note")
        return row["mime_type"], bytes(row["audio"])

    async def _require_author(
        self, identity: Identity, message_id: UUID, allow_deleted: bool
    ) -> dict[str, Any]:
        state = await self._repository.message_state(identity, message_id)
        if not state:
            raise ApiError(404, "message_not_found", "Message not found")
        if state["author_id"] != identity.user_id:
            raise ApiError(403, "not_author", "Only the author can change this message")
        if state["deleted_at"] and not allow_deleted:
            raise ApiError(409, "message_deleted", "A deleted message cannot be edited")
        return state

    def _message(self, row: dict[str, Any]) -> Message:
        safe_row = dict(row)
        if safe_row["deleted_at"] is not None:
            safe_row["body"] = None
        safe_row["author_display_name"] = self._display_name(safe_row["author_id"])
        return Message.model_validate(safe_row)

    def _topic(self, row: dict[str, Any]) -> Topic:
        enriched = dict(row)
        enriched["creator_display_name"] = self._display_name(enriched["created_by"])
        return Topic.model_validate(enriched)

    def _display_name(self, user_id: str) -> str:
        if user_id in self._display_names:
            return self._display_names[user_id]
        if user_id == self._default_identity:
            return self._default_display
        return user_id

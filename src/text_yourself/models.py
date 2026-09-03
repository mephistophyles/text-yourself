from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator


TopicTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
MessageBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]
# A voice note can stand on its own, so a message carrying one may have no text.
OptionalMessageBody = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20_000)]

VOICE_NOTE_MIME_TYPES = ("audio/webm", "audio/ogg", "audio/mp4")


class MeResponse(BaseModel):
    user_id: str
    display_name: str
    role: Literal["editor", "viewer"]


class TopicCreate(BaseModel):
    id: UUID
    title: TopicTitle


class TopicPatch(BaseModel):
    title: TopicTitle | None = None
    archived: bool | None = None


class Topic(BaseModel):
    id: UUID
    created_by: str
    creator_display_name: str
    title: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    sync_version: int


class MessageCreate(BaseModel):
    id: UUID
    body: OptionalMessageBody
    reply_to_id: UUID | None = None
    has_voice_note: bool = False

    @model_validator(mode="after")
    def _body_or_voice_note(self) -> "MessageCreate":
        if not self.body and not self.has_voice_note:
            raise ValueError("A message needs a body or a voice note")
        return self


class MessagePatch(BaseModel):
    # Emptiness is checked against the message's voice note in the service.
    body: OptionalMessageBody


class Message(BaseModel):
    id: UUID
    topic_id: UUID
    author_id: str
    author_display_name: str
    body: str | None
    reply_to_id: UUID | None
    created_at: datetime
    updated_at: datetime
    edited_at: datetime | None
    deleted_at: datetime | None
    sync_version: int
    has_voice_note: bool = False


class SyncChange(BaseModel):
    kind: Literal["topic", "message"]
    data: Topic | Message


class SyncResponse(BaseModel):
    changes: list[SyncChange]
    next_version: int
    has_more: bool


class Page(BaseModel):
    items: list[Topic] | list[Message]
    next_cursor: str | None
    has_more: bool


class SearchResult(BaseModel):
    kind: Literal["topic", "message"]
    topic_id: UUID
    message_id: UUID | None
    topic_title: str
    excerpt: str
    created_at: datetime


class SearchResponse(BaseModel):
    results: list[SearchResult]
    next_cursor: str | None
    has_more: bool


Limit = Annotated[int, Field(ge=1, le=500)]

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints


TopicTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
MessageBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]

VoiceNoteBase64 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10_000_000)]


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
    body: MessageBody
    reply_to_id: UUID | None = None
    voice_note_base64: VoiceNoteBase64 | None = None


class MessagePatch(BaseModel):
    body: MessageBody


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
    voice_note_base64: str | None = None


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

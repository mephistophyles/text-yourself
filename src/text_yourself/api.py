from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from .errors import ApiError
from .identity import Identity
from .models import (
    Limit,
    MeResponse,
    Message,
    MessageCreate,
    MessagePatch,
    SearchResponse,
    SyncResponse,
    Topic,
    TopicCreate,
    TopicPatch,
)
from .service import MessageService


router = APIRouter(prefix="/api")


def identity(request: Request) -> Identity:
    return request.app.state.identity_resolver.resolve(request)


def service(request: Request) -> MessageService:
    return request.app.state.message_service


@router.get("/me", response_model=MeResponse)
async def me(current: Annotated[Identity, Depends(identity)]) -> MeResponse:
    return MeResponse(user_id=current.user_id, display_name=current.display_name, role=current.role)


@router.get("/sync", response_model=SyncResponse)
async def sync(
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
    after: Annotated[int, Query(ge=0)] = 0,
    limit: Limit = 200,
) -> dict[str, object]:
    return await app_service.sync(current, after, limit)


@router.get("/topics")
async def list_topics(
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
    cursor: str | None = None,
    limit: Limit = 100,
    archived: Literal["active", "archived", "all"] = "active",
) -> dict[str, object]:
    return await app_service.list_topics(current, archived, cursor, limit)


@router.post("/topics", response_model=Topic)
async def create_topic(
    payload: TopicCreate,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
) -> Topic:
    return await app_service.create_topic(current, payload.id, payload.title)


@router.patch("/topics/{topic_id}", response_model=Topic)
async def patch_topic(
    topic_id: UUID,
    payload: TopicPatch,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
) -> Topic:
    return await app_service.patch_topic(current, topic_id, payload.title, payload.archived)


@router.get("/topics/{topic_id}/messages")
async def list_messages(
    topic_id: UUID,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
    cursor: str | None = None,
    limit: Limit = 200,
) -> dict[str, object]:
    return await app_service.list_messages(current, topic_id, cursor, limit)


@router.post("/topics/{topic_id}/messages", response_model=Message)
async def create_message(
    topic_id: UUID,
    payload: MessageCreate,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
) -> Message:
    return await app_service.create_message(
        current, topic_id, payload.id, payload.body, payload.reply_to_id, payload.has_voice_note
    )


@router.patch("/messages/{message_id}", response_model=Message)
async def edit_message(
    message_id: UUID,
    payload: MessagePatch,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
) -> Message:
    return await app_service.edit_message(current, message_id, payload.body)


@router.put("/messages/{message_id}/voice-note", response_model=Message)
async def attach_voice_note(
    message_id: UUID,
    request: Request,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
) -> Message:
    mime_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    audio = await _read_capped_body(request, app_service.voice_note_max_bytes)
    return await app_service.attach_voice_note(current, message_id, mime_type, audio)


@router.get("/messages/{message_id}/voice-note")
async def get_voice_note(
    message_id: UUID,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
) -> Response:
    mime_type, audio = await app_service.voice_note(current, message_id)
    return Response(
        content=audio,
        media_type=mime_type,
        # Audio is written once and never edited, so it is safe to cache hard.
        # Private: it is household content behind the proxy, not public.
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.delete("/messages/{message_id}", response_model=Message)
async def delete_message(
    message_id: UUID,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
) -> Message:
    return await app_service.delete_message(current, message_id)


@router.get("/search", response_model=SearchResponse, response_model_exclude_none=True)
async def search(
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
    q: Annotated[str, Query(min_length=1, max_length=200)],
    cursor: str | None = None,
    limit: Limit = 100,
) -> dict[str, object]:
    return await app_service.search(current, q, cursor, limit)


async def _read_capped_body(request: Request, limit: int) -> bytes:
    """Read the request body, refusing anything over the limit.

    Content-Length is only a hint, so the stream is capped as it is consumed
    rather than trusting the header.
    """
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise ApiError(413, "voice_note_too_large", f"A voice note cannot exceed {limit} bytes")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise ApiError(413, "voice_note_too_large", f"A voice note cannot exceed {limit} bytes")
        chunks.append(chunk)
    return b"".join(chunks)

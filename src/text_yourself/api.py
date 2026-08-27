from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

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
        current, topic_id, payload.id, payload.body, payload.reply_to_id
    )


@router.patch("/messages/{message_id}", response_model=Message)
async def edit_message(
    message_id: UUID,
    payload: MessagePatch,
    current: Annotated[Identity, Depends(identity)],
    app_service: Annotated[MessageService, Depends(service)],
) -> Message:
    return await app_service.edit_message(current, message_id, payload.body)


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

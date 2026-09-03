from __future__ import annotations

import os
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from text_yourself.config import Settings
from text_yourself.database import Database
from text_yourself.identity import Identity
from text_yourself.repository import PostgresRepository


pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL is not configured"
)


@pytest.mark.asyncio
async def test_repository_sync_deletion_and_forced_household_rls():
    database_url = os.environ["TEST_DATABASE_URL"]
    household_id = uuid4()
    identity = Identity(user_id="user@example.com", display_name="Taylor", role="editor")
    database = Database(_settings(database_url, household_id))
    await database.open()
    try:
        repository = PostgresRepository(database)
        topic_id = uuid4()
        message_id = uuid4()
        topic, created = await repository.create_topic(identity, topic_id, "Test topic")
        assert created and topic["sync_version"] > 0
        message, created = await repository.create_message(
            identity, message_id, topic_id, "Sensitive body", None
        )
        assert created and message["body"] == "Sensitive body"
        deleted = await repository.delete_message(identity, message_id)
        assert deleted and deleted["body"] is None
        changes, _, _ = await repository.sync(identity, 0, 100)
        tombstone = next(row for kind, row in changes if kind == "message")
        assert tombstone["body"] is None
    finally:
        await database.close()

    other_database = Database(_settings(database_url, uuid4()))
    await other_database.open()
    try:
        other_repository = PostgresRepository(other_database)
        rows, _, _ = await other_repository.list_topics(identity, "all", None, 100)
        assert all(row["id"] != topic_id for row in rows)
    finally:
        await other_database.close()


@pytest.mark.asyncio
async def test_voice_notes_are_household_scoped_and_survive_an_empty_body():
    """Exercises the real SQL: the memory fake cannot catch a schema mistake."""
    database_url = os.environ["TEST_DATABASE_URL"]
    household_id = uuid4()
    identity = Identity(user_id="user@example.com", display_name="Taylor", role="editor")
    database = Database(_settings(database_url, household_id))
    await database.open()
    topic_id, message_id = uuid4(), uuid4()
    try:
        repository = PostgresRepository(database)
        await repository.create_topic(identity, topic_id, "Voice topic")
        # An empty body is only legal because a voice note is declared.
        message, created = await repository.create_message(
            identity, message_id, topic_id, "", None, True
        )
        assert created and message["has_voice_note"] is True

        row, created = await repository.attach_voice_note(
            identity, message_id, "audio/webm", b"opus-bytes"
        )
        assert created and row["has_voice_note"] is True
        stored = await repository.voice_note(identity, message_id)
        assert bytes(stored["audio"]) == b"opus-bytes"
        assert stored["mime_type"] == "audio/webm"

        # A replayed upload keeps the original recording.
        _, created_again = await repository.attach_voice_note(
            identity, message_id, "audio/webm", b"different"
        )
        assert created_again is False
        stored = await repository.voice_note(identity, message_id)
        assert bytes(stored["audio"]) == b"opus-bytes"

        # A soft-deleted message stops serving its audio but keeps the row.
        await repository.delete_message(identity, message_id)
        assert await repository.voice_note(identity, message_id) is None
    finally:
        await database.close()

    other_database = Database(_settings(database_url, uuid4()))
    await other_database.open()
    try:
        other_repository = PostgresRepository(other_database)
        assert await other_repository.voice_note(identity, message_id) is None
    finally:
        await other_database.close()


def _settings(database_url: str, household_id: UUID) -> Settings:
    return Settings(
        database_url=database_url,
        household_id=household_id,
        web_dist_path=Path("/unused-in-repository-test"),
    )

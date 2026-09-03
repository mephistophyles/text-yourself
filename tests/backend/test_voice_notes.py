from dataclasses import replace
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from text_yourself.app import create_app
from text_yourself.service import MessageService

from .conftest import OTHER_USER_ID, USER_ID, make_settings


AUDIO = b"OggS\x00fake opus payload"


def _topic(client) -> str:
    topic_id = str(uuid4())
    client.post("/api/topics", json={"id": topic_id, "title": "Garden notes"})
    return topic_id


def _message(client, topic_id: str, **payload) -> str:
    message_id = str(uuid4())
    body = {"id": message_id, "body": "Order compost", **payload}
    response = client.post(f"/api/topics/{topic_id}/messages", json=body)
    assert response.status_code == 200, response.json()
    return message_id


def test_voice_note_round_trip_and_flag_on_the_message(client):
    topic_id = _topic(client)
    message_id = _message(client, topic_id, body="", has_voice_note=True)

    created = client.get(f"/api/topics/{topic_id}/messages").json()["items"][0]
    assert created["has_voice_note"] is True

    upload = client.put(
        f"/api/messages/{message_id}/voice-note",
        content=AUDIO,
        headers={"Content-Type": "audio/ogg;codecs=opus"},
    )
    assert upload.status_code == 200
    assert upload.json()["has_voice_note"] is True

    fetched = client.get(f"/api/messages/{message_id}/voice-note")
    assert fetched.status_code == 200
    assert fetched.content == AUDIO
    assert fetched.headers["content-type"] == "audio/ogg"
    assert "immutable" in fetched.headers["cache-control"]


def test_audio_never_rides_the_sync_or_list_channel(client):
    """The bytes must only be reachable through the dedicated endpoint."""
    topic_id = _topic(client)
    message_id = _message(client, topic_id, has_voice_note=True)
    client.put(
        f"/api/messages/{message_id}/voice-note",
        content=AUDIO,
        headers={"Content-Type": "audio/webm"},
    )

    listing = client.get(f"/api/topics/{topic_id}/messages")
    changes = client.get("/api/sync", params={"after": 0, "limit": 200})
    for response in (listing, changes):
        assert "fake opus payload" not in response.text
        assert set(response.json().keys())
    message = listing.json()["items"][0]
    assert message["has_voice_note"] is True
    assert not any("audio" in key or "voice_note_base64" in key for key in message)


def test_upload_is_idempotent_so_a_retried_outbox_item_is_safe(client):
    topic_id = _topic(client)
    message_id = _message(client, topic_id, has_voice_note=True)
    headers = {"Content-Type": "audio/webm"}

    first = client.put(f"/api/messages/{message_id}/voice-note", content=AUDIO, headers=headers)
    replay = client.put(f"/api/messages/{message_id}/voice-note", content=b"different", headers=headers)
    assert first.status_code == replay.status_code == 200

    # The first recording wins; a retry never overwrites it.
    assert client.get(f"/api/messages/{message_id}/voice-note").content == AUDIO


def test_a_message_needs_a_body_or_a_voice_note(client):
    topic_id = _topic(client)
    empty = client.post(
        f"/api/topics/{topic_id}/messages",
        json={"id": str(uuid4()), "body": ""},
    )
    assert empty.status_code == 422
    assert empty.json()["error"]["code"] == "invalid_request"


def test_declared_voice_note_flag_participates_in_id_conflicts(client):
    topic_id = _topic(client)
    message_id = _message(client, topic_id, has_voice_note=True)
    conflict = client.post(
        f"/api/topics/{topic_id}/messages",
        json={"id": message_id, "body": "Order compost"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "id_conflict"


def test_only_the_author_can_attach_and_deleted_messages_hide_audio(client, repository):
    topic_id = _topic(client)
    message_id = _message(client, topic_id, has_voice_note=True)
    client.put(
        f"/api/messages/{message_id}/voice-note",
        content=AUDIO,
        headers={"Content-Type": "audio/webm"},
    )

    repository.messages[UUID(message_id)]["author_id"] = OTHER_USER_ID
    denied = client.put(
        f"/api/messages/{message_id}/voice-note",
        content=AUDIO,
        headers={"Content-Type": "audio/webm"},
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "not_author"

    repository.messages[UUID(message_id)]["author_id"] = USER_ID
    client.delete(f"/api/messages/{message_id}")
    assert client.get(f"/api/messages/{message_id}/voice-note").status_code == 404


def test_missing_voice_note_is_a_clean_404(client):
    topic_id = _topic(client)
    message_id = _message(client, topic_id)
    missing = client.get(f"/api/messages/{message_id}/voice-note")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "voice_note_not_found"


def test_unsupported_media_types_and_empty_bodies_are_rejected(client):
    topic_id = _topic(client)
    message_id = _message(client, topic_id, has_voice_note=True)

    wrong_type = client.put(
        f"/api/messages/{message_id}/voice-note",
        content=AUDIO,
        headers={"Content-Type": "application/json"},
    )
    assert wrong_type.status_code == 415
    assert wrong_type.json()["error"]["code"] == "unsupported_media_type"

    empty = client.put(
        f"/api/messages/{message_id}/voice-note",
        content=b"",
        headers={"Content-Type": "audio/webm"},
    )
    assert empty.status_code == 422


def test_oversized_uploads_are_refused_by_declared_and_actual_size(web_dist, repository):
    settings = replace(make_settings(web_dist), voice_note_max_bytes=64)
    app = create_app(settings, MessageService(repository, settings))
    with TestClient(app) as client:
        topic_id = _topic(client)
        message_id = _message(client, topic_id, has_voice_note=True)
        oversized = client.put(
            f"/api/messages/{message_id}/voice-note",
            content=b"x" * 65,
            headers={"Content-Type": "audio/webm"},
        )
        assert oversized.status_code == 413
        assert oversized.json()["error"]["code"] == "voice_note_too_large"

        # A lying Content-Length must not get past the cap either.
        lying = client.put(
            f"/api/messages/{message_id}/voice-note",
            content=iter([b"x" * 40, b"x" * 40]),
            headers={"Content-Type": "audio/webm"},
        )
        assert lying.status_code == 413


def test_viewers_cannot_attach_a_voice_note(web_dist, repository):
    settings = make_settings(web_dist, proxy=True)
    app = create_app(settings, MessageService(repository, settings))
    with TestClient(app) as client:
        editor = {"X-Auth-User": USER_ID, "X-Auth-Role": "editor"}
        topic_id = str(uuid4())
        client.post("/api/topics", headers=editor, json={"id": topic_id, "title": "Notes"})
        message_id = str(uuid4())
        client.post(
            f"/api/topics/{topic_id}/messages",
            headers=editor,
            json={"id": message_id, "body": "Hello", "has_voice_note": True},
        )

        viewer = {"X-Auth-User": USER_ID, "X-Auth-Role": "viewer", "Content-Type": "audio/webm"}
        denied = client.put(f"/api/messages/{message_id}/voice-note", content=AUDIO, headers=viewer)
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "read_only"

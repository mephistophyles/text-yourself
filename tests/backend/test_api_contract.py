from uuid import UUID

from fastapi.testclient import TestClient

from text_yourself.app import create_app
from text_yourself.service import MessageService

from .conftest import OTHER_USER_ID, USER_ID, make_settings


TOPIC_ID = "10000000-0000-4000-8000-000000000001"
MESSAGE_ID = "20000000-0000-4000-8000-000000000001"


def test_me_and_spa_contract(client):
    assert client.get("/api/me").json() == {
        "user_id": USER_ID,
        "display_name": "Taylor",
        "role": "editor",
    }
    assert client.get("/some/client/route").status_code == 200
    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert manifest.json()["name"] == "Text Yourself"
    service_worker = client.get("/sw.js")
    assert service_worker.status_code == 200
    assert service_worker.text == "// test service worker"
    traversal = client.get("/%2e%2e/pyproject.toml")
    assert "fastapi==" not in traversal.text
    assert client.get("/healthz").json() == {"status": "ok"}


def test_proxy_rejects_unknown_users_and_viewers_cannot_mutate(web_dist, repository):
    settings = make_settings(web_dist, proxy=True)
    app = create_app(settings, MessageService(repository, settings))
    with TestClient(app) as client:
        missing = client.get("/api/me")
        assert missing.status_code == 403
        assert missing.json() == {"error": {"code": "forbidden", "message": "Unknown user"}}

        headers = {"X-Auth-User": USER_ID, "X-Auth-Role": "viewer"}
        assert client.get("/api/me", headers=headers).status_code == 200
        denied = client.post("/api/topics", headers=headers, json={"id": TOPIC_ID, "title": "Plans"})
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "read_only"


def test_idempotent_create_author_rules_and_deleted_body(client, repository):
    topic_payload = {"id": TOPIC_ID, "title": "Garden notes"}
    first_topic = client.post("/api/topics", json=topic_payload)
    replay_topic = client.post("/api/topics", json=topic_payload)
    assert first_topic.status_code == replay_topic.status_code == 200
    assert first_topic.json()["id"] == replay_topic.json()["id"]
    conflict_topic = client.post("/api/topics", json={"id": TOPIC_ID, "title": "Different"})
    assert conflict_topic.status_code == 409
    assert conflict_topic.json()["error"]["code"] == "id_conflict"

    message_payload = {"id": MESSAGE_ID, "body": "Order compost"}
    first = client.post(f"/api/topics/{TOPIC_ID}/messages", json=message_payload)
    replay = client.post(f"/api/topics/{TOPIC_ID}/messages", json=message_payload)
    assert first.status_code == replay.status_code == 200
    assert first.json()["author_display_name"] == "Taylor"
    conflict_message = client.post(
        f"/api/topics/{TOPIC_ID}/messages",
        json={"id": MESSAGE_ID, "body": "Different body"},
    )
    assert conflict_message.status_code == 409
    assert conflict_message.json()["error"]["code"] == "id_conflict"

    repository.messages[UUID(MESSAGE_ID)]["author_id"] = OTHER_USER_ID
    denied = client.patch(f"/api/messages/{MESSAGE_ID}", json={"body": "Changed"})
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "not_author"

    repository.messages[UUID(MESSAGE_ID)]["author_id"] = USER_ID
    deleted = client.delete(f"/api/messages/{MESSAGE_ID}")
    assert deleted.status_code == 200
    assert deleted.json()["body"] is None
    page = client.get(f"/api/topics/{TOPIC_ID}/messages").json()
    assert page["items"][0]["body"] is None


def test_validation_errors_have_stable_shape(client):
    response = client.post("/api/topics", json={"id": "not-a-uuid", "title": ""})
    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "invalid_request", "message": "The request is invalid"}
    }
    missing = client.get("/api/not-a-route")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"

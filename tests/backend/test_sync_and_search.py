from uuid import uuid4


def test_sync_pages_have_exact_wire_shape(client):
    topic_ids = [uuid4() for _ in range(2)]
    for index, topic_id in enumerate(topic_ids):
        client.post("/api/topics", json={"id": str(topic_id), "title": f"Topic {index}"})

    first = client.get("/api/sync", params={"after": 0, "limit": 1}).json()
    assert set(first) == {"changes", "next_version", "has_more"}
    assert first["has_more"] is True
    assert len(first["changes"]) == 1
    assert set(first["changes"][0]) == {"kind", "data"}

    second = client.get(
        "/api/sync", params={"after": first["next_version"], "limit": 1}
    ).json()
    assert len(second["changes"]) == 1
    assert second["next_version"] > first["next_version"]


def test_search_is_bounded_and_excludes_deleted_messages(client):
    topic_id = uuid4()
    client.post("/api/topics", json={"id": str(topic_id), "title": "Travel notebook"})
    message_ids = [uuid4() for _ in range(2)]
    for message_id in message_ids:
        client.post(
            f"/api/topics/{topic_id}/messages",
            json={"id": str(message_id), "body": "Train reservation"},
        )
    client.delete(f"/api/messages/{message_ids[0]}")

    result = client.get("/api/search", params={"q": "Train", "limit": 1}).json()
    assert len(result["results"]) == 1
    assert result["results"][0]["message_id"] == str(message_ids[1])
    assert result["has_more"] is False

    topic_hit = client.get("/api/search", params={"q": "Travel"}).json()["results"][0]
    assert topic_hit["excerpt"] == "Travel notebook"
    assert "message_id" not in topic_hit


def test_limits_are_capped(client):
    response = client.get("/api/sync", params={"limit": 501})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"

# Backend dependency decisions

The v1 backend deliberately has a short dependency list.

- **FastAPI 0.116.1** provides the ASGI lifecycle, request validation, dependency
  injection, static-file serving, and generated API schema. Reimplementing these
  HTTP concerns would add security and maintenance risk.
- **Pydantic 2.11.7** is FastAPI's validation and serialization layer. It is listed
  explicitly so wire-format behavior does not change through a transitive upgrade.
- **psycopg 3.2.13 with binary and pool extras** is the PostgreSQL driver and bounded
  asynchronous connection pool. PostgreSQL-specific transactions, RLS request
  context, and full-text queries make a generic ORM unnecessary in this small app.
  The binary wheel also avoids compiler weight in the runtime image.
- **Uvicorn 0.35.0** is the production ASGI server. It handles graceful SIGTERM and
  lets FastAPI's lifespan close the database pool after in-flight work completes.
- **HTTPX 0.28.1** is used only in tests by FastAPI's in-process test client.
- **pytest 8.4.1 and pytest-asyncio 1.1.0** provide focused unit and HTTP contract
  coverage, including async repository/service behavior.

Versions are pinned for reproducible container builds. Dependabot is expected to
carry routine updates.

## Backend assumptions and trade-offs

- All application mutations take the same PostgreSQL transaction advisory lock in
  the sync-version trigger. PostgreSQL sequences can commit out of order; without
  serialization a client could advance beyond a lower version that commits later.
  Household-scale write volume makes correctness worth the negligible lost write
  concurrency.
- A replayed client UUID is successful only when the complete create payload still
  matches: topic creator/title, or message author/topic/reply target/body. This is
  deliberately strict. It makes accidental UUID reuse visible, though replaying a
  stale create after that entity was edited will surface a conflict for the outbox
  to resolve instead of silently treating the stale payload as accepted.
- Soft-deleted bodies stay in PostgreSQL for recovery, but every client-facing
  repository projection replaces them with `null`; deleted content is also absent
  from search.
- Last-write-wins applies to message-body edits and topic changes, as recorded in
  the product architecture. Author checks and deletion checks still run before an
  edit.
- The application trusts proxy identity headers only in `AUTH_MODE=proxy`; safe
  deployment therefore depends on the prescribed loopback bind and nginx replacing
  rather than forwarding those headers. `AUTH_MODE=none` ignores identity headers.

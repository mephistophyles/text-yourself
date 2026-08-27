# V1 acceptance gate

The implementation is accepted only when all applicable checks below pass or a
specific limitation is recorded in the final handoff.

## Product behavior

- Create, rename, open, and archive a topic.
- Create a message containing plain text and multiple safe links.
- Reply to a prior message and retain a stable quoted reference.
- Edit and soft-delete only the current author's messages.
- Visually distinguish at least two configured authors without relying only on color.
- Search topic titles and live message bodies and navigate to the result.
- Paginate every server list and search response.
- Show useful empty, loading, syncing, offline, pending, failed, and forbidden states.

## Offline and synchronization

- Precache the application shell and expose valid installable PWA metadata.
- Persist the complete fetched projection in IndexedDB.
- Follow bounded sync pages until caught up; never request an unbounded response.
- Queue a topic or message created offline before presenting it as durable.
- Replay queued mutations in order after reconnect or manual Sync.
- Treat repeated create UUIDs idempotently.
- Poll only while the page is visible and offer an explicit Sync control.
- Keep offline search functional over the local projection.

## Identity, authorization, and data

- Provide no login, password, session, or user table.
- Default `AUTH_MODE` to `none`; reject unknown proxy identities and roles.
- Derive request identity only from trusted server context.
- Set PostgreSQL household/user context inside every data transaction.
- Enable and force RLS with a household policy on every application table.
- Never return a soft-deleted message body to a client.
- Keep all fixtures synthetic and all configuration environment-driven.
- Pair every forward migration with a reversible down migration.

## Quality and experience

- Work at 380px and at desktop split-view widths.
- Support keyboard operation, visible focus, reduced motion, and light/dark preference.
- Pass frontend typecheck, unit/component tests, and production build.
- Pass backend unit/integration tests and migration checks.
- Avoid source files over 200 lines and functions over 80 lines unless justified.
- Log structured JSON without message/request bodies.

## Container and deployment

- Build the frontend exactly once in the Docker multi-stage build.
- Run the final image as a non-root user and contain no secret or `.env` file.
- Bind Compose only to `127.0.0.1:8000` and set `mem_limit: 512m`.
- Use the exact `migrate` service and `migration` profile names with the app image tag.
- Make `/healthz` check both PostgreSQL and required static assets.
- Build and push `linux/arm64` images tagged with the commit SHA.
- Let the host deployment script alone handle environment loading, migrations,
  health gating, rollback, and manifest registration.
- Include the production GitHub environment, OIDC permission, and documented
  Tailscale secrets.
- Keep `manifest.json` free of a `url` field.
- Document required SSM parameters, roles, human deployment steps, verification,
  backup expectations, and rollback.


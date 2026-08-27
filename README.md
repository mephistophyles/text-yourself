# Text Yourself

Text Yourself is a private, shared household notebook presented as topic-based
message threads. Two household members can add messages and links, quote earlier
messages, search the shared history, and tell who wrote each entry without turning
the app into another chat service.

The installable web app keeps a complete local projection in IndexedDB for offline
reading and search. Offline edits are queued and replayed when connectivity returns.
The server remains authoritative; clients poll while visible and also expose an
explicit **Sync** control.

## Architecture

The React/TypeScript PWA and FastAPI API ship in one container. PostgreSQL stores
topics and messages in a database owned solely by this app. Every table is protected
by forced household row-level security. The app neither reads another app's database
nor writes durable files to the container or host.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for product, synchronization, data,
and conflict decisions. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for deployment,
verification, backup expectations, and rollback.

## Roles and identity

There is no application login or user table. Network access and the reverse proxy
provide identity.

- `viewer` can read, search, and sync the whole household history.
- `editor` can also create topics and messages, rename or archive topics, and edit or
  soft-delete their own messages.
- Any unknown identity or role is rejected in proxy mode.

`AUTH_MODE=none` is the safe initial platform setting while forward-auth is absent.
It uses a synthetic development identity. Switch to `AUTH_MODE=proxy` only after the
proxy sets trusted `X-Auth-User` and `X-Auth-Role` headers and the second household
member is on the tailnet. The application port must remain loopback-only so clients
cannot bypass nginx and supply those headers themselves.

## Runtime configuration

Configuration comes only from the environment. Do not create `.env`,
`.env.runtime`, or example env files in this repository. In production,
`deploy.sh` renders `.env.runtime` from these SSM parameters:

| SSM parameter | Type | Purpose |
| --- | --- | --- |
| `/home/shared/HOUSEHOLD_ID` | `String` | Stable UUID shared by household apps; never create an app-specific copy. |
| `/home/text-yourself/DATABASE_URL` | `SecureString` | Connection URL for the database owned by this app. |
| `/home/text-yourself/AUTH_MODE` | `String` | `none` initially; `proxy` only when trusted forward-auth is live. |
| `/home/text-yourself/PUBLIC_BASE_URL` | `String` | Canonical externally reachable HTTPS origin, with no trailing slash. |
| `/home/text-yourself/USER_DISPLAY_NAMES` | `SecureString` | Proxy-mode JSON object mapping allowed email identities to display names. |

For example, the shape of `USER_DISPLAY_NAMES` is
`{"user@example.com":"Household member"}`; production values belong only in SSM.
The shared namespace is loaded first, then app-specific values override matching
names.

The following non-secret settings are optional in `AUTH_MODE=none` and are intended
for local development: `DEV_USER_ID` (default `user@example.com`),
`DEV_USER_DISPLAY_NAME` (default `You`), and `DEV_USER_ROLE` (default `editor`).
They are not required production SSM parameters.

## Local development

Prerequisites are Python 3.13, Node.js 22, npm, and a local PostgreSQL database. Set
configuration in the current shell so it cannot be committed:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install --requirement requirements.txt
npm ci --prefix web

export DATABASE_URL='postgresql://localhost/text_yourself'
export HOUSEHOLD_ID='00000000-0000-4000-8000-000000000001'
export AUTH_MODE='none'
export PUBLIC_BASE_URL='http://127.0.0.1:8000'
export USER_DISPLAY_NAMES='{}'
export WEB_DIST_PATH="$PWD/web/dist"
export MIGRATIONS_PATH="$PWD/migrations"

PYTHONPATH=src python -m text_yourself.migrate
npm run build --prefix web
PYTHONPATH=src uvicorn text_yourself.app:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Using a production web build here exercises the same
static-asset path and service-worker behavior as the container. To run the suites:

```bash
PYTHONPATH=src python -m pytest
npm test --prefix web
```

The image itself can be built with `docker build --platform linux/arm64 -t
text-yourself:local .`. Runtime configuration must still be supplied explicitly
with `docker run --env ...`; no configuration or secrets are baked into the image.

## Delivery contract

Pull requests run tests only. A push to `main` or a manual workflow dispatch runs
the tests, builds one native `linux/arm64` image tagged with the immutable commit
SHA, pushes it to GHCR, blocks deployment on high/critical vulnerability findings,
joins the tailnet through workload identity, and then:

1. copies only `docker-compose.yml` and `manifest.json` to the app directory;
2. invokes `/opt/home/bin/deploy.sh text-yourself <sha>`.

The host script owns SSM retrieval, migrations, health gating, automatic rollback,
and launchpad registration. CI intentionally does not duplicate those behaviors.

## Human platform setup still required

The repository supplies the container, Compose/manifest contract, migrations,
workflow, documentation, and license. A platform operator must still perform steps
5–10 from `AGENTS.md`; the app is not live until all are complete:

5. Run `sudo -u deploy /opt/home/bin/new-db.sh text-yourself` on the box.
6. Create the SSM parameters listed above under `/home/text-yourself/`; keep
   `HOUSEHOLD_ID` only under `/home/shared/`, start with `AUTH_MODE=none`, and read
   the parameters back after writing them.
7. Create `/opt/home/apps/text-yourself`, owned by `deploy`.
8. Add and enable the nginx virtual host, then create the private DNS A record that
   points to the box's tailnet IP.
9. In GitHub, create the `production` environment and repository secrets
   `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`.
10. Register a Tailscale federated identity subject for
    `mephistophyles/text-yourself` and the `production` environment, allowing for
    GitHub's optional numeric owner/repository ID suffixes.

After forward-auth and the second household member are ready, populate the display
name map, change `AUTH_MODE` to `proxy`, and reload the app environment as described
in the operations guide.

## Data and backups

PostgreSQL is the only durable system of record; IndexedDB is a replaceable client
projection. Soft-deleted message bodies remain in PostgreSQL for recovery and sync.
This repository does not schedule or store backups. The platform operator must
include the app database in encrypted server-level backups, keep them outside the
container, and periodically prove restoration into an isolated database. Take an
on-demand backup before any migration with meaningful data risk.

## License

Text Yourself is available under the [MIT License](LICENSE).

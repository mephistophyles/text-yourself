# Operations

This runbook covers the platform handoff for `text-yourself`. `AGENTS.md` is the
authoritative contract if this document ever drifts.

## Delivery assumptions and trade-offs

- The exact Node 22.19.0 and Python 3.13.7 image tags match the CI test runtimes.
  They trade automatic patch uptake for reproducible builds; monthly Dependabot
  checks carry base-image updates.
- Production always uses the commit-SHA image. `${TAG:-latest}` exists only because
  it is part of the platform Compose contract and makes local inspection possible;
  `deploy.sh` supplies a SHA.
- One image contains the API, migration runner, and built PWA. This is slightly
  larger than separate images, but guarantees migrations and application code are
  from the same revision and keeps the single-box deployment atomic.
- The platform has one production environment and no staging host. Tests, an image
  vulnerability gate, reversible migrations, the application-aware health check,
  and automatic host rollback are the compensating controls.
- Fixed high and critical OS/library vulnerabilities fail CI before Tailscale or
  host deployment. Ignoring currently unfixed findings reduces noisy permanently
  blocked builds, at the cost of requiring Dependabot and recurring rebuilds to pick
  up fixes promptly.
- The container runs as an unprivileged numeric user and has no writable host
  mount. PostgreSQL and browser IndexedDB are the only state locations.
- Backups, DNS, nginx, SSM, registry retention, and restore testing are platform
  responsibilities because the app has neither host access nor backup credentials.
- Launchpad `access` is display metadata only. Authorization remains the tailnet,
  trusted proxy headers, role checks, and database RLS.

## Deployment flow

The GitHub Actions production job runs only after API and web tests pass. It builds
and pushes `ghcr.io/mephistophyles/text-yourself:<commit-sha>` for `linux/arm64`,
scans that immutable image, connects through Tailscale workload identity, copies
only the Compose file and launchpad manifest, and invokes:

```bash
/opt/home/bin/deploy.sh text-yourself <commit-sha>
```

On the host, `deploy.sh` fetches shared and app SSM values into the runtime env,
pulls that exact image, runs the `migrate` service under the `migration` profile,
starts `app`, waits on `/healthz`, and registers the manifest only after health
passes. It automatically restores the previous image SHA if the new app does not
become healthy. A failed deploy must therefore be investigated rather than worked
around by manually starting an unverified container.

The health endpoint is expected to prove both database access and built web asset
availability. Compose allows a 30-second cold start followed by six checks at
10-second intervals. The app has a 512 MB memory ceiling and ten seconds to handle
SIGTERM before Docker may terminate it.

## Required production setup

Run host operations as `deploy`; the runtime file and app directory are not owned by
the interactive host user.

1. Provision the app database:

   ```bash
   sudo -u deploy /opt/home/bin/new-db.sh text-yourself
   ```

2. Put `DATABASE_URL`, `AUTH_MODE`, `PUBLIC_BASE_URL`, and `USER_DISPLAY_NAMES`
   below `/home/text-yourself/`. Put `HOUSEHOLD_ID` only below `/home/shared/`.
   `DATABASE_URL` and `USER_DISPLAY_NAMES` should be `SecureString`; the others are
   non-secret `String` values. Start with `AUTH_MODE=none`.

3. Verify parameter names after any write; AWS CLI write failures are not reliably
   fatal in an interactive shell:

   ```bash
   aws ssm get-parameters-by-path --path /home/text-yourself --recursive \
     --query 'Parameters[].Name' --output text
   aws ssm get-parameters-by-path --path /home/shared --recursive \
     --query 'Parameters[?Name==`/home/shared/HOUSEHOLD_ID`].Name' --output text
   ```

4. Create `/opt/home/apps/text-yourself` with `deploy:deploy` ownership, configure
   and enable its nginx virtual host, and add the private DNS A record to the box's
   tailnet IP. Preserve the loopback-only `127.0.0.1:8000:8000` binding.

5. Add GitHub repository secrets `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`, create the
   `production` environment, and register the matching Tailscale workload identity
   subject for this repository/environment.

## Verify a deployment

The registry entry is written last, so its absence means the deploy did not pass
the health gate:

```bash
cat /opt/home/registry/text-yourself.json
sudo -u deploy bash -c 'cd /opt/home/apps/text-yourself && docker compose ps'
sudo -u deploy bash -c 'cd /opt/home/apps/text-yourself && docker compose logs --tail=100 app'
```

Confirm all of the following:

- the registry version equals the intended commit SHA;
- `app` is running and healthy, with no restart loop;
- the migration service exited successfully;
- nginx's loaded configuration contains the app's configured server name;
- `/healthz` and the web shell return success through the private HTTPS origin;
- a signed-in household member can sync, create a synthetic test topic, and see it
  from a second browser before removing it through the normal soft-delete/archive
  behavior.

Use `nginx -T` to inspect the loaded configuration. `nginx -t` alone only validates
files that are already included and cannot prove a new site was enabled.

## Configuration changes

Writing an SSM parameter does not change a running container. After verifying the
parameter read-back, regenerate the runtime environment and restart through:

```bash
sudo -u deploy /opt/home/bin/reload-env.sh text-yourself
```

When enabling proxy auth, first verify nginx overwrites rather than forwards
`X-Auth-User` and `X-Auth-Role`, verify both household identities appear in
`USER_DISPLAY_NAMES`, then set `AUTH_MODE=proxy` and reload. A series of API 403s
while static assets still return 200 usually means proxy auth was enabled before
trusted headers were available or the identity map is incomplete.

## Rollback

An unhealthy new container is rolled back automatically by `deploy.sh`. For a
manual application rollback, first identify a known-good commit image and assess
whether migrations since that image are backward compatible. The normal migrations
are designed to be reversible, but schema rollback is an explicit data operation
and must be paired with a verified backup.

If the schema remains compatible, use the platform's documented host rollback:

```bash
sudo -u deploy bash -c 'cd /opt/home/apps/text-yourself && echo "TAG=<known-good-sha>" > .env && docker compose up -d'
```

Then repeat the deployment verification checks, including `/healthz` and the
intended image SHA shown by `docker compose ps`. Record why the rollback happened.
Do not move or reuse a mutable `latest` tag for production rollback.

If a down migration is required, stop and review the matching numbered `.down.sql`
against the live schema and backup. Apply it through the platform's approved
database procedure before starting older application code. Never improvise a data
destructive command during an incident.

## Backups and restoration

Application containers and browser IndexedDB stores are disposable. PostgreSQL is
the sole durable source of truth. The platform operator owns database backups; this
app deliberately has no filesystem backup job or credentials for a backup target.

Operational expectations:

- encrypted backups include the complete app database and live outside its
  container/volume;
- retention covers both operator mistakes and delayed discovery of soft corruption;
- an on-demand backup is taken before a risky migration or manual down migration;
- restore tests use an isolated database and verify topic, reply, author, deletion,
  and sync-version integrity;
- recovery documentation records the backup timestamp and expected data-loss window.

After a restore, deploy the matching application SHA, run health checks, and force
clients to sync from the restored authoritative server. A local IndexedDB copy may
contain newer unconfirmed outbox mutations, so inspect failed/pending client state
before assuming it represents recovered server data.

## Incident triage

Use these read-only checks first:

```bash
cat /opt/home/registry/text-yourself.json
sudo -u deploy bash -c 'cd /opt/home/apps/text-yourself && docker compose ps'
sudo -u deploy bash -c 'cd /opt/home/apps/text-yourself && docker compose logs --tail=200 app'
sudo -u deploy bash -c 'cd /opt/home/apps/text-yourself && docker compose logs --tail=200 migrate'
```

Common signatures:

| Symptom | Likely boundary to inspect |
| --- | --- |
| Registry entry missing after deploy | Migration, startup, or health gate failed before registration. |
| Static shell loads; every API call is 403 | `AUTH_MODE=proxy`, trusted headers, role, or identity map. |
| Health fails with database errors | `DATABASE_URL`, database availability, migration state, or RLS context. |
| Health fails with asset errors | Image build output and `WEB_DIST_PATH=/app/web-dist`. |
| Container is repeatedly killed/restarted | Memory ceiling, startup exception, or missing runtime configuration. |
| Offline changes remain pending | Connectivity, API authorization, or a permanent outbox conflict requiring user attention. |

Logs go to stdout and should be structured JSON. Do not add request-body logging;
message text and URLs are household data.

# Postiz-evo deploy bundle (postiz.evotechly.com)

This folder is the only sanctioned production path for hosting **this exact fork** at `https://postiz.evotechly.com` on Contabo VPS **13.140.219.161**, alongside `plane.evotechly.com`.

It is **not** a live-fit certificate. Server inventory (catalog ~8GB) was not verified from this agent. No SSH, DNS, merge, or secrets were applied here.

## Hard constraints

| Do | Do not |
|---|---|
| Host on **13.140.219.161** | Touch **13.140.219.162** (EvoCRM) |
| Build `Dockerfile.dev` from SHA below | `docker pull ghcr.io/gitroomhq/postiz-app` or use root `docker-compose.yaml` |
| Bind Postiz HTTP to **127.0.0.1:4007** | Publish 4007/5432/6379/7233/8080/8969 on `0.0.0.0` |
| Put public TLS on the **existing** host reverse proxy | Point Plane or EvoCRM vhosts at this stack |
| Leave social / Stripe / OpenAI keys empty until the owner supplies them | Guess OAuth client IDs or publish to social networks |
| First-owner register in the browser | Seed users from this agent |

## Pinned revision

Recorded in `PINNED_REVISION.txt`:

- Repo: `https://github.com/Mohamedbeghanem/postiz-evo` (fork of `gitroomhq/postiz-app`)
- Branch: `main`
- SHA: `5a131eb01d91eeeb53c76ba6f76a068e89f8ee18` (2026-11-06, `version.txt` = `v1.47.0`)
- Local image name: `postiz-evo:5a131eb01d91eeeb53c76ba6f76a068e89f8ee18`
- Build file: `Dockerfile.dev` (this is the same file GHCR uses upstream; **we tag it locally**, we do not pull their registry)

Root `docker-compose.yaml` still says `image: ghcr.io/gitroomhq/postiz-app:latest`. That is a silent upstream replacement. **Do not run it on this VPS.**

## Why this compose is not the stock file

| Stock `docker-compose.yaml` | This bundle |
|---|---|
| Pulls `ghcr.io/gitroomhq/postiz-app:latest` | `build:` + `pull_policy: build` of this SHA |
| Publishes `4007`, `7233`, `8080`, `8969` on all interfaces | Only `127.0.0.1:4007:5000` |
| Names the Temporal network `temporal-network` | `postiz-evo-net` |
| Container names `postiz`, `temporal`, `postiz-postgres` | `postiz-evo-*` prefix |
| Spotlight + Temporal UI + Elasticsearch | Omitted (RAM + port 8080 clash with Plane) |
| Anonymous Temporal Postgres volume | Named `postiz-evo-temporal-db` |
| `NEXT_PUBLIC_UPLOAD_DIRECTORY` (app does not read it) | `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY=/uploads` |

## Services, volumes, migrations

| Container | Image | Host ports | Volume |
|---|---|---|---|
| `postiz-evo` | **built from this repo** | `127.0.0.1:4007→5000` | `postiz-evo-config`, `postiz-evo-uploads` |
| `postiz-evo-postgres` | `postgres:17-alpine` | none | `postiz-evo-postgres` |
| `postiz-evo-redis` | `redis:7.2` | none | `postiz-evo-redis` |
| `postiz-evo-temporal-db` | `postgres:16` | none | `postiz-evo-temporal-db` |
| `postiz-evo-temporal` | `temporalio/auto-setup:1.28.1` | none | config bind `temporal-dynamicconfig.yaml` |

Inside `postiz-evo`, nginx listens on **5000** and fronts:

- frontend `127.0.0.1:4200`
- backend `127.0.0.1:3000` at `/api/`
- local uploads at `/uploads/`
- orchestrator (Temporal worker) on **3002** (not published)

**Migrations:** there is no `prisma/migrations` directory. Container start runs `pnpm run prisma-db-push` (`prisma db push` against `libraries/nestjs-libraries/src/database/prisma/schema.prisma`). First boot creates the schema. Later boots reconcile the schema in place. That is not a versioned migrate history.

## Required env keys

Filled from `env.postiz-evo.example` → `postiz.env` (gitignored).

Must be non-empty for the configuration checker / boot:

- `POSTIZ_PUBLIC_URL` = `https://postiz.evotechly.com` (no trailing slash)
- `JWT_SECRET` (long unique random; not the stock compose string)
- `POSTIZ_DB_USER` / `POSTIZ_DB_PASSWORD` / `POSTIZ_DB_NAME`
- `TEMPORAL_DB_PASSWORD`
- `IS_GENERAL=true`
- `STORAGE_PROVIDER=local`
- `UPLOAD_DIRECTORY=/uploads`
- `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY=/uploads`

Compose injects (do not point these at `localhost` for Postgres/Redis/Temporal):

- `DATABASE_URL=postgresql://…@postiz-evo-postgres:5432/…`
- `REDIS_URL=redis://postiz-evo-redis:6379`
- `TEMPORAL_ADDRESS=postiz-evo-temporal:7233`
- `BACKEND_INTERNAL_URL=http://localhost:3000` (same container)
- `MAIN_URL` / `FRONTEND_URL` / `NEXT_PUBLIC_BACKEND_URL` from `POSTIZ_PUBLIC_URL`

`DISABLE_REGISTRATION=true` still allows the **first** organization to register (`canRegister` returns true while org count is 0). After that, local registration is closed. That is the owner onboarding path.

Do **not** set `EMAIL_PROVIDER` for the first login. If it is set, the first user is created unactivated and needs a working mailbox.

Leave every social / Stripe / OpenAI / Cloudflare key unset until the owner provides real values. Channels will not post without those apps; that is expected.

## Reverse proxy and WebSockets / SSE

Host proxy (Caddy or nginx already serving `plane.evotechly.com`) must add **one** vhost:

`postiz.evotechly.com` → `http://127.0.0.1:4007`

Requirements:

- TLS on the host proxy (DNS/ACME is out of scope for this agent)
- WebSocket upgrade headers (Caddy does this; nginx snippet is in `nginx.postiz.evotechly.com.example`)
- `client_max_body_size` ≥ 2G (uploads)
- long `proxy_read_timeout` (MCP SSE at `/api/sse/…`, Copilot at `/api/copilot/chat`)
- `X-Forwarded-Proto` / `X-Forwarded-Host` passed through

The in-container nginx (`var/docker/nginx.conf`) preserves those forwarded headers, upgrades WebSockets, and disables buffering on `/api/` so SSE is not stuck.

Cookie domain: `getCookieUrlFromDomain('https://postiz.evotechly.com')` becomes `.evotechly.com`. Confirm on the host that Plane does not set a cookie named `auth` on that parent domain. This was not live-checked.

## Health checks

After `up`:

```bash
curl -fsS http://127.0.0.1:4007/api/
# expected body: App is running!

docker inspect --format '{{.State.Health.Status}}' postiz-evo
# expected: starting → healthy

curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4007/
# expected: 200 or 307/302 to /auth (unsigned)

docker exec postiz-evo curl -fsS http://127.0.0.1:3002/health/status
# expected JSON: {"status":"ok"} once Temporal is up
```

From the public name (only after the host proxy and DNS exist — not claimed here):

```bash
curl -fsS https://postiz.evotechly.com/api/
```

Postgres/Redis healthchecks are `pg_isready` / `redis-cli ping`. Temporal is `service_started` only (auto-setup has no documented HTTP probe in this tree).

## Resource and build requirements (not live-verified)

Official pre-built GHCR image is documented against a 2 GB / 2 vCPU VM. **That path is forbidden here.**

This fork image is a source build:

- `Dockerfile.dev` runs `NODE_OPTIONS=--max-old-space-size=4096 pnpm run build`
- Heap alone is 4 GiB; `pnpm install` + compilers (`g++`, `python3`, `canvas`/`sharp` native) peak higher
- Runtime of this slim stack (no Elasticsearch, no Temporal UI, no Spotlight): budget **~2.5–4 GiB** extra RAM on top of Plane
- Image size after build is typically several gigabytes; GitHub `diskUsage` for the repo is ~65 MiB and is not the image size

Catalog ~8 GB was **not** live-verified. If that figure is the VPS RAM and Plane is already resident, **do not build on-box**. Build on a machine with ≥8 GiB free RAM, `docker save` the tagged image, load it on 13.140.219.161, then `up -d` without `--build`.

```bash
# build host (not EvoCRM, not claimed to be the VPS)
docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml build
docker save postiz-evo:5a131eb01d91eeeb53c76ba6f76a068e89f8ee18 | gzip > postiz-evo-5a131eb0.tar.gz

# 13.140.219.161 only
gunzip -c postiz-evo-5a131eb0.tar.gz | docker load
docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml up -d
```

## Exact commands (13.140.219.161 only)

Replace `/opt/postiz-evo` if the host layout differs. Do not run these against 13.140.219.162.

```bash
sudo mkdir -p /opt/postiz-evo
sudo chown "$USER":"$USER" /opt/postiz-evo
cd /opt/postiz-evo

git clone https://github.com/Mohamedbeghanem/postiz-evo.git .
git checkout 5a131eb01d91eeeb53c76ba6f76a068e89f8ee18
git rev-parse HEAD
# must print 5a131eb01d91eeeb53c76ba6f76a068e89f8ee18

cp deploy/env.postiz-evo.example deploy/postiz.env
# edit deploy/postiz.env: JWT_SECRET, POSTIZ_DB_PASSWORD, TEMPORAL_DB_PASSWORD
# use alphanumeric passwords only (DATABASE_URL is not URL-encoded)
# leave OAuth / Stripe / OpenAI empty

# confirm Plane is not using 127.0.0.1:4007
ss -lptn | grep -E '4007|7233|8080' || true

# never: docker compose -f docker-compose.yaml up
# never: docker pull ghcr.io/gitroomhq/postiz-app

docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml config
docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml build
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.RepoTags}}' \
  postiz-evo:5a131eb01d91eeeb53c76ba6f76a068e89f8ee18
# must show 5a131eb01d91eeeb53c76ba6f76a068e89f8ee18 and must not mention gitroomhq

docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml up -d

docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml ps
curl -fsS http://127.0.0.1:4007/api/
```

Then attach **one** of:

- `deploy/Caddyfile.postiz.evotechly.com.example`
- `deploy/nginx.postiz.evotechly.com.example`

to the **existing** host proxy. DNS and TLS stay with the host-inventory owner.

## Initial owner onboarding

1. Open `https://postiz.evotechly.com` (or `http://127.0.0.1:4007` before DNS).
2. Register the owner email/password/company. First org becomes `SUPERADMIN`. User is activated immediately because `EMAIL_PROVIDER` is unset.
3. Confirm `/auth/register` is then blocked (`DISABLE_REGISTRATION=true` and org count > 0).
4. Connect channels only after the owner creates real provider apps. Callback base is `https://postiz.evotechly.com`.
5. Do not schedule or publish social posts from this deploy.

## Blockers (not solved here)

1. **Host access / inventory** — catalog ~8 GB not live-verified; RAM vs disk unknown; Plane port map unknown.
2. **On-box source build vs 8 GB shared with Plane** — high OOM risk; prefer off-box `docker save`/`load`.
3. **DNS / TLS for postiz.evotechly.com** — out of scope; proxy snippets are files only.
4. **Cookie parent domain `.evotechly.com`** — possible clash with Plane `auth` cookie; verify on host.
5. **No social apps** — scheduling UI works; publishing will fail until real OAuth is supplied by the owner.
6. **Stock compose trap** — `docker compose up` from repo root still pulls upstream unless the operator uses this folder.

## Evidence paths

In this repository (after merge of the deploy PR):

- `deploy/PINNED_REVISION.txt`
- `deploy/DEPLOY.md` (this file)
- `deploy/docker-compose.postiz-evo.yaml`
- `deploy/env.postiz-evo.example`
- `deploy/Caddyfile.postiz.evotechly.com.example`
- `deploy/nginx.postiz.evotechly.com.example`
- `deploy/temporal-dynamicconfig.yaml`
- `Dockerfile.dev`, `var/docker/nginx.conf`

Coordinator copies written by the readiness agent:

- `/opt/cursor/artifacts/postiz-evo-readiness/PINNED_REVISION.txt`
- `/opt/cursor/artifacts/postiz-evo-readiness/FINDINGS.md`
- `/opt/cursor/artifacts/postiz-evo-readiness/DEPLOY.md`

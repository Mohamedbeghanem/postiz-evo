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
| First-owner register only on loopback (or bootstrap proxy auth) | Expose `/auth` on the public name while `BOOTSTRAP_REGISTRATION=true` |
| Tag the image `postiz-evo:$(git rev-parse HEAD)` | Tag with upstream `5a131eb0` / `gitroomhq` `latest` |

## Pinned revision

The image tag **is** `git rev-parse HEAD` of the tree you build. That tree must include `var/docker/nginx.conf` forwarded-proto/WebSocket fixes, `curl` in `Dockerfile.dev`, `COOKIE_HOST_ONLY`, and `BOOTSTRAP_REGISTRATION`. Do **not** label the image with upstream `5a131eb01d91eeeb53c76ba6f76a068e89f8ee18` (the gitroomhq merge that does not contain those fixes).

```bash
export POSTIZ_GIT_SHA=$(git rev-parse HEAD)
echo "$POSTIZ_GIT_SHA"   # this is the pin
```

`deploy/PINNED_REVISION.txt` records the SHA this agent actually built. Root `docker-compose.yaml` still says `image: ghcr.io/gitroomhq/postiz-app:latest`. **Do not run it on this VPS.**

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
- `DISABLE_REGISTRATION=true`
- `BOOTSTRAP_REGISTRATION=false` until the loopback owner step, then `true` for that step only
- `COOKIE_HOST_ONLY=true`
- `STORAGE_PROVIDER=local`
- `UPLOAD_DIRECTORY=/uploads`
- `NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY=/uploads`

Compose injects (do not point these at `localhost` for Postgres/Redis/Temporal):

- `DATABASE_URL=postgresql://…@postiz-evo-postgres:5432/…`
- `REDIS_URL=redis://postiz-evo-redis:6379`
- `TEMPORAL_ADDRESS=postiz-evo-temporal:7233`
- `BACKEND_INTERNAL_URL=http://localhost:3000` (same container)
- `MAIN_URL` / `FRONTEND_URL` / `NEXT_PUBLIC_BACKEND_URL` from `POSTIZ_PUBLIC_URL`

`DISABLE_REGISTRATION=true` plus `BOOTSTRAP_REGISTRATION=false` (this bundle's default) means **nobody** can register, including the first SUPERADMIN. That is intentional. Flip `BOOTSTRAP_REGISTRATION=true` only for the loopback owner step below, then set it back to `false` and recreate.

Do **not** set `EMAIL_PROVIDER` for that first login. If it is set, the first user is created unactivated and needs a working mailbox.

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

## Cookie isolation (Plane sibling)

Public Plane source (`makeplane/plane` `apps/api/plane/settings/common.py` on `master`):

- `SESSION_COOKIE_NAME` default **`session-id`**
- `ADMIN_SESSION_COOKIE_NAME` **`admin-session-id`**
- `SESSION_COOKIE_DOMAIN` / `CSRF_COOKIE_DOMAIN` from env `COOKIE_DOMAIN`, default **`None`** (host-only)
- `CSRF_COOKIE_NAME` is not set in that file, so Django's default **`csrftoken`** applies

Postiz sets **`auth`**, **`showorg`**, **`org`**, **`track`**. Those names do not match Plane's defaults, so a name collision is not the issue.

The issue is scope. Without `COOKIE_HOST_ONLY`, `getCookieUrlFromDomain('https://postiz.evotechly.com')` sets `Domain=.evotechly.com`, so the Postiz JWT is sent to `plane.evotechly.com` and every other sibling. This bundle sets `COOKIE_HOST_ONLY=true` so the `Domain` attribute is omitted (host-only to `postiz.evotechly.com`). Plane's default `COOKIE_DOMAIN=None` is already host-only for `plane.evotechly.com`. Do not set Plane `COOKIE_DOMAIN=.evotechly.com` either.

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

This agent already built and exported:

- tag `postiz-evo:1e1418a6db524f93c23585a3e5fa971cd85858d7`
- Id `sha256:db7ca702e2df4b35abdf61f76d68fd838e26f0539059259b5893c48290d64515`
- gzip sha256 `62ed5caa98bf7307ae5d61518a9f9165410b73126c7103e39ab9bb5f79bfabab` (1629090123 bytes)

The Cursor artifact store cannot hold a single 1.6G file (close fails above ~100MiB). Coordinator copies are 90MiB parts plus `IMAGE_SHA256SUMS.txt`. Reconstruct before `docker load`:

```bash
# build host (this cloud VM, or any machine that is not Contabo / not 162)
export POSTIZ_GIT_SHA=1e1418a6db524f93c23585a3e5fa971cd85858d7
# if transferring artifact parts:
cat "postiz-evo-${POSTIZ_GIT_SHA}.tar.gz.part"* > "postiz-evo-${POSTIZ_GIT_SHA}.tar.gz"
echo "62ed5caa98bf7307ae5d61518a9f9165410b73126c7103e39ab9bb5f79bfabab  postiz-evo-${POSTIZ_GIT_SHA}.tar.gz" | sha256sum -c

# 13.140.219.161 only — after the image is copied
gunzip -c "postiz-evo-${POSTIZ_GIT_SHA}.tar.gz" | docker load
docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml up -d
```

## Exact commands (13.140.219.161 only)

Replace `/opt/postiz-evo` if the host layout differs. Do not run these against 13.140.219.162.

```bash
sudo mkdir -p /opt/postiz-evo
sudo chown "$USER":"$USER" /opt/postiz-evo
cd /opt/postiz-evo

git clone https://github.com/Mohamedbeghanem/postiz-evo.git .
git checkout cursor/postiz-evo-deploy-bundle-a834   # or the merged SHA that contains deploy/
export POSTIZ_GIT_SHA=$(git rev-parse HEAD)

cp deploy/env.postiz-evo.example deploy/postiz.env
# edit deploy/postiz.env: POSTIZ_GIT_SHA, JWT_SECRET, DB passwords
# BOOTSTRAP_REGISTRATION=false and COOKIE_HOST_ONLY=true
# use alphanumeric passwords only (DATABASE_URL is not URL-encoded)
# leave OAuth / Stripe / OpenAI empty

# confirm Plane is not using 127.0.0.1:4007
ss -lptn | grep -E '4007|7233|8080' || true

# never: docker compose -f docker-compose.yaml up
# never: docker pull ghcr.io/gitroomhq/postiz-app
# never: attach the public vhost yet

docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml config
docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml up -d
# if the image was loaded from docker save, omit --build

docker compose --env-file deploy/postiz.env -f deploy/docker-compose.postiz-evo.yaml ps
curl -fsS http://127.0.0.1:4007/api/
curl -fsS http://127.0.0.1:4007/api/auth/can-register
# expected: {"register":false} while BOOTSTRAP_REGISTRATION=false
```

Do **not** attach the public vhost yet.

## Safe first-owner setup

Do not create the owner account from this agent. Do not put the register form on the public internet while the database is empty.

1. Stack listens only on `127.0.0.1:4007`. Leave `postiz.evotechly.com` **unproxied**.
2. Confirm `BOOTSTRAP_REGISTRATION=false` then `curl http://127.0.0.1:4007/api/auth/can-register` → `{"register":false}`.
3. SSH (or similar) to 13.140.219.161, set `BOOTSTRAP_REGISTRATION=true` in `deploy/postiz.env`, `docker compose ... up -d` (recreate postiz-evo only).
4. As the owner, open **http://127.0.0.1:4007** via an SSH tunnel (`ssh -L 4007:127.0.0.1:4007 user@13.140.219.161`) and register email/password/company. First org is `SUPERADMIN`. `EMAIL_PROVIDER` must stay unset so the user is activated immediately.
5. Set `BOOTSTRAP_REGISTRATION=false`, recreate `postiz-evo`, curl `can-register` again → `{"register":false}`.
6. Only then attach `Caddyfile.postiz.evotechly.com.example` or the nginx snippet. DNS/TLS stay with the host owner.

If the public name must be used during step 4, put `Caddyfile.bootstrap.example` in front (HTTP basic auth). That is not an application account. Remove it after step 5.

Do not schedule or publish social posts from this deploy.

## Blockers (not solved here)

1. **Host access / inventory** — catalog ~8 GB not live-verified; RAM vs disk unknown; Plane port map unknown.
2. **On-box source build vs 8 GB shared with Plane** — high OOM risk; load the image built off-server.
3. **DNS / TLS for postiz.evotechly.com** — out of scope; proxy snippets are files only. Do not attach them until bootstrap is closed.
4. **No social apps** — scheduling UI works; publishing will fail until real OAuth is supplied by the owner.
5. **Stock compose trap** — `docker compose up` from repo root still pulls upstream unless the operator uses this folder.

## Evidence paths

In this repository (after merge of the deploy PR):

- `deploy/PINNED_REVISION.txt`
- `deploy/DEPLOY.md` (this file)
- `deploy/docker-compose.postiz-evo.yaml`
- `deploy/env.postiz-evo.example`
- `deploy/Caddyfile.postiz.evotechly.com.example`
- `deploy/Caddyfile.bootstrap.example`
- `deploy/nginx.postiz.evotechly.com.example`
- `deploy/temporal-dynamicconfig.yaml`
- `Dockerfile.dev`, `var/docker/nginx.conf`

Coordinator copies written by the readiness agent:

- `/opt/cursor/artifacts/postiz-evo-readiness/PINNED_REVISION.txt`
- `/opt/cursor/artifacts/postiz-evo-readiness/FINDINGS.md`
- `/opt/cursor/artifacts/postiz-evo-readiness/DEPLOY.md`
- `/opt/cursor/artifacts/postiz-evo-readiness/IMAGE_SHA256SUMS.txt`
- `/opt/cursor/artifacts/postiz-evo-readiness/postiz-evo-1e1418a6db524f93c23585a3e5fa971cd85858d7.tar.gz.part000` … `.part017`
- `/var/tmp/postiz-evo-bundle/postiz-evo-1e1418a6db524f93c23585a3e5fa971cd85858d7.tar.gz` (full gzip on the build VM)

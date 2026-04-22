# anyone-dns

NestJS microservice that serves a hosts-file–style mapping of `*.anyone` UNS
domains to their hidden service addresses. Reads records from a Postgres
database populated by
[`uns-record-indexer`](https://github.com/anyone-protocol/uns-record-indexer)
and keeps them in an in-memory cache that refreshes on a TTL.

## Public API

All responses are `text/plain`.

| Method | Path                  | Description |
|--------|-----------------------|-------------|
| GET    | `/`                   | Healthcheck — version, HS hostname, HS public key. |
| GET    | `/tld/anyone`         | Full hosts-file body: one `<domain> <hsaddr>` line per mapping. |
| GET    | `/tld/anyone/:name`   | Single hosts-file line for `<name>.anyone`, or `404` if unknown. |

## Configuration

Copy [.env.example](.env.example) to `.env` and adjust.

| Variable                      | Required | Default       | Notes |
|-------------------------------|----------|---------------|-------|
| `PORT`                        | no       | `3000`        | HTTP listen port. |
| `VERSION`                     | no       | `unknown`     | Surfaced in `/` healthcheck. |
| `HIDDEN_SERVICE_HOSTNAME`     | no       | `unknown`     | Surfaced in `/` healthcheck. |
| `HIDDEN_SERVICE_PUBLIC_KEY`   | no       | `unknown`     | Base64; decoded to hex in `/` healthcheck. |
| `ANYONE_DOMAINS_CACHE_TTL_MS` | no       | `300000`      | In-memory cache refresh interval. |
| `DEFAULT_MAPPINGS_PATH`       | no       | _unset_       | Path to a `<domain> <hsaddr>` file; overlays on top of DB rows. |
| `DB_HOST`                     | yes      | `localhost`   | Postgres host. |
| `DB_PORT`                     | yes      | `5432`        | Postgres port. |
| `DB_USER`                     | yes      | `postgres`    | Read-only user is sufficient. |
| `DB_PASSWORD`                 | yes      | `postgres`    | |
| `DB_NAME`                     | yes      | `uns_indexer` | DB populated by `uns-record-indexer`. |

The service never runs migrations and only issues `SELECT` against
`hidden_service_records`. The indexer owns the schema.

## Local development

### With Docker

Build the image and run it against an existing Postgres that has been
populated by [`uns-record-indexer`](https://github.com/anyone-protocol/uns-record-indexer):

```bash
# Build the image
docker build -t anyone-dns .

# Run it. `--env-file` picks up your local .env; override DB_HOST if needed
# (e.g. `host.docker.internal` on macOS/Windows, or your host's LAN IP on
# Linux, so the container can reach Postgres running on the host).
cp .env.example .env
docker run --rm -p 3000:3000 \
  --env-file .env \
  -e DB_HOST=host.docker.internal \
  anyone-dns
```

On Linux, if your Postgres is on the host, add
`--add-host=host.docker.internal:host-gateway` or just set `DB_HOST` to the
host's LAN IP / `172.17.0.1`.

### Without Docker

```bash
npm install
cp .env.example .env      # then edit DB_* to point at a running Postgres
npm run start:dev
```

## Tests

```bash
npm test          # unit
npm run test:e2e  # e2e (uses a stubbed repository; no DB required)
npm run test:cov  # coverage
```

## Build

```bash
npm run build
npm run start:prod
```

## Deployment

Deployed via Nomad; see [operations/anyone-dns-stage.hcl](operations/anyone-dns-stage.hcl)
and [operations/anyone-dns-live.hcl](operations/anyone-dns-live.hcl).

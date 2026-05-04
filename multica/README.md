# Multica Self-Host — Operator Runbook

Multica is the orchestration layer for the Appaltami agent stack. It manages tasks, assigns them to Claude Code daemons (personas), and emits the WebSocket events that the approval-gate service consumes.

The server lives **outside the repo** at `~/.multica-selfhost` so that Multica's own source tree is not vendored into Appaltami. This directory holds only the wrappers and this runbook.

---

## Quick start

```bash
# From repo root:
pnpm agents:multica:up    # or: ./tools/agent-stack/multica/up.sh

# Verify all three services are healthy:
docker ps --filter name=multica
curl -s http://localhost:8080/health    # should return {"status":"ok"}
open http://localhost:3010             # Multica web UI
```

---

## Services and ports

| Service  | Container             | Host port | Notes                                            |
|----------|-----------------------|-----------|--------------------------------------------------|
| Backend  | multica-backend-1     | :8080     | REST API + WebSocket endpoint (`/ws`)            |
| Frontend | multica-frontend-1    | :3010     | Web UI (remapped from default :3000 to avoid clash with `pnpm dev`) |
| Postgres | multica-postgres-1    | :5432     | pgvector/pg17 — **conflicts with local Postgres if you have one** |

The `multica` CLI and daemon talk to the **backend** at `ws://localhost:8080/ws`; the frontend port change is transparent to them.

---

## Start / stop

```bash
# Start (idempotent — safe to re-run)
./tools/agent-stack/multica/up.sh

# Stop (keeps volumes — data is preserved)
./tools/agent-stack/multica/down.sh

# Stop and wipe all data (destructive)
cd ~/.multica-selfhost && docker compose -f docker-compose.selfhost.yml down -v
```

---

## Data volumes

Multica uses two named Docker volumes (not host-path mounts):

| Volume                 | Contents                              |
|------------------------|---------------------------------------|
| `multica_pgdata`       | Postgres database (tasks, workspaces, users) |
| `multica_backend_uploads` | File uploads attached to tasks    |

To inspect or back up a volume:
```bash
docker volume inspect multica_pgdata
# then copy out of the volume mountpoint shown under "Mountpoint"
```

---

## Daemon socket

The daemon process (started with `multica daemon start`) writes its PID and connection state to:
```
~/.multica/daemon.id
```

Check daemon status:
```bash
cat ~/.multica/daemon.id
multica runtime list   # shows all registered runtimes (Mac + any VPS daemons)
```

---

## Upgrading the image tag

1. Edit `~/.multica-selfhost/.env` — change `MULTICA_IMAGE_TAG`:
   ```
   MULTICA_IMAGE_TAG=v0.X.Y
   ```
2. Pull the new images and restart:
   ```bash
   cd ~/.multica-selfhost
   docker compose -f docker-compose.selfhost.yml pull
   docker compose -f docker-compose.selfhost.yml up -d
   ```
3. Verify: `curl -s http://localhost:8080/health` still returns `{"status":"ok"}`.

Current pinned version: **v0.2.24**

---

## Environment file

`~/.multica-selfhost/.env` — never committed to the repo.

Key variables you may need to set:

| Variable | Description | Default |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key for magic-link auth emails | `__SET_BY_USER__` — fill before first login |
| `MULTICA_IMAGE_TAG` | Pinned Docker image tag | `v0.2.24` |
| `JWT_SECRET` | Signing secret (auto-generated at install) | random hex-32 |
| `ALLOW_SIGNUP` | Whether new users can self-register | `true` |
| `ALLOWED_EMAILS` | Comma-separated allowlist (leave empty for open) | — |

---

## First-time authentication (after setting RESEND_API_KEY)

```bash
multica setup self-host        # point CLI at http://localhost:8080
multica daemon start           # register this Mac as a runtime
multica runtime list           # confirm "macbook" (or hostname) appears
```

If you don't have a `RESEND_API_KEY` yet, read the one-time code from backend logs instead:
```bash
docker logs multica-backend-1 2>&1 | grep -i "verification code\|code:" | tail -5
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `docker ps` shows no multica containers | Containers stopped or never started | Run `up.sh` |
| Backend health check fails | Postgres not yet healthy | Wait 10 s and retry; `docker logs multica-postgres-1` |
| Frontend unreachable on :3010 | `pnpm dev` occupied :3000 previously and Docker cached the wrong binding | `down.sh && up.sh` |
| `multica daemon start` hangs | `RESEND_API_KEY` blank — backend can't send auth email | Set the key in `.env`, restart backend: `docker compose -f ~/.multica-selfhost/docker-compose.selfhost.yml restart backend` |
| Postgres port :5432 conflict | Local Postgres running | Stop it: `brew services stop postgresql@17` or change `POSTGRES_PORT` in `.env` |

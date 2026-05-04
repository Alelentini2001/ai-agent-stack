# Appaltami — Autonomous Agent Stack

Five-layer autonomous agent stack for the Appaltami platform. Agents monitor Italian procurement law, file Multica tasks, and require human approval before any high-risk action ships.

Architecture: **Triggers** (cron/scrapers) → **Multica** (orchestration) → **Personas** (Claude Code agents) → **Approval gate** (Resend magic-link) → **Claude Code daemon** (execution)

---

## How to start everything in order

```bash
# 1. Start Multica (Postgres + backend :8080 + frontend :3010)
pnpm agents:multica:up

# 2. Start the approval gate (listens on :4242, watches Multica WS)
cp tools/agent-stack/approval-gate/.env.example tools/agent-stack/approval-gate/.env
# fill in MULTICA_TOKEN, MULTICA_WORKSPACE_ID, RESEND_API_KEY, APPROVER_EMAIL, JWT_SECRET
pnpm agents:up

# 3. Ensure the daemon is running (registers this Mac as a runtime)
multica daemon start
multica runtime list   # should show Claude (MacBookPro) as online
```

Verify: `curl -s http://localhost:8080/health` → `{"status":"ok"}` and `curl -s http://localhost:4242/healthz` → `{"status":"ok"}`.

---

## How to file a test issue

```bash
# risk:content = medium → approval email is sent
multica issue create \
  --workspace appaltami \
  --title "smoke test: bump README" \
  --label risk:content

# Check approval gate logs for the magic link, or check your inbox.
```

---

## How to add a new persona

1. Write `tools/agent-stack/personas/<name>.md` following the agency-agents format (frontmatter: `name`, `description`, `color`; sections: Identity → Core Mission → Critical Rules → Technical Deliverables → Workflow → Success Metrics → Memory budget).
2. Symlink: `ln -sf "$PWD/tools/agent-stack/personas/<name>.md" ~/.claude/agents/<name>.md`
3. Restart daemon: `multica daemon stop && multica daemon start`
4. Update `tools/agent-stack/personas/INDEX.md` with a one-line "when to use" entry.

---

## How to add a new risk label

Edit `tools/agent-stack/approval-gate/src/risk.ts` — add the label to the `RISK_TABLE` object:

```ts
"risk:my-new-label": "high",   // or "medium"
```

No other code changes needed. Restart the approval gate: `pnpm agents:up`.

---

## Component reference

| Directory | Purpose |
|-----------|---------|
| `multica/` | Docker Compose wrappers + runbook for the Multica self-host |
| `personas/` | INDEX.md of curated agency-agents + 4 custom Italian regulatory personas |
| `approval-gate/` | TypeScript/Hono service: magic-link email approval for high-risk tasks |
| `ingestion/` | Cron-driven stub workers: Gazzetta Ufficiale, ANAC, MEPA portal watcher |

---

## Common failure modes

| Symptom | Fix |
|---------|-----|
| `pnpm agents:multica:up` fails | Docker Desktop not running — start it first |
| Approval gate `/healthz` → `ws_down` | Multica backend stopped — run `pnpm agents:multica:up` |
| No approval email arriving | `RESEND_API_KEY` invalid or unset in `approval-gate/.env` — check Resend dashboard |
| `multica daemon start` exits immediately | JWT token in `~/.multica/config.json` expired — re-run `multica setup self-host` and get a new code from `docker logs multica-backend-1` |
| Multica Postgres port :5432 conflicts | Local Postgres running — `brew services stop postgresql@17` or change `POSTGRES_PORT` in `~/.multica-selfhost/.env` |
| `multica runtime list` returns 400 | `workspace_slug` not set in `~/.multica/config.json` — add `"workspace_slug": "appaltami"` |

---

## Deferred / next steps

- **VPS daemon**: set up a second `multica daemon` on a cloud VPS for cloud-side scrapers. Run `multica setup self-host --server-url https://your-vps` on the VPS and repeat the daemon start steps.
- **ANAC scraper**: implement the HTML parser in `ingestion/anac-bulletin-monitor.ts` (the page structure uses `.atti-list-item` elements).
- **MEPA watcher**: connect `ingestion/mepa-portal-watcher.ts` to the `competitor_intelligence` Supabase table.
- **Resend key**: replace `RESEND_API_KEY` in `~/.multica-selfhost/.env` with a valid key to enable email auth on the Multica web UI.
- **Install cron**: review `ingestion/crontab.example` and install with `crontab -e` once scrapers are implemented.

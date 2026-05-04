# AI Agent Stack

A self-hosted autonomous agent system that lets you send tasks to AI from Telegram, get human-in-the-loop approval for risky operations, and have Claude Code execute approved work automatically.

```
You (Telegram) ──► Approval Gate ──► Multica Orchestrator ──► Claude Code daemon
                          │
                    Approve / Reject
                    (single-use link)
```

## What it does

1. **Send a task** — message your Telegram bot in plain English
2. **Approve it** — bot sends an Approve/Reject notification with one-tap buttons
3. **Claude works** — approved tasks are assigned to a Claude Code agent that executes them in your codebase
4. **Audit trail** — every send/approve/reject is logged with IP, timestamp, and UUID

## Stack

| Component | What it is |
|-----------|-----------|
| [Multica](https://multica.ai) | Self-hosted task orchestrator (Docker) |
| Approval gate | TypeScript/Hono service — Telegram bot + magic-link JWT approval |
| agency-agents | 184 curated Claude Code personas |
| Ingestion workers | Cron-driven event monitors (customise for your domain) |

## Quick start

**Prerequisites:** macOS/Linux, Docker, Node 18+, pnpm, Telegram bot token

```bash
git clone https://github.com/your-org/ai-agent-stack
cd ai-agent-stack
bash setup.sh
```

The script asks for:
- Project name
- Your name (for audit log)
- Telegram bot token — create one with [@BotFather](https://t.me/BotFather)
- Your Telegram chat ID — send `/start` to your bot, then run `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"`
- A public HTTPS URL for the gate — use [ngrok](https://ngrok.com) locally: `ngrok http 4242`

## Telegram commands

| Command | Action |
|---------|--------|
| `/help` | Command list |
| `/status` | Open issues in Multica |
| `/logs` | Last 5 audit entries |
| `/new <title>` | Low-risk task — auto-approved, no notification |
| `/urgent <title>` | High-risk task — requires your approval |
| `<any text>` | Medium-risk task — requires your approval |

## Risk levels

| Label | Level | Action |
|-------|-------|--------|
| `risk:design`, `risk:schema`, `risk:deploy`, `risk:migration`, `risk:legal-review` | 🔴 high | Approval required |
| `risk:content`, `risk:copy`, `risk:config` | 🟡 medium | Approval required |
| _(no label)_ | ✅ low | Auto-approved silently |

## Customise for your project

**1. Change the agent instructions**
```bash
multica agent update <agent-id> --instructions "You work on MyApp. When assigned a task..."
```

**2. Add domain-specific personas**
Drop `.md` files into `~/.claude/agents/`. See `personas/` for examples.

**3. Add ingestion monitors**
Copy `ingestion/gazzetta-monitor.ts` as a template. Point it at your domain's data source (RSS, API, webhook). File Multica issues via `multica-issue.ts`.

**4. Add new risk labels**
```bash
multica label create --name "risk:payments" --color "#ef4444"
```
Then add the label to `approval-gate/src/risk.ts`.

## Architecture

```
tools/agent-stack/
├── setup.sh                  # one-shot installer
├── multica/
│   ├── up.sh / down.sh       # start/stop Docker stack
│   └── README.md             # operator runbook
├── approval-gate/            # TypeScript/Hono service
│   ├── src/
│   │   ├── index.ts          # entry point
│   │   ├── multica-client.ts # REST polling + issue operations
│   │   ├── telegram-commands.ts # two-way bot interface
│   │   ├── notifier.ts       # Telegram approval notifications
│   │   ├── server.ts         # /approve/:token  /reject/:token
│   │   ├── risk.ts           # label → risk level table
│   │   ├── audit.ts          # append-only JSONL audit log
│   │   └── config.ts         # Zod-validated env
│   └── .env.example
├── ingestion/                # cron-driven event monitors
│   ├── multica-issue.ts      # shared helper — file issues via REST
│   ├── gazzetta-monitor.ts   # RSS monitor (adapt for your domain)
│   └── crontab.example
└── personas/                 # custom Claude Code agents
    └── INDEX.md              # which agency-agents to use + custom ones
```

## Production deployment

For a permanent setup (no ngrok):

1. Deploy the approval gate on any VPS (`node dist/index.js` or Docker)
2. Put it behind nginx/caddy with a real TLS cert
3. Set `GATE_BASE_URL=https://gate.yourdomain.com` in `.env`
4. Run `multica daemon start` on the same machine as your codebase

## Deferred / bring your own

- ANAC / domain-specific scrapers (`ingestion/anac-bulletin-monitor.ts` is a stub)
- Multica token auto-refresh (current JWT expires in ~30 days)
- Multi-approver routing (one Telegram group, multiple chat IDs)
- Slack notifications (replace Telegram in `notifier.ts`)

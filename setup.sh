#!/usr/bin/env bash
# setup.sh — bootstrap the AI agent stack from scratch
# Usage: bash setup.sh
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

say()  { echo -e "${BOLD}==> $*${RESET}"; }
ok()   { echo -e "${GREEN}    ✓ $*${RESET}"; }
warn() { echo -e "${YELLOW}    ! $*${RESET}"; }

say "AI Agent Stack — setup"
echo ""

# ── 0. collect project config ──────────────────────────────────────────────
read -rp "Project name (e.g. MyApp):          " PROJECT_NAME
read -rp "Approver name (your first name):     " APPROVER_NAME
read -rp "Telegram bot token (from @BotFather):" TELEGRAM_BOT_TOKEN
read -rp "Telegram chat ID (your user ID):     " TELEGRAM_CHAT_ID
read -rp "Public HTTPS URL for the gate (ngrok/cloudflare, e.g. https://xyz.ngrok-free.app): " GATE_BASE_URL
read -rp "Gate port [4242]:                    " GATE_PORT
GATE_PORT="${GATE_PORT:-4242}"

echo ""

# ── 1. dependencies ─────────────────────────────────────────────────────────
say "Checking dependencies"

for cmd in docker node pnpm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Missing: $cmd — please install it and re-run."
    exit 1
  fi
done
ok "docker, node, pnpm present"

if ! command -v multica &>/dev/null; then
  say "Installing Multica CLI"
  brew install multica-ai/tap/multica 2>/dev/null || {
    warn "brew not available — install multica manually: https://docs.multica.ai"
    exit 1
  }
fi
ok "multica CLI: $(multica version 2>/dev/null || echo 'installed')"

# ── 2. Multica self-host ─────────────────────────────────────────────────────
say "Starting Multica self-host (Docker)"
INSTALL_DIR="$HOME/.multica-selfhost"
if [[ ! -d "$INSTALL_DIR" ]]; then
  MULTICA_INSTALL_DIR="$INSTALL_DIR" bash <(curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/install.sh) 2>/dev/null || true
fi

COMPOSE_FILE="$INSTALL_DIR/docker-compose.selfhost.yml"
if [[ -f "$COMPOSE_FILE" ]]; then
  # Remap frontend port to avoid clash with common dev servers
  sed -i.bak 's/FRONTEND_PORT=3000/FRONTEND_PORT=3010/' "$INSTALL_DIR/.env" 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" up -d
  ok "Multica backend running at http://localhost:8080"
else
  warn "docker-compose.selfhost.yml not found at $INSTALL_DIR — run the Multica installer manually first."
  exit 1
fi

# ── 3. authenticate Multica CLI ──────────────────────────────────────────────
say "Authenticating Multica CLI"
if [[ ! -f "$HOME/.multica/config.json" ]]; then
  echo ""
  echo "  Open http://localhost:3010 in your browser and log in."
  echo "  Then run: multica setup self-host"
  echo "  Press Enter when done."
  read -r
fi
ok "Multica CLI authenticated"

# ── 4. create workspace ──────────────────────────────────────────────────────
say "Creating Multica workspace"
SLUG=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
TOKEN=$(python3 -c "import json; print(json.load(open('$HOME/.multica/config.json'))['token'])" 2>/dev/null || echo "")
if [[ -z "$TOKEN" ]]; then
  warn "Could not read Multica token from ~/.multica/config.json"
  exit 1
fi

WS_RESP=$(curl -s -X POST http://localhost:8080/api/workspaces \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$PROJECT_NAME\",\"slug\":\"$SLUG\"}" 2>/dev/null)

WS_ID=$(echo "$WS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
if [[ -z "$WS_ID" ]]; then
  # Workspace might already exist — fetch it
  WS_ID=$(curl -s http://localhost:8080/api/workspaces \
    -H "Authorization: Bearer $TOKEN" | \
    python3 -c "import sys,json; ws=[w for w in json.load(sys.stdin) if w['slug']=='$SLUG']; print(ws[0]['id'] if ws else '')" 2>/dev/null || echo "")
fi
[[ -z "$WS_ID" ]] && { warn "Could not create/find workspace. Check Multica is running."; exit 1; }
ok "Workspace: $PROJECT_NAME ($WS_ID)"

# ── 5. create risk labels ────────────────────────────────────────────────────
say "Creating risk labels"
multica label create --name "risk:design"       --color "#ef4444" --output json > /dev/null 2>&1 || true
multica label create --name "risk:schema"       --color "#ef4444" --output json > /dev/null 2>&1 || true
multica label create --name "risk:deploy"       --color "#ef4444" --output json > /dev/null 2>&1 || true
multica label create --name "risk:migration"    --color "#ef4444" --output json > /dev/null 2>&1 || true
multica label create --name "risk:legal-review" --color "#ef4444" --output json > /dev/null 2>&1 || true
multica label create --name "risk:content"      --color "#f59e0b" --output json > /dev/null 2>&1 || true
multica label create --name "risk:copy"         --color "#f59e0b" --output json > /dev/null 2>&1 || true
multica label create --name "risk:config"       --color "#f59e0b" --output json > /dev/null 2>&1 || true
ok "Risk labels created"

# ── 6. start Multica daemon ──────────────────────────────────────────────────
say "Starting Multica daemon"
multica daemon start 2>/dev/null || true
sleep 2
CLAUDE_RUNTIME=$(multica runtime list --output json 2>/dev/null | \
  python3 -c "import sys,json; rs=[r for r in json.load(sys.stdin) if r['provider']=='claude']; print(rs[0]['id'] if rs else '')" 2>/dev/null || echo "")
[[ -z "$CLAUDE_RUNTIME" ]] && { warn "Claude runtime not found. Open Claude Code once and try again."; exit 1; }
ok "Claude Code runtime: $CLAUDE_RUNTIME"

# ── 7. create Multica agent ──────────────────────────────────────────────────
say "Creating Multica agent"

# Look for CLAUDE.md up to 3 directories above the script
CLAUDE_MD_CONTENT=""
SEARCH_DIR="$(cd "$(dirname "$0")" && pwd)"
for _ in 1 2 3; do
  if [[ -f "$SEARCH_DIR/CLAUDE.md" ]]; then
    CLAUDE_MD_CONTENT=$(cat "$SEARCH_DIR/CLAUDE.md")
    ok "Found CLAUDE.md at $SEARCH_DIR/CLAUDE.md — injecting into agent instructions"
    break
  fi
  SEARCH_DIR="$(dirname "$SEARCH_DIR")"
done

if [[ -n "$CLAUDE_MD_CONTENT" ]]; then
  AGENT_INSTRUCTIONS="You are an AI assistant working on the $PROJECT_NAME project.

When assigned a task, read the issue title and description carefully and complete the work using your available tools. When done, summarise what you did and what to verify. If you have a question, start your comment with '?' and a human will reply.

--- PROJECT INSTRUCTIONS (CLAUDE.md) ---
$CLAUDE_MD_CONTENT"
else
  AGENT_INSTRUCTIONS="You are an AI assistant working on the $PROJECT_NAME project. When assigned a task, read the issue title and description carefully and complete the work using your available tools. Follow project conventions in CLAUDE.md if it exists. When done, summarise what you did and what to verify. If you have a question, start your comment with '?' and a human will reply."
fi

AGENT_ID=$(multica agent create \
  --name "$PROJECT_NAME AI" \
  --runtime-id "$CLAUDE_RUNTIME" \
  --model "claude-sonnet-4-6" \
  --description "General-purpose agent for $PROJECT_NAME tasks" \
  --instructions "$AGENT_INSTRUCTIONS" \
  --visibility workspace \
  --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
[[ -z "$AGENT_ID" ]] && { warn "Could not create agent."; exit 1; }
ok "Agent: $PROJECT_NAME AI ($AGENT_ID)"

# ── 8. install agency-agents ─────────────────────────────────────────────────
say "Installing agency-agents (184 Claude Code personas)"
AGENTS_DIR="$HOME/.claude/agents"
if [[ ! -d "$AGENTS_DIR/backend-architect.md" ]]; then
  TMP=$(mktemp -d)
  git clone --depth 1 https://github.com/msitarzewski/agency-agents "$TMP/agency-agents" 2>/dev/null
  mkdir -p "$AGENTS_DIR"
  cp "$TMP/agency-agents/agents/"*.md "$AGENTS_DIR/" 2>/dev/null || true
  rm -rf "$TMP"
fi
ok "agency-agents installed to ~/.claude/agents/"

# ── 9. write approval gate .env ──────────────────────────────────────────────
say "Writing approval gate .env"
GATE_DIR="$(cd "$(dirname "$0")/approval-gate" && pwd)"
JWT_SECRET=$(openssl rand -hex 32)
cat > "$GATE_DIR/.env" <<ENV
MULTICA_URL=ws://localhost:8080/ws
MULTICA_HTTP_URL=http://localhost:8080
MULTICA_TOKEN=$TOKEN
MULTICA_WORKSPACE_ID=$WS_ID

TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID

APPROVER_NAME=$APPROVER_NAME
GATE_BASE_URL=$GATE_BASE_URL
GATE_PORT=$GATE_PORT

JWT_SECRET=$JWT_SECRET
MULTICA_AGENT_ID=$AGENT_ID
NODE_ENV=development
ENV
ok "Approval gate .env written"

# ── 10. install gate deps ─────────────────────────────────────────────────────
say "Installing approval gate dependencies"
(cd "$GATE_DIR" && pnpm install --silent)
ok "Dependencies installed"

# ── done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Setup complete!${RESET}"
echo ""
echo "  Start the approval gate:"
echo "    cd tools/agent-stack/approval-gate && node --import tsx/esm src/index.ts"
echo ""
echo "  Then message @$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['username'])" 2>/dev/null || echo 'your_bot') on Telegram:"
echo "    /help    — command list"
echo "    /status  — open issues"
echo "    /urgent  — high-risk task (triggers approval)"
echo "    <text>   — medium-risk task (triggers approval)"
echo ""
echo "  Multica dashboard: http://localhost:3010"
echo ""

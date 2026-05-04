import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { MulticaTask } from "./multica-client.js";
import type { RiskLevel } from "./risk.js";

const CONSUMED_PATH = join(import.meta.dirname, "..", "data", "consumed.json");

interface MagicLinkPayload {
  taskId: string;
  decision: "approve" | "reject";
  jti: string;
}

async function loadConsumed(): Promise<Set<string>> {
  try {
    const raw = await readFile(CONSUMED_PATH, "utf8");
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function persistConsumed(set: Set<string>): Promise<void> {
  await mkdir(join(import.meta.dirname, "..", "data"), { recursive: true });
  await writeFile(CONSUMED_PATH, JSON.stringify([...set]), "utf8");
}

export async function sendApprovalNotification(
  config: Config,
  task: MulticaTask,
  riskLevel: RiskLevel,
): Promise<void> {
  const secret = new TextEncoder().encode(config.JWT_SECRET);

  const makeToken = async (decision: "approve" | "reject") => {
    const jti = crypto.randomUUID();
    const payload: MagicLinkPayload = { taskId: task.id, decision, jti };
    return new SignJWT(payload as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .setJti(jti)
      .sign(secret);
  };

  const [approveToken, rejectToken] = await Promise.all([
    makeToken("approve"),
    makeToken("reject"),
  ]);

  const approveUrl = `${config.GATE_BASE_URL}/approve/${approveToken}`;
  const rejectUrl = `${config.GATE_BASE_URL}/reject/${rejectToken}`;

  const lastComment = task.description ?? "(no description)";
  const persona = task.assignee ?? "unassigned";
  const labelNames = (task.labels ?? []).map((l) => l.name).join(", ") || "none";
  const riskEmoji = riskLevel === "high" ? "🔴" : "🟡";

  const text = [
    `${riskEmoji} <b>[Appaltami][${riskLevel.toUpperCase()}]</b>`,
    ``,
    `<b>${escTg(task.title)}</b>`,
    `Assigned to: <code>${escTg(persona)}</code>`,
    `Labels: <code>${escTg(labelNames)}</code>`,
    ``,
    `<b>Description:</b>`,
    escTg(lastComment.slice(0, 400)),
    ``,
    `Links expire in 24 h and are single-use.`,
  ].join("\n");

  const res = await fetch(
    `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "Approve", url: approveUrl },
            { text: "Reject", url: rejectUrl },
          ]],
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

export async function verifyMagicToken(
  config: Config,
  token: string,
): Promise<MagicLinkPayload> {
  const secret = new TextEncoder().encode(config.JWT_SECRET);
  let payload: MagicLinkPayload;
  try {
    const { payload: raw } = await jwtVerify(token, secret);
    payload = raw as unknown as MagicLinkPayload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw new Error("token expired");
    throw new Error("invalid token");
  }

  const consumed = await loadConsumed();
  if (consumed.has(payload.jti)) throw new Error("token already used");

  consumed.add(payload.jti);
  await persistConsumed(consumed);
  return payload;
}

// Telegram HTML escaping (only <, >, & need escaping in HTML parse_mode)
function escTg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Watches two things:
 * 1. MULTICA_TOKEN JWT expiry — warns via Telegram when < WARN_DAYS remaining
 * 2. Gate health — sends Telegram alert if the Multica poll stays unhealthy > UNHEALTHY_GRACE_MS
 */
import type { Config } from "./config.js";
import type { MulticaClient } from "./multica-client.js";

const WARN_DAYS = 7;
const UNHEALTHY_GRACE_MS = 2 * 60 * 1_000; // 2 minutes
const CHECK_INTERVAL_MS = 60 * 60 * 1_000;  // re-check every hour

function jwtExp(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString()) as { exp?: number };
    return payload.exp ?? null;
  } catch {
    return null;
  }
}

async function sendTelegram(config: Config, text: string) {
  await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

export function startTokenWatchdog(config: Config, multica: MulticaClient) {
  const exp = jwtExp(config.MULTICA_TOKEN);
  let unhealthySince: number | null = null;
  let expWarnedAt = 0;

  async function check() {
    const now = Date.now();

    // ── JWT expiry ────────────────────────────────────────────────────────────
    if (exp !== null) {
      const msTillExpiry = exp * 1_000 - now;
      const daysTillExpiry = msTillExpiry / (1_000 * 60 * 60 * 24);
      if (daysTillExpiry < WARN_DAYS && now - expWarnedAt > 24 * 60 * 60 * 1_000) {
        expWarnedAt = now;
        const d = Math.max(0, Math.floor(daysTillExpiry));
        await sendTelegram(
          config,
          `⚠️ <b>Gate: Multica token expires in ${d} day${d === 1 ? "" : "s"}</b>\n\n` +
          `Re-authenticate:\n<code>multica setup self-host</code>\n` +
          `Then update <code>MULTICA_TOKEN</code> in <code>.env</code> and restart the gate.`,
        ).catch(() => {});
        console.warn(`[watchdog] Multica token expires in ${d} days`);
      }
    }

    // ── Gate health ───────────────────────────────────────────────────────────
    if (!multica.isConnected()) {
      if (unhealthySince === null) {
        unhealthySince = now;
      } else if (now - unhealthySince > UNHEALTHY_GRACE_MS) {
        await sendTelegram(
          config,
          `🔴 <b>Gate is unhealthy</b>\n\nMultica poll has been failing for &gt;2 minutes. ` +
          `Check the gate process and Multica backend (<code>http://localhost:8080/health</code>).`,
        ).catch(() => {});
        unhealthySince = now; // rate-limit: don't spam, reset timer
      }
    } else {
      unhealthySince = null;
    }
  }

  // Run immediately, then on interval
  check().catch(() => {});
  return setInterval(() => check().catch(() => {}), CHECK_INTERVAL_MS);
}

import "dotenv/config";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { MulticaClient } from "./multica-client.js";
import { classifyRisk } from "./risk.js";
import { sendApprovalNotification } from "./notifier.js";
import { writeAudit } from "./audit.js";
import { buildServer } from "./server.js";
import { TelegramCommandHandler } from "./telegram-commands.js";
import { startTokenWatchdog } from "./token-watchdog.js";
import { startCompletionMonitor } from "./completion-monitor.js";

const config = loadConfig();
const multica = new MulticaClient(config);

multica.onTask(async (task) => {
  const riskLevel = classifyRisk((task.labels ?? []).map((l) => l.name));
  if (riskLevel === "low") return;

  const auditId = crypto.randomUUID();
  try {
    await sendApprovalNotification(config, task, riskLevel);
    await writeAudit({ ts: new Date().toISOString(), taskId: task.id, decision: "sent", actor: "gate", auditId });
    console.log(`[gate] approval notification sent — task=${task.id} risk=${riskLevel}`);
  } catch (err) {
    console.error("[gate] failed to send approval notification", err);
  }
});

multica.connect();

const bot = new TelegramCommandHandler(config, multica);
bot.start();

const watchdogTimer = startTokenWatchdog(config, multica);
const completionMonitor = startCompletionMonitor(config, multica);

const server = buildServer(config, multica);
const port = config.GATE_PORT;
serve({ fetch: server.fetch, port }, () => {
  console.log(`[gate] approval gate running on :${port}`);
});

async function shutdown(signal: string) {
  console.log(`[gate] ${signal} received — shutting down`);
  bot.stop();
  multica.close();
  completionMonitor.stop();
  clearInterval(watchdogTimer);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

import type { Config } from "./config.js";
import type { MulticaClient, MulticaTask } from "./multica-client.js";
import type { RiskLevel } from "./risk.js";
import { classifyRisk } from "./risk.js";
import { sendApprovalNotification } from "./notifier.js";
import { writeAudit } from "./audit.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

const AUDIT_PATH = join(import.meta.dirname, "..", "data", "audit.log");

const HELP_TEXT = [
  "<b>AI Agent Bot</b>",
  "",
  "Commands:",
  "  /status — list open Multica issues",
  "  /new &lt;title&gt; — create issue (auto-approves, low risk)",
  "  /urgent &lt;title&gt; — create high-risk issue (triggers approval)",
  "  /reply &lt;issueId&gt; &lt;answer&gt; — answer a question the agent asked",
  "  /logs — last 5 audit entries",
  "  /help — this message",
  "",
  "Or just send any text to create a medium-risk issue.",
].join("\n");

export class TelegramCommandHandler {
  private offset = 0;
  private closed = false;

  constructor(
    private config: Config,
    private multica: MulticaClient,
  ) {
    // Forward agent questions to Telegram
    this.multica.onQuestion(async (issueId, identifier, _commentId, question) => {
      await this.reply(
        Number(this.config.TELEGRAM_CHAT_ID),
        `🤖 <b>${escTg(identifier)}</b> — agent has a question:\n\n${escTg(question)}\n\n` +
        `Reply with:\n<code>/reply ${escTg(issueId)} your answer here</code>`,
      ).catch((err) => console.error("[bot] failed to forward question", (err as Error).message));
    });
  }

  start() {
    this.scheduleNext(0);
  }

  stop() {
    this.closed = true;
  }

  private scheduleNext(delayMs: number) {
    if (this.closed) return;
    setTimeout(() => this.runPoll(), delayMs);
  }

  private async runPoll() {
    if (this.closed) return;
    try {
      await this.fetchUpdates();
      this.scheduleNext(500);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      console.error("[bot] poll error", msg);
      // exponential backoff capped at 30 s
      this.backoff = Math.min((this.backoff ?? 2_000) * 2, 30_000);
      this.scheduleNext(this.backoff);
    }
  }

  private backoff = 2_000;

  private async fetchUpdates() {
    const url =
      `https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/getUpdates` +
      `?offset=${this.offset}&timeout=10&allowed_updates=${encodeURIComponent('["message"]')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`getUpdates ${res.status}`);
    this.backoff = 2_000; // reset on success
    const data = (await res.json()) as { ok: boolean; result: TgUpdate[] };
    for (const update of data.result) {
      this.offset = update.update_id + 1;
      if (update.message?.text && update.message.chat.id === Number(this.config.TELEGRAM_CHAT_ID)) {
        await this.handle(update.message).catch((err) =>
          console.error("[bot] handler error", (err as Error).message),
        );
      }
    }
  }

  private async handle(msg: TgMessage) {
    const text = (msg.text ?? "").trim();
    const chatId = msg.chat.id;
    console.log(`[bot] command from ${chatId}: ${text.slice(0, 60)}`);

    if (text === "/help" || text === "/start") {
      return this.reply(chatId, HELP_TEXT);
    }

    if (text === "/status") {
      return this.handleStatus(chatId);
    }

    if (text === "/logs") {
      return this.handleLogs(chatId);
    }

    if (text.startsWith("/reply ")) {
      const parts = text.slice(7).trim().split(/\s+/);
      const issueId = parts[0];
      const answer = parts.slice(1).join(" ");
      if (!issueId || !answer) return this.reply(chatId, "Usage: /reply &lt;issueId&gt; &lt;your answer&gt;");
      try {
        await this.multica.commentOnTask(issueId, `Answer from ${this.config.APPROVER_NAME}: ${answer}`);
        return this.reply(chatId, `Reply posted to issue ${escTg(issueId.slice(0, 8))}.`);
      } catch (err) {
        return this.reply(chatId, `Failed: ${escTg((err as Error).message)}`);
      }
    }

    if (text.startsWith("/new ") || text.startsWith("/new\n")) {
      const title = text.slice(5).trim();
      if (!title) return this.reply(chatId, "Usage: /new &lt;issue title&gt;");
      return this.createIssue(chatId, title, []);
    }

    if (text.startsWith("/urgent ") || text.startsWith("/urgent\n")) {
      const title = text.slice(8).trim();
      if (!title) return this.reply(chatId, "Usage: /urgent &lt;issue title&gt;");
      return this.createIssue(chatId, title, ["risk:design"]);
    }

    if (text.startsWith("/")) {
      return this.reply(chatId, "Unknown command. Send /help for the list.");
    }

    // Free text → medium-risk issue
    return this.createIssue(chatId, text.slice(0, 200), ["risk:content"]);
  }

  private async handleStatus(chatId: number) {
    const issues = await this.multica.listOpenIssues();
    if (issues.length === 0) {
      return this.reply(chatId, "No open issues.");
    }
    const lines = issues.map((i) => {
      const labels = (i.labels ?? []).map((l) => l.name).join(", ") || "—";
      return `• <b>${escTg(i.identifier)}</b> [${i.status}] ${escTg(i.title)}\n  labels: ${escTg(labels)}`;
    });
    return this.reply(chatId, `<b>Open issues (${issues.length})</b>\n\n${lines.join("\n\n")}`);
  }

  private async handleLogs(chatId: number) {
    let raw: string;
    try {
      raw = await readFile(AUDIT_PATH, "utf8");
    } catch {
      return this.reply(chatId, "No audit log yet.");
    }
    const lines = raw.trim().split("\n").filter(Boolean);
    const last5 = lines.slice(-5).reverse();
    const entries = last5.map((l) => {
      try {
        const e = JSON.parse(l) as { ts: string; taskId: string; decision: string; actor: string };
        const time = new Date(e.ts).toLocaleTimeString("it-IT", { timeZone: "Europe/Rome" });
        return `• ${time} — <b>${e.decision}</b> by ${escTg(e.actor)} (${e.taskId.slice(0, 8)})`;
      } catch {
        return `• ${escTg(l.slice(0, 80))}`;
      }
    });
    return this.reply(chatId, `<b>Last audit entries</b>\n\n${entries.join("\n")}`);
  }

  private async createIssue(chatId: number, title: string, labelNames: string[]) {
    let issue: MulticaTask;
    try {
      issue = await this.multica.createIssue(title, labelNames);
    } catch (err) {
      await this.reply(chatId, `Failed to create issue: ${escTg((err as Error).message)}`);
      return;
    }

    // Labels aren't in the creation response — use the known labelNames directly
    const riskLevel: RiskLevel = classifyRisk(labelNames);
    const issueWithLabels = { ...issue, labels: labelNames.map((name) => ({ id: "", name })) };

    const riskNote = riskLevel !== "low" ? ` — awaiting approval` : ` (auto-approved)`;
    await this.reply(
      chatId,
      `Issue created: <b>${escTg(issue.identifier)}</b>${escTg(riskNote)}\n${escTg(issue.title)}`,
    );

    // Mark as notified so the poll doesn't double-send, then fire notification directly
    this.multica.markNotified(issue.id);
    if (riskLevel !== "low") {
      const auditId = crypto.randomUUID();
      try {
        await sendApprovalNotification(this.config, issueWithLabels, riskLevel);
        await writeAudit({ ts: new Date().toISOString(), taskId: issue.id, decision: "sent", actor: "gate", auditId });
        console.log(`[gate] approval notification sent — task=${issue.id} risk=${riskLevel}`);
      } catch (err) {
        console.error("[gate] failed to send approval notification", err);
      }
    }
  }

  private async reply(chatId: number, text: string) {
    await fetch(`https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  }
}

function escTg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

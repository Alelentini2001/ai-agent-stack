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

interface TgCallbackQuery {
  id: string;
  from: { id: number };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

const AUDIT_PATH = join(import.meta.dirname, "..", "data", "audit.log");

const HELP_TEXT = [
  "<b>🤖 AI Agent Bot</b>",
  "",
  "<b>Task management:</b>",
  "  /new &lt;title&gt;              — create task (auto-approved, low risk)",
  "  /urgent &lt;title&gt;           — high-risk task (triggers approval)",
  "  /cancel &lt;id&gt;              — cancel a task",
  "  /assign &lt;id&gt;              — assign task to agent now",
  "  /comment &lt;id&gt; &lt;text&gt;     — add a comment",
  "  /label &lt;id&gt; &lt;label&gt;      — add a risk label",
  "  /reply &lt;id&gt; &lt;answer&gt;     — answer an agent question",
  "",
  "<b>Monitoring:</b>",
  "  /status                   — all open &amp; in-progress tasks",
  "  /progress                 — only in-progress (agent working now)",
  "  /done                     — last 10 completed tasks",
  "  /logs                     — last 5 audit entries",
  "  /ping                     — gate + Multica health check",
  "",
  "Or just send <b>any text</b> to create a medium-risk task.",
].join("\n");

export class TelegramCommandHandler {
  private offset = 0;
  private closed = false;
  private backoff = 2_000;

  constructor(
    private config: Config,
    private multica: MulticaClient,
  ) {
    // Forward agent questions to Telegram
    this.multica.onQuestion(async (issueId, identifier, _commentId, question) => {
      await this.send(
        Number(this.config.TELEGRAM_CHAT_ID),
        `🤖 <b>${escTg(identifier)}</b> — agent has a question:\n\n${escTg(question)}\n\n` +
        `Reply with:\n<code>/reply ${escTg(issueId)} your answer here</code>`,
      ).catch((err) => console.error("[bot] failed to forward question", (err as Error).message));
    });
  }

  start() { this.scheduleNext(0); }
  stop()  { this.closed = true; }

  private scheduleNext(delayMs: number) {
    if (this.closed) return;
    setTimeout(() => this.runPoll(), delayMs);
  }

  private async runPoll() {
    if (this.closed) return;
    try {
      await this.fetchUpdates();
      this.backoff = 2_000;
      this.scheduleNext(500);
    } catch (err) {
      console.error("[bot] poll error", (err as Error).message ?? String(err));
      this.backoff = Math.min(this.backoff * 2, 30_000);
      this.scheduleNext(this.backoff);
    }
  }

  private async fetchUpdates() {
    const url =
      `https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/getUpdates` +
      `?offset=${this.offset}&timeout=10` +
      `&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`getUpdates ${res.status}`);
    const data = (await res.json()) as { ok: boolean; result: TgUpdate[] };
    const myChatId = Number(this.config.TELEGRAM_CHAT_ID);

    for (const update of data.result) {
      this.offset = update.update_id + 1;

      if (update.callback_query) {
        const cq = update.callback_query;
        const fromId = cq.from.id;
        if (fromId === myChatId || cq.message?.chat.id === myChatId) {
          await this.handleCallback(cq).catch((err) =>
            console.error("[bot] callback error", (err as Error).message),
          );
        }
      } else if (update.message?.text && update.message.chat.id === myChatId) {
        await this.handleMessage(update.message).catch((err) =>
          console.error("[bot] handler error", (err as Error).message),
        );
      }
    }
  }

  // ── Callback query handler (inline approve/reject buttons) ────────────────

  private async handleCallback(query: TgCallbackQuery) {
    const chatId = query.message?.chat.id ?? Number(this.config.TELEGRAM_CHAT_ID);
    const messageId = query.message?.message_id;
    const data = query.data ?? "";

    // Always answer the callback to dismiss the loading spinner
    await this.answerCallback(query.id);

    if (!data.startsWith("approve:") && !data.startsWith("reject:") && data !== "noop") {
      return;
    }
    if (data === "noop") return;

    const colonIdx = data.indexOf(":");
    const decision = data.slice(0, colonIdx) as "approve" | "reject";
    const taskId = data.slice(colonIdx + 1);

    const auditId = crypto.randomUUID();
    const ts = new Date().toISOString();
    const actor = this.config.APPROVER_NAME;

    try {
      if (decision === "approve") {
        await this.multica.claimTask(taskId);
      } else {
        await this.multica.cancelTask(taskId);
      }
      const verb = decision === "approve" ? "Approved" : "Rejected";
      const emoji = decision === "approve" ? "✅" : "❌";
      await this.multica.commentOnTask(
        taskId,
        `${emoji} ${verb} by ${actor} via Telegram at ${ts} (audit: ${auditId})`,
      );
      await writeAudit({
        ts,
        taskId,
        decision: decision === "approve" ? "approved" : "rejected",
        actor,
        ip: "telegram-callback",
        userAgent: "telegram-bot",
        auditId,
      });

      // Replace the inline keyboard with a single "done" row
      if (messageId) {
        await this.editKeyboard(chatId, messageId, [
          [{ text: `${emoji} ${verb} by ${actor}`, callback_data: "noop" }],
        ]);
      }
      console.log(`[bot] ${decision} via Telegram callback — ${taskId.slice(0, 8)}`);
    } catch (err) {
      await this.send(chatId, `⚠️ Failed: ${escTg((err as Error).message)}`);
    }
  }

  // ── Text command handler ──────────────────────────────────────────────────

  private async handleMessage(msg: TgMessage) {
    const text = (msg.text ?? "").trim();
    const chatId = msg.chat.id;
    console.log(`[bot] command: ${text.slice(0, 60)}`);

    if (text === "/help" || text === "/start") {
      return this.send(chatId, HELP_TEXT);
    }

    if (text === "/status") return this.handleStatus(chatId);
    if (text === "/progress" || text === "/wip") return this.handleProgress(chatId);
    if (text === "/done") return this.handleDone(chatId);
    if (text === "/logs") return this.handleLogs(chatId);
    if (text === "/ping") return this.handlePing(chatId);

    if (text.startsWith("/new ") || text === "/new") {
      const title = text.slice(5).trim();
      if (!title) return this.send(chatId, "Usage: /new &lt;issue title&gt;");
      return this.createIssueFlow(chatId, title, []);
    }

    if (text.startsWith("/urgent ") || text === "/urgent") {
      const title = text.slice(8).trim();
      if (!title) return this.send(chatId, "Usage: /urgent &lt;issue title&gt;");
      return this.createIssueFlow(chatId, title, ["risk:design"]);
    }

    if (text.startsWith("/cancel ")) {
      const id = text.slice(8).trim();
      if (!id) return this.send(chatId, "Usage: /cancel &lt;issueId or APP-12&gt;");
      return this.handleCancel(chatId, id);
    }

    if (text.startsWith("/assign ")) {
      const id = text.slice(8).trim();
      if (!id) return this.send(chatId, "Usage: /assign &lt;issueId or APP-12&gt;");
      return this.handleAssign(chatId, id);
    }

    if (text.startsWith("/comment ")) {
      const rest = text.slice(9).trim();
      const spaceIdx = rest.search(/\s/);
      if (spaceIdx === -1) return this.send(chatId, "Usage: /comment &lt;id&gt; &lt;text&gt;");
      const id = rest.slice(0, spaceIdx);
      const comment = rest.slice(spaceIdx + 1).trim();
      return this.handleComment(chatId, id, comment);
    }

    if (text.startsWith("/label ")) {
      const parts = text.slice(7).trim().split(/\s+/);
      if (parts.length < 2) return this.send(chatId, "Usage: /label &lt;id&gt; &lt;labelName&gt;");
      return this.handleLabel(chatId, parts[0]!, parts.slice(1).join(" "));
    }

    if (text.startsWith("/reply ")) {
      const rest = text.slice(7).trim();
      const spaceIdx = rest.search(/\s/);
      if (spaceIdx === -1) return this.send(chatId, "Usage: /reply &lt;id&gt; &lt;your answer&gt;");
      const id = rest.slice(0, spaceIdx);
      const answer = rest.slice(spaceIdx + 1).trim();
      return this.handleReply(chatId, id, answer);
    }

    if (text.startsWith("/")) {
      return this.send(chatId, "Unknown command. Send /help for the list.");
    }

    // Free text → medium-risk issue
    return this.createIssueFlow(chatId, text.slice(0, 200), ["risk:content"]);
  }

  // ── Command implementations ───────────────────────────────────────────────

  private async handleStatus(chatId: number) {
    const [todo, wip] = await Promise.all([
      this.multica.listIssuesByStatus(["todo"]),
      this.multica.listIssuesByStatus(["in_progress"]),
    ]);
    if (!todo.length && !wip.length) {
      return this.send(chatId, "✅ No open or in-progress tasks.");
    }
    const lines: string[] = [];
    if (wip.length) {
      lines.push(`<b>🔄 In progress (${wip.length})</b>`);
      lines.push(...wip.map((i) => this.formatIssue(i)));
      lines.push("");
    }
    if (todo.length) {
      lines.push(`<b>📋 Pending (${todo.length})</b>`);
      lines.push(...todo.map((i) => this.formatIssue(i)));
    }
    return this.send(chatId, lines.join("\n"));
  }

  private async handleProgress(chatId: number) {
    const issues = await this.multica.listIssuesByStatus(["in_progress"]);
    if (!issues.length) return this.send(chatId, "No tasks in progress right now.");
    const lines = [`<b>🔄 In progress (${issues.length})</b>`, ...issues.map((i) => this.formatIssue(i))];
    return this.send(chatId, lines.join("\n"));
  }

  private async handleDone(chatId: number) {
    const issues = await this.multica.listIssuesByStatus(["done"]);
    if (!issues.length) return this.send(chatId, "No completed tasks yet.");
    const last10 = issues.slice(-10).reverse();
    const lines = [`<b>✅ Recently completed (${last10.length})</b>`, ...last10.map((i) => this.formatIssue(i))];
    return this.send(chatId, lines.join("\n"));
  }

  private async handlePing(chatId: number) {
    const ok = this.multica.isConnected();
    const uptime = Math.floor(process.uptime());
    const mins = Math.floor(uptime / 60);
    const secs = uptime % 60;
    const status = ok ? "🟢 Gate + Multica healthy" : "🔴 Multica poll unhealthy";
    return this.send(
      chatId,
      `${status}\nUptime: ${mins}m ${secs}s\nGate: <code>${this.config.GATE_BASE_URL}</code>`,
    );
  }

  private async handleCancel(chatId: number, idOrIdentifier: string) {
    const issue = await this.resolveIssue(chatId, idOrIdentifier);
    if (!issue) return;
    try {
      await this.multica.cancelTask(issue.id);
      await this.multica.commentOnTask(issue.id, `❌ Cancelled by ${this.config.APPROVER_NAME} via Telegram`);
      return this.send(chatId, `❌ Cancelled: <b>${escTg(issue.identifier)}</b> — ${escTg(issue.title)}`);
    } catch (err) {
      return this.send(chatId, `Failed: ${escTg((err as Error).message)}`);
    }
  }

  private async handleAssign(chatId: number, idOrIdentifier: string) {
    const issue = await this.resolveIssue(chatId, idOrIdentifier);
    if (!issue) return;
    try {
      await this.multica.claimTask(issue.id);
      await this.multica.commentOnTask(issue.id, `🤖 Manually assigned by ${this.config.APPROVER_NAME} via Telegram`);
      return this.send(chatId, `🤖 Assigned to agent: <b>${escTg(issue.identifier)}</b> — ${escTg(issue.title)}`);
    } catch (err) {
      return this.send(chatId, `Failed: ${escTg((err as Error).message)}`);
    }
  }

  private async handleComment(chatId: number, idOrIdentifier: string, comment: string) {
    const issue = await this.resolveIssue(chatId, idOrIdentifier);
    if (!issue) return;
    try {
      await this.multica.commentOnTask(issue.id, `${this.config.APPROVER_NAME}: ${comment}`);
      return this.send(chatId, `💬 Comment posted on <b>${escTg(issue.identifier)}</b>.`);
    } catch (err) {
      return this.send(chatId, `Failed: ${escTg((err as Error).message)}`);
    }
  }

  private async handleLabel(chatId: number, idOrIdentifier: string, labelName: string) {
    const issue = await this.resolveIssue(chatId, idOrIdentifier);
    if (!issue) return;
    try {
      await this.multica.addLabel(issue.id, labelName);
      return this.send(chatId, `🏷️ Label <code>${escTg(labelName)}</code> added to <b>${escTg(issue.identifier)}</b>.`);
    } catch (err) {
      return this.send(chatId, `Failed: ${escTg((err as Error).message)}`);
    }
  }

  private async handleReply(chatId: number, idOrIdentifier: string, answer: string) {
    const issue = await this.resolveIssue(chatId, idOrIdentifier);
    if (!issue) return;
    try {
      await this.multica.commentOnTask(issue.id, `Answer from ${this.config.APPROVER_NAME}: ${answer}`);
      return this.send(chatId, `✅ Reply posted on <b>${escTg(issue.identifier)}</b>.`);
    } catch (err) {
      return this.send(chatId, `Failed: ${escTg((err as Error).message)}`);
    }
  }

  private async handleLogs(chatId: number) {
    let raw: string;
    try {
      raw = await readFile(AUDIT_PATH, "utf8");
    } catch {
      return this.send(chatId, "No audit log yet.");
    }
    const lines = raw.trim().split("\n").filter(Boolean);
    const last5 = lines.slice(-5).reverse();
    const entries = last5.map((l) => {
      try {
        const e = JSON.parse(l) as { ts: string; taskId: string; decision: string; actor: string };
        const time = new Date(e.ts).toLocaleTimeString("it-IT", { timeZone: "Europe/Rome" });
        return `• ${time} — <b>${escTg(e.decision)}</b> by ${escTg(e.actor)} (<code>${e.taskId.slice(0, 8)}</code>)`;
      } catch {
        return `• ${escTg(l.slice(0, 80))}`;
      }
    });
    return this.send(chatId, `<b>Last audit entries</b>\n\n${entries.join("\n")}`);
  }

  // ── Issue creation flow ───────────────────────────────────────────────────

  private async createIssueFlow(chatId: number, title: string, labelNames: string[]) {
    let issue: MulticaTask;
    try {
      issue = await this.multica.createIssue(title, labelNames);
    } catch (err) {
      await this.send(chatId, `Failed to create issue: ${escTg((err as Error).message)}`);
      return;
    }

    const riskLevel: RiskLevel = classifyRisk(labelNames);
    const issueWithLabels = { ...issue, labels: labelNames.map((name) => ({ id: "", name })) };
    const riskNote = riskLevel !== "low" ? ` — awaiting approval` : ` (auto-approved)`;

    await this.send(
      chatId,
      `✅ Issue created: <b>${escTg(issue.identifier)}</b>${escTg(riskNote)}\n${escTg(issue.title)}`,
    );

    this.multica.markNotified(issue.id);
    if (riskLevel !== "low") {
      const auditId = crypto.randomUUID();
      try {
        await sendApprovalNotification(this.config, issueWithLabels, riskLevel);
        await writeAudit({ ts: new Date().toISOString(), taskId: issue.id, decision: "sent", actor: "gate", auditId });
      } catch (err) {
        console.error("[gate] failed to send approval notification", err);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async resolveIssue(chatId: number, idOrIdentifier: string): Promise<MulticaTask | null> {
    let issue: MulticaTask | null = null;
    try {
      issue = await this.multica.getIssue(idOrIdentifier);
    } catch (err) {
      await this.send(chatId, `Error looking up issue: ${escTg((err as Error).message)}`);
      return null;
    }
    if (!issue) {
      await this.send(chatId, `Issue not found: <code>${escTg(idOrIdentifier)}</code>`);
      return null;
    }
    return issue;
  }

  private formatIssue(i: MulticaTask): string {
    const labels = (i.labels ?? []).map((l) => l.name).join(", ") || "—";
    return `• <b>${escTg(i.identifier)}</b> ${escTg(i.title)}\n  <code>${escTg(labels)}</code>`;
  }

  private async send(chatId: number, text: string) {
    await fetch(`https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  }

  private async answerCallback(callbackQueryId: string) {
    await fetch(`https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  }

  private async editKeyboard(
    chatId: number,
    messageId: number,
    inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>,
  ) {
    await fetch(`https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
    });
  }
}

function escTg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

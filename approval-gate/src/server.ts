import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "./config.js";
import type { MulticaClient } from "./multica-client.js";
import { verifyMagicToken } from "./notifier.js";
import { writeAudit } from "./audit.js";
import { classifyRisk, getRiskLabels } from "./risk.js";
import { sendApprovalNotification } from "./notifier.js";

export function buildServer(config: Config, multica: MulticaClient): Hono {
  const app = new Hono();

  // ── Health ────────────────────────────────────────────────────────────────
  app.get("/healthz", (c) => {
    const ok = multica.isConnected();
    const staleSend =
      multica.lastSuccessfulSendAt !== null &&
      Date.now() - multica.lastSuccessfulSendAt > 24 * 60 * 60 * 1_000;
    if (!ok) return c.json({ status: "degraded", reason: "multica_poll_down" }, 503);
    if (staleSend) return c.json({ status: "degraded", reason: "no_send_24h" }, 503);
    return c.json({ status: "ok", uptime: process.uptime() });
  });

  // ── Approve / Reject magic links ─────────────────────────────────────────
  const handleDecision = (decision: "approved" | "rejected") => async (c: Context) => {
    const token = c.req.param("token") ?? "";
    const ip = c.req.header("x-forwarded-for") ?? "unknown";
    const ua = c.req.header("user-agent") ?? "unknown";

    let payload: Awaited<ReturnType<typeof verifyMagicToken>>;
    try {
      payload = await verifyMagicToken(config, token);
    } catch (err) {
      return c.text((err as Error).message, 400);
    }

    const auditId = crypto.randomUUID();
    await writeAudit({ ts: new Date().toISOString(), taskId: payload.taskId, decision, actor: config.APPROVER_NAME, ip, userAgent: ua, auditId });

    const ts = new Date().toISOString();
    const comment =
      decision === "approved"
        ? `✅ Approved by ${config.APPROVER_NAME} at ${ts} (audit: ${auditId})`
        : `❌ Rejected by ${config.APPROVER_NAME} at ${ts} (audit: ${auditId})`;

    try {
      if (decision === "approved") {
        await multica.claimTask(payload.taskId);
      } else {
        await multica.cancelTask(payload.taskId);
      }
      await multica.commentOnTask(payload.taskId, comment);
    } catch (err) {
      console.error("[gate] multica API error", err);
      return c.text("gateway error — action recorded in audit log", 502);
    }

    return c.html(`<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb}
.card{text-align:center;padding:2rem;border-radius:1rem;box-shadow:0 4px 24px #0001;background:#fff}
h1{font-size:2rem;margin:0 0 .5rem}p{color:#6b7280;margin:0}</style></head>
<body><div class="card">
<h1>${decision === "approved" ? "✅" : "❌"} Task ${decision}</h1>
<p>You may close this tab.</p>
</div></body></html>`);
  };

  app.get("/approve/:token", handleDecision("approved"));
  app.get("/reject/:token", handleDecision("rejected"));

  // ── Generic webhook — file a Multica issue from any HTTP event source ─────
  // Usage:  POST /webhook  (with X-Webhook-Secret header if WEBHOOK_SECRET is set)
  // Body:   { "title": "...", "description": "...", "labels": ["risk:content"] }
  //         OR just { "text": "plain description" } — gate extracts title from first line
  app.post("/webhook", async (c) => {
    if (config.WEBHOOK_SECRET) {
      const sig = c.req.header("x-webhook-secret") ?? c.req.header("authorization")?.replace("Bearer ", "");
      if (sig !== config.WEBHOOK_SECRET) return c.json({ error: "unauthorized" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json() as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    // Normalise payload: support {title,description,labels} or plain {text}
    let title: string;
    let description: string;
    let labels: string[];

    if (typeof body.text === "string") {
      const lines = body.text.trim().split("\n");
      title = (lines[0] ?? "").slice(0, 200);
      description = body.text;
      labels = ["risk:content"];
    } else {
      title = String(body.title ?? "Webhook event").slice(0, 200);
      description = String(body.description ?? "");
      labels = Array.isArray(body.labels) ? (body.labels as string[]) : ["risk:content"];
    }

    try {
      const issue = await multica.createIssue(title, labels, description);
      const riskLevel = classifyRisk(labels);
      multica.markNotified(issue.id);

      if (riskLevel !== "low") {
        const issueWithLabels = { ...issue, labels: labels.map((name) => ({ id: "", name })) };
        const auditId = crypto.randomUUID();
        await sendApprovalNotification(config, issueWithLabels, riskLevel);
        await writeAudit({ ts: new Date().toISOString(), taskId: issue.id, decision: "sent", actor: "webhook", auditId });
      }

      return c.json({ ok: true, issueId: issue.id, identifier: issue.identifier, riskLevel });
    } catch (err) {
      console.error("[webhook] error", err);
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  // ── Risk config introspection ─────────────────────────────────────────────
  app.get("/config/risk", (c) => c.json(getRiskLabels()));

  return app;
}

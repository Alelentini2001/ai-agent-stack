/**
 * Polls for issues that the agent just finished (status → done or in_review).
 * Sends a Telegram summary with the agent's final comment.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { MulticaClient, MulticaTask } from "./multica-client.js";

const POLL_MS = 20_000;
const DONE_PATH = join(import.meta.dirname, "..", "data", "notified-completions.json");

async function loadDone(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse(await readFile(DONE_PATH, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}

async function persistDone(set: Set<string>) {
  await mkdir(join(import.meta.dirname, "..", "data"), { recursive: true });
  await writeFile(DONE_PATH, JSON.stringify([...set]), "utf8");
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notify(config: Config, issue: MulticaTask & { identifier: string }, summary: string) {
  const emoji = issue.status === "done" ? "✅" : "🔍";
  const label = issue.status === "done" ? "Done" : "Ready for review";
  const text = [
    `${emoji} <b>${esc(issue.identifier)} — ${label}</b>`,
    ``,
    `<b>${esc(issue.title)}</b>`,
    ``,
    `<b>Agent summary:</b>`,
    esc(summary.slice(0, 600)),
    summary.length > 600 ? `\n<i>…(truncated)</i>` : "",
  ].join("\n");

  await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
}

export function startCompletionMonitor(config: Config, multica: MulticaClient) {
  let closed = false;

  async function poll() {
    if (closed) return;
    try {
      const issues = await multica.listIssuesByStatus(["done", "in_review"]);
      const done = await loadDone();
      let changed = false;

      for (const issue of issues) {
        // Only notify for agent-completed issues (agent assignee, not human-closed)
        if (issue.assignee_type !== "agent") continue;
        if (done.has(issue.id)) continue;

        done.add(issue.id);
        changed = true;

        const summary = await multica.getLastAgentComment(issue.id);
        if (summary) {
          await notify(config, issue as MulticaTask & { identifier: string }, summary).catch(
            (err) => console.error("[completion] notify error", (err as Error).message),
          );
          console.log(`[completion] notified — ${issue.identifier} (${issue.status})`);
        }
      }
      if (changed) await persistDone(done);
    } catch (err) {
      console.error("[completion] poll error", (err as Error).message);
    }
    if (!closed) setTimeout(poll, POLL_MS);
  }

  poll().catch(() => {});
  return { stop: () => { closed = true; } };
}

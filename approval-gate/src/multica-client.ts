import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface MulticaLabel {
  id: string;
  name: string;
}

export interface MulticaTask {
  id: string;
  identifier: string;
  title: string;
  status: string;
  labels: MulticaLabel[] | undefined;
  assignee?: string;
  assignee_type?: string;
  description?: string;
}

type TaskHandler = (task: MulticaTask) => void;

const POLL_INTERVAL_MS = 30_000;
const COMMENT_POLL_MS = 15_000;
const NOTIFIED_PATH = join(import.meta.dirname, "..", "data", "notified-issues.json");
const SEEN_COMMENTS_PATH = join(import.meta.dirname, "..", "data", "seen-comments.json");

async function loadSeenComments(): Promise<Set<string>> {
  try {
    const raw = await readFile(SEEN_COMMENTS_PATH, "utf8");
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function persistSeenComments(set: Set<string>): Promise<void> {
  await mkdir(join(import.meta.dirname, "..", "data"), { recursive: true });
  await writeFile(SEEN_COMMENTS_PATH, JSON.stringify([...set]), "utf8");
}

async function loadNotified(): Promise<Set<string>> {
  try {
    const raw = await readFile(NOTIFIED_PATH, "utf8");
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function persistNotified(set: Set<string>): Promise<void> {
  await mkdir(join(import.meta.dirname, "..", "data"), { recursive: true });
  await writeFile(NOTIFIED_PATH, JSON.stringify([...set]), "utf8");
}

export type QuestionHandler = (issueId: string, identifier: string, commentId: string, question: string) => void;

export class MulticaClient {
  private handlers: TaskHandler[] = [];
  private questionHandlers: QuestionHandler[] = [];
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private commentPollTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private healthy = false;
  public lastSuccessfulSendAt: number | null = null;

  constructor(private config: Config) {}

  onTask(handler: TaskHandler) {
    this.handlers.push(handler);
  }

  onQuestion(handler: QuestionHandler) {
    this.questionHandlers.push(handler);
  }

  connect() {
    this.poll().catch((err) => console.error("[multica] initial poll failed", err));
    this.pollComments().catch((err) => console.error("[multica] comment poll failed", err));
  }

  private async poll() {
    if (this.closed) return;
    try {
      const issues = await this.fetchTodoIssues();
      this.healthy = true;
      const notified = await loadNotified();
      let changed = false;
      for (const issue of issues) {
        if (!notified.has(issue.id)) {
          notified.add(issue.id);
          changed = true;
          for (const handler of this.handlers) handler(issue);
        }
      }
      if (changed) await persistNotified(notified);
    } catch (err) {
      this.healthy = false;
      console.error("[multica] poll error", (err as Error).message);
    }
    if (!this.closed) {
      this.pollTimer = setTimeout(() => this.poll(), POLL_INTERVAL_MS);
    }
  }

  private async fetchTodoIssues(): Promise<MulticaTask[]> {
    const url = `${this.config.MULTICA_HTTP_URL}/api/issues?workspace_id=${this.config.MULTICA_WORKSPACE_ID}&status=todo`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` },
    });
    if (!res.ok) throw new Error(`GET /api/issues → ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { issues: MulticaTask[] };
    return data.issues ?? [];
  }

  isConnected(): boolean {
    return this.healthy;
  }

  async claimTask(taskId: string): Promise<void> {
    await this.request("PUT", `/api/issues/${taskId}`, {
      status: "in_progress",
      assignee_type: "agent",
      assignee_id: this.config.MULTICA_AGENT_ID,
    });
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.request("PUT", `/api/issues/${taskId}`, { status: "cancelled" });
  }

  async commentOnTask(taskId: string, content: string): Promise<void> {
    await this.request("POST", `/api/issues/${taskId}/comments`, { content });
    this.lastSuccessfulSendAt = Date.now();
  }

  markNotified(issueId: string) {
    // Pre-register an issue so the poll doesn't double-send after bot-triggered creation
    loadNotified().then((set) => {
      set.add(issueId);
      persistNotified(set);
    });
  }

  async listOpenIssues(): Promise<MulticaTask[]> {
    const url =
      `${this.config.MULTICA_HTTP_URL}/api/issues` +
      `?workspace_id=${this.config.MULTICA_WORKSPACE_ID}&status=todo`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` },
    });
    if (!res.ok) throw new Error(`GET /api/issues → ${res.status}`);
    const data = (await res.json()) as { issues: MulticaTask[] };
    return data.issues ?? [];
  }

  async createIssue(title: string, labelNames: string[], description?: string): Promise<MulticaTask> {
    const labelIds = labelNames.length ? await this.resolveLabelIds(labelNames) : [];

    const issueRes = await fetch(
      `${this.config.MULTICA_HTTP_URL}/api/issues?workspace_id=${this.config.MULTICA_WORKSPACE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.MULTICA_TOKEN}`,
        },
        body: JSON.stringify({
          title,
          workspace_id: this.config.MULTICA_WORKSPACE_ID,
          ...(description ? { description } : {}),
        }),
      },
    );
    if (!issueRes.ok) {
      throw new Error(`POST /api/issues → ${issueRes.status}: ${await issueRes.text()}`);
    }
    const issue = (await issueRes.json()) as MulticaTask;

    for (const labelId of labelIds) {
      await fetch(
        `${this.config.MULTICA_HTTP_URL}/api/issues/${issue.id}/labels/${labelId}` +
          `?workspace_id=${this.config.MULTICA_WORKSPACE_ID}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` },
        },
      ).catch(() => {}); // best-effort label attach
    }
    return issue;
  }

  async getIssue(idOrIdentifier: string): Promise<MulticaTask | null> {
    // If it looks like a UUID, fetch directly; otherwise scan open issues
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrIdentifier);
    if (isUuid) {
      const url =
        `${this.config.MULTICA_HTTP_URL}/api/issues/${idOrIdentifier}` +
        `?workspace_id=${this.config.MULTICA_WORKSPACE_ID}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` } });
      if (!res.ok) return null;
      return (await res.json()) as MulticaTask;
    }
    // Search by identifier (e.g. "APP-12") across multiple statuses
    const all = await this.listIssuesByStatus(["todo", "in_progress", "done", "cancelled"]);
    return all.find((i) => i.identifier === idOrIdentifier) ?? null;
  }

  async addLabel(issueId: string, labelName: string): Promise<void> {
    const ids = await this.resolveLabelIds([labelName]);
    if (!ids.length) throw new Error(`Label "${labelName}" not found in workspace`);
    await fetch(
      `${this.config.MULTICA_HTTP_URL}/api/issues/${issueId}/labels/${ids[0]}` +
        `?workspace_id=${this.config.MULTICA_WORKSPACE_ID}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` },
      },
    );
  }

  async listIssuesByStatus(statuses: string[]): Promise<MulticaTask[]> {
    const results: MulticaTask[] = [];
    for (const status of statuses) {
      const url =
        `${this.config.MULTICA_HTTP_URL}/api/issues` +
        `?workspace_id=${this.config.MULTICA_WORKSPACE_ID}&status=${status}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` } });
      if (!res.ok) throw new Error(`GET /api/issues?status=${status} → ${res.status}`);
      const data = (await res.json()) as { issues: MulticaTask[] };
      results.push(...(data.issues ?? []));
    }
    return results;
  }

  async getLastAgentComment(issueId: string): Promise<string | null> {
    const url =
      `${this.config.MULTICA_HTTP_URL}/api/issues/${issueId}/comments` +
      `?workspace_id=${this.config.MULTICA_WORKSPACE_ID}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { comments: Array<{ content: string; author_type: string }> };
    const agentComments = (data.comments ?? []).filter((c) => c.author_type === "agent");
    return agentComments.at(-1)?.content ?? null;
  }

  private labelCache: Map<string, string> | null = null;

  private async resolveLabelIds(names: string[]): Promise<string[]> {
    if (!this.labelCache) {
      const res = await fetch(
        `${this.config.MULTICA_HTTP_URL}/api/labels?workspace_id=${this.config.MULTICA_WORKSPACE_ID}`,
        { headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` } },
      );
      const data = (await res.json()) as { labels: Array<{ id: string; name: string }> };
      this.labelCache = new Map(data.labels.map((l) => [l.name, l.id]));
    }
    return names.flatMap((n) => {
      const id = this.labelCache!.get(n);
      return id ? [id] : [];
    });
  }

  private async request(method: string, path: string, body: unknown, retries = 3): Promise<void> {
    const url = `${this.config.MULTICA_HTTP_URL}${path}?workspace_id=${this.config.MULTICA_WORKSPACE_ID}`;
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) await sleep(500 * 2 ** attempt);
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.MULTICA_TOKEN}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
      const text = await res.text();
      lastErr = new Error(`${method} ${path} → ${res.status}: ${text}`);
      // Don't retry client errors (4xx) — they won't succeed on retry
      if (res.status < 500) break;
    }
    throw lastErr ?? new Error(`${method} ${path} failed after ${retries} attempts`);
  }

  private async pollComments() {
    if (this.closed) return;
    try {
      // Only watch in_progress issues (agent is actively working)
      const url = `${this.config.MULTICA_HTTP_URL}/api/issues?workspace_id=${this.config.MULTICA_WORKSPACE_ID}&status=in_progress`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` } });
      if (!res.ok) throw new Error(`GET /api/issues(in_progress) → ${res.status}`);
      const data = (await res.json()) as { issues: Array<MulticaTask & { identifier: string }> };
      const seen = await loadSeenComments();
      let changed = false;

      for (const issue of data.issues ?? []) {
        const cr = await fetch(
          `${this.config.MULTICA_HTTP_URL}/api/issues/${issue.id}/comments?workspace_id=${this.config.MULTICA_WORKSPACE_ID}`,
          { headers: { Authorization: `Bearer ${this.config.MULTICA_TOKEN}` } },
        );
        if (!cr.ok) continue;
        const cd = (await cr.json()) as { comments: Array<{ id: string; content: string; author_type: string }> };
        for (const comment of cd.comments ?? []) {
          if (seen.has(comment.id)) continue;
          seen.add(comment.id);
          changed = true;
          // Forward to human if agent comment starts with "?" (a question)
          const isQuestion = comment.author_type === "agent" && comment.content.trimStart().startsWith("?");
          if (isQuestion) {
            console.log(`[multica] agent question on ${issue.identifier}`);
            for (const h of this.questionHandlers) h(issue.id, issue.identifier, comment.id, comment.content);
          }
        }
      }
      if (changed) await persistSeenComments(seen);
    } catch (err) {
      console.error("[multica] comment poll error", (err as Error).message);
    }
    if (!this.closed) {
      this.commentPollTimer = setTimeout(() => this.pollComments(), COMMENT_POLL_MS);
    }
  }

  close() {
    this.closed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.commentPollTimer) clearTimeout(this.commentPollTimer);
  }
}

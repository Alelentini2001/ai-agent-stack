import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const LOG_PATH = join(import.meta.dirname, "..", "data", "audit.log");

export interface AuditEntry {
  ts: string;
  taskId: string;
  decision: "sent" | "approved" | "rejected";
  actor: string;
  ip?: string;
  userAgent?: string;
  auditId: string;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await mkdir(join(import.meta.dirname, "..", "data"), { recursive: true });
  await appendFile(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
}

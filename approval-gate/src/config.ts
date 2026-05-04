import { z } from "zod";

const schema = z.object({
  MULTICA_URL: z.string().url(),
  MULTICA_HTTP_URL: z.string().url(),
  MULTICA_TOKEN: z.string().min(1),
  MULTICA_WORKSPACE_ID: z.string().uuid(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  APPROVER_NAME: z.string().min(1),
  GATE_BASE_URL: z.string().url(),
  GATE_PORT: z.coerce.number().int().min(1).max(65535).default(4242),
  JWT_SECRET: z.string().min(32),
  MULTICA_AGENT_ID: z.string().uuid(),
  WEBHOOK_SECRET: z.string().optional(),
  PROJECT_NAME: z.string().default("Project"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing/invalid env vars: ${missing}`);
  }
  return result.data;
}

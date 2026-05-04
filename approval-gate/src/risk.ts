import { readFileSync } from "node:fs";
import { join } from "node:path";

export type RiskLevel = "high" | "medium" | "low";

interface RiskConfig {
  high: string[];
  medium: string[];
}

function loadConfig(): RiskConfig {
  try {
    const p = join(import.meta.dirname, "..", "risk-config.json");
    return JSON.parse(readFileSync(p, "utf8")) as RiskConfig;
  } catch {
    return {
      high: ["risk:design", "risk:schema", "risk:deploy", "risk:migration", "risk:legal-review", "risk:security", "risk:breaking-change"],
      medium: ["risk:content", "risk:copy", "risk:config", "risk:refactor"],
    };
  }
}

const cfg = loadConfig();
const HIGH = new Set(cfg.high);
const MEDIUM = new Set(cfg.medium);

export function classifyRisk(labels: string[]): RiskLevel {
  let level: RiskLevel = "low";
  for (const label of labels) {
    if (HIGH.has(label)) return "high";
    if (MEDIUM.has(label)) level = "medium";
  }
  return level;
}

export function getRiskLabels(): { high: string[]; medium: string[] } {
  return { high: [...HIGH], medium: [...MEDIUM] };
}

/**
 * Autonomous ingestion monitors — the "paperclip" layer.
 * Discovers new items in external feeds and files Multica issues automatically.
 * Low-risk tasks → auto-executed by agent. High/medium → pauses for approval.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { MulticaClient } from "./multica-client.js";

const DATA_DIR = join(import.meta.dirname, "..", "data");

interface FeedItem { title: string; link: string; pubDate: string; description: string; guid: string; }

function parseRss(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  const get = (block: string, tag: string) =>
    block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]?.trim() ?? "";
  while ((m = itemRe.exec(xml)) !== null) {
    const b = m[1] ?? "";
    const title = get(b, "title");
    if (!title) continue;
    const link = get(b, "link");
    const guid = get(b, "guid") || link || title;
    items.push({ title, link, pubDate: get(b, "pubDate"),
      description: get(b, "description").replace(/<[^>]+>/g, " ").trim(), guid });
  }
  return items;
}

async function loadSeen(file: string): Promise<Set<string>> {
  try { return new Set(JSON.parse(await readFile(join(DATA_DIR, file), "utf8")) as string[]); }
  catch { return new Set(); }
}
async function persistSeen(file: string, set: Set<string>): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, file), JSON.stringify([...set]), "utf8");
}

async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { "Accept": "application/rss+xml,application/xml,text/xml,*/*", "User-Agent": "AppaltamiMonitor/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Feed ${url} returned ${res.status}`);
  return parseRss(await res.text());
}

const PROCUREMENT_KW = ["appalto","gara","bando","CIG","CUP","ANAC","contratto pubblico",
  "D.lgs. 36","aggiudicazione","concessione","affidamento","licitazione"];
function isRelevant(item: FeedItem): boolean {
  const t = (item.title + " " + item.description).toLowerCase();
  return PROCUREMENT_KW.some((kw) => t.includes(kw.toLowerCase()));
}

async function runFeedMonitor(
  name: string, feedUrl: string, seenFile: string, labels: string[],
  filter: (i: FeedItem) => boolean, multica: MulticaClient,
): Promise<void> {
  const items = await fetchFeed(feedUrl);
  const seen = await loadSeen(seenFile);
  let changed = false;
  for (const item of items) {
    if (seen.has(item.guid)) continue;
    seen.add(item.guid); changed = true;
    if (!filter(item)) continue;
    const desc = [item.link && `Link: ${item.link}`, item.pubDate && `Published: ${item.pubDate}`,
      item.description && `\n${item.description.slice(0, 400)}`].filter(Boolean).join("\n");
    try {
      const issue = await multica.createIssue(`[${name}] ${item.title.slice(0, 160)}`, labels, desc);
      console.log(`[ingestion] ${name} filed ${issue.identifier}`);
    } catch (err) { console.error(`[ingestion] ${name} file failed:`, (err as Error).message); }
  }
  if (changed) await persistSeen(seenFile, seen);
}

function scheduleEvery(ms: number, fn: () => Promise<void>): () => void {
  let closed = false;
  const tick = async () => {
    if (closed) return;
    try { await fn(); } catch (err) { console.error("[ingestion] error", (err as Error).message); }
    if (!closed) setTimeout(tick, ms);
  };
  setTimeout(tick, ms);
  return () => { closed = true; };
}

function scheduleDaily(hourUtc: number, fn: () => Promise<void>): () => void {
  let closed = false;
  const tick = async () => {
    if (closed) return;
    try { await fn(); } catch (err) { console.error("[ingestion] daily error", (err as Error).message); }
    if (!closed) setTimeout(tick, 24 * 60 * 60 * 1_000);
  };
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0));
  if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next.getTime() - Date.now();
  console.log(`[ingestion] daily job at ${hourUtc}:00 UTC in ${Math.round(delay/60_000)}min`);
  setTimeout(tick, delay);
  return () => { closed = true; };
}

export interface IngestionMonitors { stop(): void; }

export function startIngestionMonitors(config: Config, multica: MulticaClient): IngestionMonitors {
  const stops: Array<() => void> = [];

  if (config.GAZZETTA_RSS_URL) {
    stops.push(scheduleEvery(4 * 60 * 60 * 1_000, () =>
      runFeedMonitor("Gazzetta Ufficiale", config.GAZZETTA_RSS_URL!, "gazzetta-seen.json", ["risk:legal-review"], isRelevant, multica)));
    console.log("[ingestion] Gazzetta monitor armed (every 4h)");
  }

  if (config.ANAC_RSS_URL) {
    stops.push(scheduleEvery(4 * 60 * 60 * 1_000, () =>
      runFeedMonitor("ANAC", config.ANAC_RSS_URL!, "anac-seen.json", ["risk:legal-review"], () => true, multica)));
    console.log("[ingestion] ANAC monitor armed (every 4h)");
  }

  // Nightly CIG enrichment task (02:00 UTC = 04:00 CEST)
  stops.push(scheduleDaily(2, async () => {
    const issue = await multica.createIssue(
      "Nightly: enrich new CIG codes added in the last 24h",
      ["risk:config"],
      `Scheduled nightly enrichment task.\n\n` +
      `1. Query tenders_raw WHERE anac_data IS NULL AND created_at > now() - interval '24 hours'\n` +
      `2. For each CIG call the ANAC open-data API\n` +
      `3. Update tenders_raw.anac_data with the response\n` +
      `4. Respect ANAC rate limits: 600ms delay between calls\n` +
      `5. Comment on this issue with: enriched count, not_found count, any errors`,
    );
    console.log(`[ingestion] nightly enrichment task filed — ${issue.identifier}`);
  }));
  console.log("[ingestion] Nightly CIG enrichment trigger armed (02:00 UTC)");

  if (config.APPALTAMI_HEALTH_URL) {
    let wasHealthy = true;
    stops.push(scheduleEvery(60 * 60 * 1_000, async () => {
      try {
        const res = await fetch(config.APPALTAMI_HEALTH_URL!, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok && wasHealthy) {
          await multica.createIssue(`🔴 App health check failed (HTTP ${res.status})`, ["risk:deploy"],
            `Health endpoint ${config.APPALTAMI_HEALTH_URL} returned ${res.status}. Investigate.`);
        }
        wasHealthy = res.ok;
      } catch (err) {
        if (wasHealthy)
          await multica.createIssue("🔴 App health check unreachable", ["risk:deploy"],
            `Cannot reach ${config.APPALTAMI_HEALTH_URL}: ${(err as Error).message}`).catch(() => {});
        wasHealthy = false;
      }
    }));
    console.log("[ingestion] App health monitor armed (every 1h)");
  }

  return { stop: () => stops.forEach((fn) => fn()) };
}

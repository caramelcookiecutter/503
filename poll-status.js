import fs from "fs";

const LOG_FILE = "./outage-log.json";

function loadLog() {
  if (fs.existsSync(LOG_FILE)) {
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  }
  return {};
}

function saveLog(log) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// Generic checker for Statuspage-style APIs that return a simple "indicator"
// field (works for OpenAI, Claude, and Perplexity's status pages).
async function checkIndicator(log, key, url, getIndicator) {
  if (!log[key]) log[key] = { lastIndicator: "none", incidents: [] };
  try {
    const res = await fetch(url);
    const data = await res.json();
    const indicator = getIndicator(data);
    const now = new Date().toISOString();
    const wasDown = log[key].lastIndicator !== "none";
    const isDown = indicator !== "none";

    if (!wasDown && isDown) {
      log[key].incidents.push({ start: now, end: null, indicator });
      console.log(`[${key}] New outage detected (${indicator})`);
    } else if (wasDown && !isDown) {
      const open = [...log[key].incidents].reverse().find((i) => i.end === null);
      if (open) open.end = now;
      console.log(`[${key}] Outage ended`);
    } else {
      console.log(`[${key}] No change (${indicator})`);
    }
    log[key].lastIndicator = indicator;
  } catch (err) {
    console.error(`[${key}] Check failed (will retry next run):`, err.message);
  }
}

// Gemini: no dedicated status page, but Google Cloud's public incidents feed
// already contains historical incidents with real start/end times, so instead
// of diffing live state we sync any Gemini/Vertex-AI-related incidents in.
async function checkGemini(log) {
  const key = "gemini";
  if (!log[key]) log[key] = { incidents: [] };
  try {
    const res = await fetch("https://status.cloud.google.com/incidents.json");
    const incidents = await res.json();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const relevant = incidents.filter((inc) => {
      const text = JSON.stringify(inc).toLowerCase();
      const mentionsGemini =
        text.includes("gemini") || text.includes("vertex ai") || text.includes("generative ai");
      const begin = inc.begin ? new Date(inc.begin).getTime() : 0;
      return mentionsGemini && begin >= cutoff;
    });

    let added = 0;
    for (const inc of relevant) {
      const id = inc.id || inc.begin;
      const existing = log[key].incidents.find((i) => i.id === id);
      if (!existing) {
        log[key].incidents.push({ id, start: inc.begin || null, end: inc.end || null });
        added++;
      } else if (inc.end && !existing.end) {
        existing.end = inc.end;
      }
    }
    console.log(`[gemini] Synced. ${added} new incident(s) found.`);
  } catch (err) {
    console.error("[gemini] Check failed (will retry next run):", err.message);
  }
}

// Grok: xAI has no structured status API, only an RSS feed with no clean
// up/down signal. We can only detect "something new was posted" — not
// precise start/end times. This is the least reliable of the five signals.
async function checkGrok(log) {
  const key = "grok";
  if (!log[key]) log[key] = { lastGuid: null, incidents: [] };
  try {
    const res = await fetch("https://status.x.ai/feed.xml");
    const xml = await res.text();
    const match = xml.match(/<guid[^>]*>(.*?)<\/guid>/);
    const latestGuid = match ? match[1] : null;

    if (latestGuid && latestGuid !== log[key].lastGuid) {
      const now = new Date().toISOString();
      log[key].incidents.push({ start: now, end: now, note: "RSS update detected (imprecise)" });
      log[key].lastGuid = latestGuid;
      console.log("[grok] New feed update detected");
    } else {
      console.log("[grok] No change");
    }
  } catch (err) {
    console.error("[grok] Check failed (will retry next run):", err.message);
  }
}

async function main() {
  const log = loadLog();

  await checkIndicator(log, "chatgpt", "https://status.openai.com/api/v2/status.json", (d) => d.status.indicator);
  await checkIndicator(log, "claude", "https://status.claude.com/api/v2/status.json", (d) => d.status.indicator);
  await checkIndicator(log, "perplexity", "https://status.perplexity.com/summary.json", (d) =>
    d.page.status === "UP" && (!d.activeIncidents || d.activeIncidents.length === 0) ? "none" : "down"
  );
  await checkGemini(log);
  await checkGrok(log);

  saveLog(log);
}

main().catch((err) => {
  console.error("Poll run failed (will retry next run):", err.message);
  process.exit(0);
});

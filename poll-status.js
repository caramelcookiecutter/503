import fs from "fs";

const STATUS_URL = "https://status.openai.com/api/v2/status.json";
const LOG_FILE = "./outage-log.json";

async function main() {
  const res = await fetch(STATUS_URL);
  const data = await res.json();
  const indicator = data.status.indicator; // "none" | "minor" | "major" | "critical"

  let log = { lastIndicator: "none", incidents: [] };
  if (fs.existsSync(LOG_FILE)) {
    log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  }

  const now = new Date().toISOString();
  const wasDown = log.lastIndicator !== "none";
  const isDown = indicator !== "none";

  if (!wasDown && isDown) {
    // A new outage just started
    log.incidents.push({ start: now, end: null, indicator });
    console.log(`New outage detected (${indicator}) at ${now}`);
  } else if (wasDown && !isDown) {
    // The most recent open outage just ended
    const open = [...log.incidents].reverse().find((i) => i.end === null);
    if (open) open.end = now;
    console.log(`Outage ended at ${now}`);
  } else {
    console.log(`No change. Current status: ${indicator}`);
  }

  log.lastIndicator = indicator;
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

main().catch((err) => {
  // Don't fail the whole workflow over a network hiccup — just try again next run
  console.error("Status check failed (will retry next run):", err.message);
  process.exit(0);
});

import fs from "fs";
import { burnFromTreasury } from "./burn-on-error.js";

const LOG_FILE = "./outage-log.json";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function countRecentOutages() {
  if (!fs.existsSync(LOG_FILE)) return 0;
  const log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  const cutoff = Date.now() - ONE_WEEK_MS;

  let total = 0;
  for (const provider of Object.keys(log)) {
    const incidents = log[provider]?.incidents || [];
    const recent = incidents.filter((i) => i.start && new Date(i.start).getTime() >= cutoff);
    console.log(`  ${provider}: ${recent.length} incident(s) this week`);
    total += recent.length;
  }
  return total;
}

async function main() {
  console.log("Checking outages across all monitored providers...");
  const count = countRecentOutages();
  console.log(`Found ${count} total outage(s) across all providers in the last 7 days.`);

  if (count === 0) {
    console.log("Nothing to burn this week.");
    return;
  }

  await burnFromTreasury(count);
  console.log("Weekly burn complete!");
}

main().catch((err) => {
  console.error("Weekly burn failed:", err);
  process.exit(1);
});

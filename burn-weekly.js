import { burnFromTreasury } from "./burn-on-error.js";

// TODO: swap this for your real weekly error count
// (read it from a log file, a database, or wherever your app tracks
// ChatGPT errors). For now it defaults to 1 so you can test the pipeline.
const ERRORS_THIS_WEEK = Number(process.env.ERROR_COUNT || 1);

async function main() {
  console.log(`Burning tokens for ${ERRORS_THIS_WEEK} error(s) this week...`);
  await burnFromTreasury(ERRORS_THIS_WEEK);
  console.log("Weekly burn complete!");
}

main().catch((err) => {
  console.error("Weekly burn failed:", err);
  process.exit(1);
});

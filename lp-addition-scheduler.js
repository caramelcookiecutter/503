/**
 * lp-addition-scheduler.js
 *
 * Computes the size of the next Traders/Liquidity allocation deposit,
 * triggered by data center openings from the 4 infrastructure-operating
 * providers on the roster (ChatGPT/OpenAI, Claude/Anthropic, Gemini/Google,
 * Grok/xAI — Perplexity is intentionally excluded; it doesn't operate its
 * own data center infrastructure).
 *
 * Mirrors the pattern in burn-weekly.js: reads a log of real-world events,
 * computes an amount, supports DRY_RUN.
 *
 * KEY DESIGN CHOICE: rather than a fixed per-event constant computed once
 * against a ~9.65 year guess about 2026–2036 industry buildout (which no
 * one can actually forecast that far out), this recalculates against the
 * OBSERVED event rate as real openings get logged. Early estimates lean on
 * a seed rate; the blend shifts toward real data as events accumulate, so
 * the number self-corrects instead of staying locked to today's guess for
 * the next decade.
 *
 * Converted from TypeScript to plain JS to match burn-weekly.js's
 * execution model (no build step — runs directly via `node`). Written as
 * ES modules (import/export), confirmed against this project's actual
 * package.json ("type": "module").
 */

import fs from "fs";

// ---- Config ----

// TODO: set this to your confirmed TGE date/time (pull the exact timestamp
// from the pool-creation transaction on Solscan — don't estimate it).
const GENESIS_DATE = new Date("2026-08-03T00:00:00Z");

const SCHEDULE_YEARS = 9.65; // recalibrated to match the doubled-tier-rate treasury depletion target
const TOTAL_LP_ALLOCATION = 500_000_000; // 50% of 1,000,000,000 total supply
const ALREADY_DEPLOYED = 7_121_299; // confirmed pooled $503 as of the Aug 2026 check

const ELIGIBLE_PROVIDERS = ["OpenAI", "Anthropic", "Google", "xAI"];

// Seed rate used only until real events accumulate (cold-start fallback).
// Based on the sourced Aug 2026 snapshot: ~12 major milestones across ~3
// years among these 4 providers ≈ 4/year. This is a *starting assumption*
// for the blend below, not a forecast — it gets progressively overridden
// by real logged events.
const SEED_EVENTS_PER_YEAR = 4;

// Number of logged events at which the formula fully trusts observed data
// over the seed rate. Tune this if 8 feels too fast/slow to trust real data.
const FULL_CONFIDENCE_EVENT_COUNT = 8;

// ---- Event log ----
// Unlike outages, there is no standardized status-page API for "a data
// center opened" — this log has to be curated (or produced by
// datacenter-event-detector.js) as announcements happen, not polled
// automatically the way outage-oracle.js polls status pages.
// Expected shape of each entry in datacenter-events.json:
//   { provider: string, description: string, date: "YYYY-MM-DD" }

function loadEventLog(path) {
  if (!fs.existsSync(path)) return [];
  const raw = fs.readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed.filter((e) => ELIGIBLE_PROVIDERS.includes(e.provider));
}

// ---- Core formula ----

function computeNextAddition(events, cumulativeAdded) {
  const now = new Date();
  const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
  const yearsElapsed = Math.max(
    (now.getTime() - GENESIS_DATE.getTime()) / msPerYear,
    0
  );
  const yearsRemaining = Math.max(SCHEDULE_YEARS - yearsElapsed, 0);

  const eventsSoFar = events.length;

  // Observed rate so far, blended with the seed rate. Confidence ramps
  // linearly from 0 (trust the seed) to 1 (trust observed data only) as
  // FULL_CONFIDENCE_EVENT_COUNT events accumulate.
  const observedRate = yearsElapsed > 0 ? eventsSoFar / yearsElapsed : 0;
  const confidenceWeight = Math.min(
    eventsSoFar / FULL_CONFIDENCE_EVENT_COUNT,
    1
  );
  const effectiveRate =
    confidenceWeight * observedRate +
    (1 - confidenceWeight) * SEED_EVENTS_PER_YEAR;

  const estimatedRemainingEvents = Math.max(
    Math.round(effectiveRate * yearsRemaining),
    1 // never divide by zero — worst case, treat as one final lump addition
  );

  const remainingSupply = Math.max(TOTAL_LP_ALLOCATION - cumulativeAdded, 0);
  const nextAdditionTokens = remainingSupply / estimatedRemainingEvents;

  return {
    yearsElapsed: Number(yearsElapsed.toFixed(3)),
    yearsRemaining: Number(yearsRemaining.toFixed(3)),
    eventsSoFar,
    effectiveRate: Number(effectiveRate.toFixed(3)),
    estimatedRemainingEvents,
    remainingSupply,
    nextAdditionTokens: Math.floor(nextAdditionTokens),
  };
}

// ---- Matching SOL side ----
// Pool ratio should be read live from the Raydium pool's token vaults at
// execution time, not hardcoded. This is a stub — wire it to an actual
// @solana/web3.js getAccountInfo / getTokenAccountBalance call against the
// pool's two vault accounts before this runs for real.
async function getMatchingSol(tokenAmount, poolTokenReserve, poolSolReserve) {
  const ratio = poolTokenReserve / poolSolReserve; // $503 per SOL
  return tokenAmount / ratio;
}

// ---- Runner ----

async function main() {
  const DRY_RUN = process.env.DRY_RUN !== "false"; // defaults true, same convention as burn-weekly.js

  const events = loadEventLog("./datacenter-events.json");

  // TODO: replace with your actual running total once you're tracking
  // cumulative additions somewhere durable (a log file, an on-chain memo,
  // whatever fits the rest of your tooling) — this only accounts for the
  // initial deployed amount right now.
  const cumulativeAdded = ALREADY_DEPLOYED;

  const result = computeNextAddition(events, cumulativeAdded);

  console.log("=== LP Addition Calculation ===");
  console.log(`Years elapsed since TGE: ${result.yearsElapsed}`);
  console.log(`Years remaining in schedule: ${result.yearsRemaining}`);
  console.log(`Data center events logged so far: ${result.eventsSoFar}`);
  console.log(`Effective rate (events/year): ${result.effectiveRate}`);
  console.log(`Estimated remaining events: ${result.estimatedRemainingEvents}`);
  console.log(
    `Remaining LP allocation: ${result.remainingSupply.toLocaleString()} $503`
  );
  console.log(
    `--> Next addition: ${result.nextAdditionTokens.toLocaleString()} $503`
  );

  // TODO: fetch live pool reserves here, then:
  // const solAmount = await getMatchingSol(result.nextAdditionTokens, poolTokenReserve, poolSolReserve);
  // console.log(`--> Matching SOL: ${solAmount}`);

  if (DRY_RUN) {
    console.log(
      "\n[DRY_RUN] No transaction executed. Review the numbers above before wiring in the real Raydium addLiquidity call."
    );
    return;
  }

  // TODO: construct and send the actual Raydium add-liquidity transaction
  // here, signed by the treasury keypair, once pool-reserve reads are wired
  // in and you've reviewed the DRY_RUN output. Test on devnet first, same
  // as everything else in this project.
  throw new Error(
    "Live execution not implemented — wire in the Raydium SDK call after devnet testing."
  );
}

main().catch(console.error);

export { computeNextAddition, getMatchingSol, loadEventLog };

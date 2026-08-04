import fs from "fs";
import { burnRawFromTreasury, decimals } from "./burn-on-error.js";

const LOG_FILE = "./outage-log.json";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Genesis anchor: the calculated astronomical sunrise in Philadelphia, PA
// on Oct 31, 2008 — the Bitcoin whitepaper's publication date — at
// 7:29:02 AM EDT (UTC-4), i.e. 11:29:02 UTC. Day boundaries are fixed 24h
// buckets counted from this single instant. This is a fixed offset chosen
// once at genesis, NOT a DST-aware recalculation of "local Philadelphia
// time" for every incident — that would make bucketing non-deterministic
// across the March/November clock changes, which defeats the point.
const GENESIS_MS = Date.UTC(2008, 9, 31, 11, 29, 2); // month is 0-indexed: 9 = October

// Tier rates, tax-bracket style (they apply to the portion of an outage's
// duration that falls inside that bracket, not a cliff). Expressed as an
// exact integer numerator over 10,000 so converting to on-chain base units
// is pure BigInt math — no floating point ever touches the burn amount.
//   0.3565 tokens/sec -> 3565 / 10000   (tier 1: 0–15 min)
//   0.7130 tokens/sec -> 7130 / 10000   (tier 2: 15–60 min)
//   1.4260 tokens/sec -> 14260 / 10000  (tier 3: 60–180 min)
//   2.8520 tokens/sec -> 28520 / 10000  (tier 4: 180 min+)
const RATE_DENOMINATOR = 10000n;
const TIERS = [
  { thresholdSec: 900n, rateNumerator: 3565n }, // 15 min
  { thresholdSec: 3600n, rateNumerator: 7130n }, // 60 min
  { thresholdSec: 10800n, rateNumerator: 14260n }, // 180 min
  { thresholdSec: null, rateNumerator: 28520n }, // uncapped
];

// Repeat-outage penalty, kept as integer basis points (100 = 1.00x) rather
// than a float so the multiplier can't introduce rounding drift either.
// +25% per distinct PRIOR outage-day for that provider within the trailing
// 7-day window, capped at 2.00x total.
const PENALTY_PER_DAY_BPS = 25n;
const PENALTY_CAP_BPS = 100n; // cap is +100% on top of the base 100
const BPS_BASE = 100n;

const decimalsScale = 10n ** BigInt(decimals);

function dayIndex(timestampMs) {
  return Math.floor((timestampMs - GENESIS_MS) / DAY_MS);
}

function rateBaseUnitsPerSec(rateNumerator) {
  // (tokens/sec) * 10^decimals, computed as an exact integer ratio.
  return (rateNumerator * decimalsScale) / RATE_DENOMINATOR;
}

// Tax-bracket-style burn for a single incident's duration, in raw base units.
function tieredBurnRawUnits(durationSec) {
  let remaining = BigInt(Math.round(durationSec));
  let prevThreshold = 0n;
  let total = 0n;

  for (const tier of TIERS) {
    if (remaining <= 0n) break;
    const bracketSize = tier.thresholdSec === null ? remaining : tier.thresholdSec - prevThreshold;
    const secondsInBracket = remaining < bracketSize ? remaining : bracketSize;
    total += secondsInBracket * rateBaseUnitsPerSec(tier.rateNumerator);
    remaining -= secondsInBracket;
    if (tier.thresholdSec !== null) prevThreshold = tier.thresholdSec;
  }

  return total;
}

function loadIncidents() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const log = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  const now = Date.now();
  const cutoff = now - ONE_WEEK_MS;

  const incidents = [];
  for (const provider of Object.keys(log)) {
    const providerIncidents = log[provider]?.incidents || [];
    for (const incident of providerIncidents) {
      if (!incident.start) continue;
      const startMs = new Date(incident.start).getTime();
      if (startMs < cutoff) continue;

      // No recorded `end` is treated as still-ongoing through "now" for
      // duration purposes. This ASSUMES poll-status.js writes an `end`
      // field once an incident resolves — confirm that matches the real
      // outage-log.json shape before trusting this against real incidents.
      const endMs = incident.end ? new Date(incident.end).getTime() : now;
      const durationSec = Math.max(0, (endMs - startMs) / 1000);

      incidents.push({ provider, startMs, durationSec });
    }
  }
  return incidents;
}

// Returns a function that looks up each incident's repeat-penalty
// multiplier (integer basis points, 100 = 1.00x) based on how many other
// distinct outage-days that provider had earlier in the same window.
function buildRepeatMultiplierLookup(incidents) {
  const daysByProvider = new Map();
  for (const incident of incidents) {
    const day = dayIndex(incident.startMs);
    if (!daysByProvider.has(incident.provider)) daysByProvider.set(incident.provider, new Set());
    daysByProvider.get(incident.provider).add(day);
  }

  const sortedDaysByProvider = new Map();
  for (const [provider, daySet] of daysByProvider.entries()) {
    sortedDaysByProvider.set(provider, [...daySet].sort((a, b) => a - b));
  }

  return (incident) => {
    const day = dayIndex(incident.startMs);
    const priorDistinctDays = BigInt(
      sortedDaysByProvider.get(incident.provider).filter((d) => d < day).length
    );
    const bumpBps = priorDistinctDays * PENALTY_PER_DAY_BPS;
    const cappedBumpBps = bumpBps > PENALTY_CAP_BPS ? PENALTY_CAP_BPS : bumpBps;
    return BPS_BASE + cappedBumpBps; // 100, 125, 150, 175, or capped at 200
  };
}

async function main() {
  console.log("Checking outages across all monitored providers...");
  const incidents = loadIncidents();

  if (incidents.length === 0) {
    console.log("No incidents in the trailing 7 days — nothing to burn this week.");
    return;
  }

  const getMultiplierBps = buildRepeatMultiplierLookup(incidents);

  let totalRaw = 0n;
  for (const incident of incidents) {
    const baseRaw = tieredBurnRawUnits(incident.durationSec);
    const multiplierBps = getMultiplierBps(incident);
    const burnRaw = (baseRaw * multiplierBps) / BPS_BASE;
    totalRaw += burnRaw;

    console.log(
      `  ${incident.provider}: ${Math.round(incident.durationSec / 60)} min outage, ` +
        `${(Number(multiplierBps) / 100).toFixed(2)}x repeat multiplier`
    );
  }

  const totalTokensForLogging = Number(totalRaw) / Number(decimalsScale);
  console.log(`Total: ${totalTokensForLogging.toFixed(6)} tokens across ${incidents.length} incident(s).`);

  if (totalRaw <= 0n) {
    console.log("Computed burn is 0 — nothing to burn this week.");
    return;
  }

  if (process.env.DRY_RUN === "true") {
    console.log("DRY_RUN=true — skipping the actual burn. Re-run without DRY_RUN to execute it for real.");
    return;
  }

  await burnRawFromTreasury(totalRaw);
  console.log("Weekly burn complete!");
}

main().catch((err) => {
  console.error("Weekly burn failed:", err);
  process.exit(1);
});

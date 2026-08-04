# $503 Whitepaper

**Status:** v0.4.1 — tiered burn system deployed and confirmed running
**Last updated:** August 2026
**Network:** Solana

> This document describes $503 as currently deployed on Solana mainnet. Anything described as "not yet implemented" or under Future Directions is design work only and is not active on-chain. This is a technical and informational document, not investment advice, and does not constitute an offer or solicitation to buy or sell any asset.

---

## 1. Overview

$503 is an SPL token on Solana with an initial fixed mint of 1,000,000,000 $503. The project ties the token's treasury supply to real-world outages at a fixed set of AI service providers: an off-chain script monitors public status pages, and treasury tokens are burned on a weekly basis according to the duration and frequency of outages logged that week.

The name references the HTTP 503 "Service Unavailable" status code.

$503 is live and trading on Raydium on Solana mainnet. Liquidity and holder count are currently limited, consistent with a newly launched token; see the Links section for live market data rather than relying on figures in this document, which will go stale quickly.

---

## 2. Token Summary

| Parameter         | Value                                                    |
| ------------------ | --------------------------------------------------------- |
| Name               | $503                                                       |
| Chain              | Solana                                                     |
| Standard           | SPL Token                                                  |
| Initial supply     | 1,000,000,000                                              |
| Decimals           | 8 |
| Mint address       | `GEPa9WUhjfthcuXy7kjwpS3bn9YcpSpdXxkd1nt31Lgc`             |
| Mint authority     | Held by the treasury wallet                                |
| Freeze authority   | Held by the treasury wallet                                |

> **Verification note (August 2026):** the initial supply figure above (1,000,000,000) has been cross-checked against live pool data — fully diluted valuation divided by live price on the $503/SOL Raydium pool — and confirmed. An earlier internal figure of 503,000,000, used during pre-launch planning, is superseded and should not be referenced going forward. Decimal places have not yet been independently confirmed against the mint account and should be pulled directly from a block explorer before being cited in any external listing (e.g. CoinGecko, CoinMarketCap) — do not carry forward the un-verified "6 decimals" assumption from earlier design docs without checking it first.

### Allocation

| Allocation          | % of Supply | Notes                            |
| -------------------- | ------------ | ---------------------------------- |
| Founder              | 20%          | Not subject to the burn mechanic |
| Treasury              | 30%          | Subject to weekly burns          |
| Traders / liquidity   | 50%          | Circulating / LP                 |

**Note on mint authority:** because the treasury wallet retains mint authority, total supply is not cryptographically fixed the way a "burned mint authority" token's supply would be — the treasury *could* mint additional tokens. The current design does not do this, but it is a trust assumption rather than a contract-enforced guarantee. The same applies to freeze authority: the treasury is technically able to freeze individual holder accounts. Anyone evaluating the token should weigh this centralization point directly.

---

## 3. How the Burn Mechanic Works (Live)

Two independent burn triggers exist in the codebase.

**Weekly tiered burn — the live mechanism, deployed and confirmed running:**

1. **Watching** — a script checks the status pages of ChatGPT, Claude, Gemini, and Perplexity every 15 minutes for reported incidents, writing results to an outage log.

2. **Measuring** — when the weekly script runs, every incident in the trailing 7 days is measured by duration: time between its logged start and end. An incident with no recorded end is treated as ongoing through the moment the script runs.

3. **Tiering** — each incident's burn is calculated tax-bracket style across four escalating per-second rates:

    | Tier | Duration   | Rate (tokens/sec) |
    | ---- | ---------- | ------------------ |
    | 1    | 0–15 min   | 0.3565              |
    | 2    | 15–60 min  | 0.7130              |
    | 3    | 60–180 min | 1.4260              |
    | 4    | 180 min+   | 2.8520              |

    Rates step up in a strict 1:2:4:8 ratio. Each bracket only charges for the portion of an outage's duration that falls inside it — a 20-minute outage is charged 15 minutes at tier 1 plus 5 minutes at tier 2, not 20 minutes at tier 2.

4. **Repeat-outage penalty** — for each provider, every distinct outage-day within the trailing 7-day window beyond the first adds a 25% penalty to that day's incidents, capped at a 2x multiplier. Day boundaries for this purpose are anchored to a fixed reference timestamp — the calculated astronomical sunrise in Philadelphia, PA on October 31, 2008 (7:29:02 AM EDT), the Bitcoin whitepaper's publication date — rather than UTC midnight.

5. **Burning** — all incidents' post-multiplier amounts are summed and burned from the treasury in a single transaction. All math is done as integer base-unit arithmetic rather than floating point, to avoid rounding drift.

**Reactive per-call burn — present in the code, not confirmed active:**

The codebase also exports a wrapper that burns 1 whole token (configurable) immediately whenever a live call to the ChatGPT API fails, independent of the status-page monitoring above. This only executes if something in production is actually using that wrapper to make real API calls; that isn't something this document can confirm from the code alone, and should be verified directly with the maintainer.

Both paths call the SPL token program's burn instruction directly from the treasury's own token account, signed by the treasury keypair — a whole-token burn function for the reactive path, and a separate raw base-unit burn function for the tiered weekly path, since its amounts are fractional. There is no custom on-chain program (no Anchor contract, no PDAs) governing any of this — the treasury keypair is the sole authority executing every burn.

Grok is referenced on the project site and linked to its status page (status.x.ai), but is not polled by the same automated script, since it does not expose a public status API in the format the other four use.

---

## 4. Provider Roster

- ChatGPT (OpenAI)
- Claude (Anthropic)
- Gemini (Google)
- Perplexity
- Grok (xAI) — tracked via manual link to status.x.ai rather than automated polling

The roster was chosen based on usage-share data (Similarweb, StatCounter, SE Ranking) during the project's design phase, with an intent to exclude providers of Chinese origin. The roster is not currently stored as an on-chain, upgradable structure — it reflects which providers the current off-chain script checks.

---

## 5. Not Yet Implemented

One piece of earlier design work is still not reflected on-chain: a custom Anchor/Rust program using PDAs to hold burn (and ideally mint/freeze) authority, replacing the treasury hot wallet as the signer for every transaction. The project's own GitHub README raises this as worth considering for tighter control than a hot wallet allows; it has not been built.

No formal backtest has been run against the tiered logic now live in `burn-weekly.js`. An earlier 30-day backtest was performed against this design during planning, before the code existed, and is not being republished here since it wasn't validated against the deployed script or real production data.

---

## 6. Operations

Burns run via scripts executed with access to the treasury keypair (a hot wallet, not a hardware wallet, since unattended signing requires this). The weekly tiered burn depends on that script actually being executed on schedule — absent an on-chain program, nothing enforces this automatically.

The duration-based tiering assumes the outage log records an `end` timestamp once an incident resolves. If that's ever missing for a given incident, it's treated as ongoing through the moment the script runs, which would overstate its duration and its burn.

The weekly script supports a `DRY_RUN=true` mode that logs the full per-incident breakdown — duration, tier exposure, repeat multiplier, total — without executing a burn, useful for sanity-checking a week's numbers before committing to them.

If the reactive per-call burn path is ever wired into a live process, note it operates independently of the weekly tiered job — it draws from real-time API call outcomes, not the status-page outage log — so the two can't double-count a single incident, but both draw down the same treasury balance concurrently.

---

## 7. Roadmap

- Bring Grok into automated monitoring if/when a usable status feed becomes available.
- Evaluate moving burn/mint/freeze authority into an Anchor program controlled by a PDA, removing reliance on a hot wallet.
- Run a backtest against the live tiered logic using accumulated real outage data.
- Continue public distribution of the liquidity/trading allocation.
- Confirm and publish the on-chain decimal precision for the mint (see Section 2 note).

---

## 8. Risks and Disclaimers

- $503 is a meme coin carrying the general risks of early-stage, low-liquidity tokens, including price volatility and potential total loss.
- The treasury wallet holds both mint and freeze authority. This is a centralization point and a trust assumption, not a contract-enforced constraint.
- There is no independently published smart-contract audit. An automated scanner (DexScreener) flagged issues on this token; specifics were not available beyond the flag itself, and interested readers should review that directly rather than rely on this summary.
- The burn mechanic depends on a script being run on schedule and on third-party status pages being accurate and available; neither is guaranteed.
- Burn amounts are duration- and severity-weighted, not flat: a handful of long outages can burn far more than many short ones, and recurring outages from the same provider within a week compound via the repeat-outage multiplier. Treasury depletion is not linear with incident count.
- The tiered calculation depends on the outage log recording an accurate end time for each incident; if that's ever missing or wrong, duration — and therefore burn size — could be overstated (see Operations).
- Figures describing market data (liquidity, holders, price) change constantly and are intentionally not embedded in this document — see Links for live data.
- Nothing in this document is financial, investment, or legal advice.

---

## 9. Links

- Website: <https://caramelcookiecutter.github.io/503/>
- Mint / token: `GEPa9WUhjfthcuXy7kjwpS3bn9YcpSpdXxkd1nt31Lgc`
- Solscan: <https://solscan.io/token/GEPa9WUhjfthcuXy7kjwpS3bn9YcpSpdXxkd1nt31Lgc>
- Trade on Raydium: <https://raydium.io/swap/?inputMint=sol&outputMint=GEPa9WUhjfthcuXy7kjwpS3bn9YcpSpdXxkd1nt31Lgc>
- Live chart / market data: <https://dexscreener.com/solana/6kd1kwncfebo2xwlccucwvcxehwvqii14dx4aewjskfm>
- Source code: <https://github.com/caramelcookiecutter/503>

---

*This document reflects the deployed implementation as of August 2026 and should be updated as the burn mechanic changes.*

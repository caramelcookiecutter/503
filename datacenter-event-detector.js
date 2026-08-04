/**
 * datacenter-event-detector.js (v2 — direct source polling)
 *
 * Polls each provider's OWN newsroom directly, rather than aggregating
 * third-party news coverage. This mirrors the poll-and-diff pattern
 * oracle-reporter.js already uses for outage monitoring (per the
 * whitepaper: "a poll-and-diff strategy for providers using incident.io or
 * platforms without resolved-history endpoints") — same trust model as the
 * burn mechanic: a company's own official channel is the authoritative
 * record of its own status, no third-party corroboration required.
 *
 * This replaces the original approach (NewsAPI aggregation + 5-distinct-
 * domain threshold). That threshold existed only to compensate for
 * third-party syndication noise; going straight to source removes the need
 * for it entirely, since there's nothing to corroborate — a company
 * announcing its own data center is already a first-party statement, the
 * same way its own status page is a first-party statement about its own
 * uptime.
 *
 * IMPORTANT CAVEATS — read before trusting this unattended:
 *
 * 1. CSS SELECTORS ARE UNVERIFIED. The sandbox this was written in has no
 *    network access, so `articleLinkSelector` below for each provider is a
 *    placeholder, not something inspected against the live DOM. Open each
 *    newsroom page yourself, inspect the actual markup, and fill in real
 *    selectors before this will extract anything. Selectors will also
 *    break whenever a site redesigns — this is inherently more fragile
 *    than the Statuspage/incident.io APIs the burn oracle uses, which are
 *    built specifically to be machine-readable and don't change on a
 *    marketing team's whim.
 *
 * 2. CHECK FOR RSS FIRST. Before relying on HTML scraping, check whether
 *    each newsroom publishes an RSS/Atom feed (commonly at /feed,
 *    /rss.xml, or linked in the page <head>). A feed is far more stable
 *    than scraping and should be preferred wherever available — swap
 *    fetchNewsroomArticles' implementation for feed parsing if so.
 *
 * 3. "Opening" classification is still keyword-based, not a real
 *    event-stage classifier. A company's own PR framing of "opens" doesn't
 *    guarantee full operational status either; official announcements can
 *    overstate readiness same as anyone else's.
 *
 * 4. Location matching is still a heuristic (seeded gazetteer + generic
 *    "City, ST" pattern) — expect misses on unusual phrasing.
 *
 * 5. NOT TESTED against live sites. Validate against real output before
 *    wiring into an unattended cron job.
 *
 * Converted from TypeScript to plain JS to match burn-weekly.js's
 * execution model (no build step — runs directly via `node`). Written as
 * ES modules (import/export), confirmed against this project's actual
 * package.json ("type": "module").
 *
 * NOTE: cheerio is not currently in this project's package.json
 * dependencies (checked against the uploaded file) — run
 * `npm install cheerio` before this will resolve.
 */

import fs from "fs";
import * as cheerio from "cheerio"; // npm install cheerio — not yet in package.json

// ---- Config ----

const EVENT_LOG_PATH = "./datacenter-events.json";
const SEEN_ARTICLES_PATH = "./seen-articles.json"; // poll-and-diff state, mirrors oracle-reporter.js's pattern

const ELIGIBLE_PROVIDERS = ["OpenAI", "Anthropic", "Google", "xAI"];

// TODO: verify these selectors against the live page — placeholders below
// are a reasonable first guess based on common blog-listing markup, not
// confirmed against the actual DOM.
const PROVIDER_SOURCES = [
  {
    provider: "OpenAI",
    newsroomUrl: "https://openai.com/news/",
    articleLinkSelector: "a[href*='/news/']", // TODO: verify
  },
  {
    provider: "Anthropic",
    newsroomUrl: "https://www.anthropic.com/news",
    articleLinkSelector: "a[href*='/news/']", // TODO: verify
  },
  {
    provider: "Google",
    newsroomUrl: "https://cloud.google.com/blog",
    articleLinkSelector: "a[href*='/blog/']", // TODO: verify — Google Cloud Blog
    // specifically, since that's where their infrastructure/TPU capacity
    // announcements actually get published, not the general blog.google
    // company blog. Worth double-checking this is still the right property
    // by the time this runs.
  },
  {
    provider: "xAI",
    newsroomUrl: "https://x.ai/news",
    articleLinkSelector: "a[href*='/news/']", // TODO: verify
  },
];

const OPENING_KEYWORDS = [
  "online",
  "opens",
  "opened",
  "launched",
  "operational",
  "goes live",
  "comes online",
  "now running",
  "now open",
];

// Seeded gazetteer of known/likely sites, built from the Aug 2026 research
// pass. Extend this as new sites get announced — it's the main lever for
// improving location-match recall.
const KNOWN_SITES = [
  { location: "Abilene, Texas", providers: ["OpenAI"] },
  { location: "Shackelford County, Texas", providers: ["OpenAI"] },
  { location: "Doña Ana County, New Mexico", providers: ["OpenAI"] },
  { location: "Port Washington, Wisconsin", providers: ["OpenAI"] },
  { location: "Milam County, Texas", providers: ["OpenAI"] },
  { location: "Saline Township, Michigan", providers: ["OpenAI"] },
  { location: "Lordstown, Ohio", providers: ["OpenAI"] },
  { location: "Georgia", providers: ["OpenAI"] },
  { location: "New Carlisle, Indiana", providers: ["Anthropic"] },
  { location: "Texas", providers: ["Anthropic"] },
  { location: "New York", providers: ["Anthropic"] },
  { location: "Memphis, Tennessee", providers: ["xAI"] },
];

// Generic fallback pattern: "City, ST" or "City, State". Loose on purpose —
// false positives are still possible even without the old 5-source filter,
// so treat unmatched/odd results with the same skepticism noted above.
const GENERIC_LOCATION_PATTERN =
  /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*),\s([A-Z]{2}|[A-Z][a-zA-Z]+)\b/g;

// ---- Fetching (direct source, no third-party aggregation) ----

async function fetchNewsroomArticles(source) {
  const res = await fetch(source.newsroomUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${source.provider} newsroom: ${res.status}`
    );
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const articles = [];
  $(source.articleLinkSelector).each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr("href");
    if (!title || !href) return;
    const absoluteUrl = new URL(href, source.newsroomUrl).toString();
    articles.push({ provider: source.provider, title, url: absoluteUrl });
  });

  return articles;
}

// ---- Poll-and-diff state ----

function loadSeenUrls() {
  if (!fs.existsSync(SEEN_ARTICLES_PATH)) return new Set();
  const raw = fs.readFileSync(SEEN_ARTICLES_PATH, "utf-8");
  return new Set(JSON.parse(raw));
}

function saveSeenUrls(urls) {
  fs.writeFileSync(SEEN_ARTICLES_PATH, JSON.stringify([...urls], null, 2));
}

// ---- Classification ----

function classifyOpeningStage(text) {
  const lower = text.toLowerCase();
  return OPENING_KEYWORDS.some((kw) => lower.includes(kw));
}

function extractLocation(text, provider) {
  for (const site of KNOWN_SITES) {
    if (
      site.providers.includes(provider) &&
      text.toLowerCase().includes(site.location.toLowerCase())
    ) {
      return site.location;
    }
  }
  const matches = [...text.matchAll(GENERIC_LOCATION_PATTERN)];
  return matches.length > 0 ? matches[0][0] : null;
}

// ---- Event log I/O ----
// Expected shape of each entry in datacenter-events.json:
//   { provider: string, description: string, date: "YYYY-MM-DD" }

function loadExistingLog() {
  if (!fs.existsSync(EVENT_LOG_PATH)) return [];
  return JSON.parse(fs.readFileSync(EVENT_LOG_PATH, "utf-8"));
}

function appendToLog(newEvents) {
  const existing = loadExistingLog();
  fs.writeFileSync(
    EVENT_LOG_PATH,
    JSON.stringify([...existing, ...newEvents], null, 2)
  );
}

// ---- Runner ----

async function main() {
  const seenUrls = loadSeenUrls();
  const newlyConfirmed = [];
  const skippedNoLocation = [];

  for (const source of PROVIDER_SOURCES) {
    let articles;
    try {
      articles = await fetchNewsroomArticles(source);
    } catch (err) {
      console.error(`[${source.provider}] fetch failed:`, err);
      continue; // one provider's site being down/redesigned shouldn't kill the whole run
    }

    const unseenArticles = articles.filter((a) => !seenUrls.has(a.url));

    for (const article of unseenArticles) {
      seenUrls.add(article.url); // mark seen regardless of match, so we don't re-check it forever

      if (!classifyOpeningStage(article.title)) continue;

      const location = extractLocation(article.title, article.provider);
      if (!location) {
        skippedNoLocation.push(article);
        continue;
      }

      newlyConfirmed.push({
        provider: article.provider,
        description: `${article.provider} data center — ${location} (source: ${article.url})`,
        date: new Date().toISOString().split("T")[0],
      });
    }
  }

  console.log("=== Data Center Event Detection (direct-source) ===");
  console.log(`Newly confirmed events: ${newlyConfirmed.length}`);
  newlyConfirmed.forEach((e) => console.log(`  + ${e.description}`));

  if (skippedNoLocation.length > 0) {
    console.log(
      `\nOpening-stage articles with no location match (review manually — may indicate a gazetteer gap):`
    );
    skippedNoLocation.forEach((a) =>
      console.log(`  ? [${a.provider}] "${a.title}" — ${a.url}`)
    );
  }

  if (newlyConfirmed.length > 0) {
    appendToLog(newlyConfirmed);
    console.log(`\nAppended ${newlyConfirmed.length} event(s) to ${EVENT_LOG_PATH}`);
  }

  saveSeenUrls(seenUrls);
}

main().catch(console.error);

export { fetchNewsroomArticles, classifyOpeningStage, extractLocation };

// profiles.js
// Retrieves and caches the CIID May 2026/27 Interaction Design Programme
// student profiles ONCE, when the server starts — not on every interaction.
// If the network isn't reachable, falls back to the last cache written to disk.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(__dirname, "data", "profiles.cache.json");
const BATCH_URL = "https://www.ciid.dk/idp-batch/may-2026-27";
const FETCH_TIMEOUT_MS = 10000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let cachedProfiles = [];

function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/‍/g, "") // zero-width joiner Webflow uses as an empty paragraph
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&rsquo;|&lsquo;|’|‘/g, "'")
    .replace(/&rdquo;|&ldquo;|”|“/g, '"')
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function parseRoster(html) {
  const re =
    /<a href="\/community\/([a-z0-9-]+)" class="idp-batch-student-link[^"]*">\s*<div[^>]*>([^<]+)<\/div>\s*<\/a>\s*<div[^>]*>([^<]*)<\/div>/g;
  const roster = [];
  let m;
  while ((m = re.exec(html))) {
    roster.push({
      slug: m[1],
      name: stripTags(m[2]),
      country: stripTags(m[3]),
    });
  }
  return roster;
}

function parseBio(html) {
  // The bio lives in the first rich-text block that follows the <h1> name.
  const afterH1 = html.split(/<h1 class="type-new-h1">/)[1];
  if (!afterH1) return null;
  const block = afterH1.match(
    /<div class="rich-text-block-2 w-richtext">([\s\S]*?)<\/div>\s*<div class="w-layout-hflex people-links"/
  );
  const raw = block ? block[1] : null;
  if (!raw) return null;
  const text = stripTags(raw);
  return text.length > 0 ? text : null;
}

async function scrapeLive() {
  const rosterHtml = await fetchWithTimeout(BATCH_URL);
  const roster = parseRoster(rosterHtml);
  if (roster.length === 0) {
    throw new Error("Roster page returned no recognizable student links.");
  }

  const students = [];
  for (const entry of roster) {
    const url = `https://www.ciid.dk/community/${entry.slug}`;
    try {
      const html = await fetchWithTimeout(url);
      const bio = parseBio(html);
      students.push({
        name: entry.name,
        slug: entry.slug,
        country: entry.country,
        url,
        bio: bio || "",
      });
    } catch (err) {
      console.warn(`[profiles] could not fetch bio for ${entry.name}: ${err.message}`);
      students.push({ name: entry.name, slug: entry.slug, country: entry.country, url, bio: "" });
    }
  }
  return students;
}

async function loadDiskCache() {
  const raw = await fs.readFile(CACHE_PATH, "utf-8");
  const json = JSON.parse(raw);
  return json.students || [];
}

async function writeDiskCache(students) {
  const payload = {
    source: BATCH_URL,
    fetchedAt: new Date().toISOString(),
    students,
  };
  await fs.writeFile(CACHE_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

/**
 * Called once at server startup. Tries to scrape fresh profiles from the
 * live CIID site; on any failure (offline, site change, timeout) it falls
 * back to whatever was cached on disk from a previous run/seed.
 */
export async function loadProfiles() {
  try {
    console.log(`[profiles] fetching live roster from ${BATCH_URL} ...`);
    const students = await scrapeLive();
    const withBio = students.filter((s) => s.bio && s.bio.length > 20);
    if (withBio.length < students.length * 0.5) {
      throw new Error("Too many profiles came back without a usable bio; page structure may have changed.");
    }
    cachedProfiles = students;
    await writeDiskCache(students);
    console.log(`[profiles] cached ${students.length} fresh profiles from the live site.`);
  } catch (err) {
    console.warn(`[profiles] live fetch failed (${err.message}). Falling back to disk cache.`);
    try {
      cachedProfiles = await loadDiskCache();
      console.log(`[profiles] loaded ${cachedProfiles.length} profiles from disk cache.`);
    } catch (diskErr) {
      console.error(`[profiles] no disk cache available either: ${diskErr.message}`);
      cachedProfiles = [];
    }
  }
  return cachedProfiles;
}

export function getProfiles() {
  return cachedProfiles;
}

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (Mößnang -> mossnang-ish)
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

// Simple Levenshtein distance for fuzzy first-name / full-name matching
// against noisy speech-to-text transcripts.
function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

const FILLER = /\b(my name is|i am|i'm|it is|it's|this is|call me|name's)\b/gi;

/**
 * Fuzzy-matches a raw speech transcript (e.g. "uh my name is taylor") against
 * the cached profile roster. Returns { profile, score } or null if nothing
 * clears the confidence threshold.
 */
export function matchProfileByName(transcript) {
  if (!transcript) return null;
  const cleaned = normalize(transcript.replace(FILLER, " "));
  const spokenTokens = cleaned.split(/\s+/).filter(Boolean);
  if (spokenTokens.length === 0) return null;

  let best = null;
  for (const profile of cachedProfiles) {
    const full = normalize(profile.name);
    const parts = full.split(/\s+/);
    const first = parts[0];
    const last = parts[parts.length - 1];

    const candidates = [
      similarity(cleaned, full),
      similarity(spokenTokens[0] || "", first),
      similarity(spokenTokens[spokenTokens.length - 1] || "", last),
      cleaned.includes(first) ? 0.85 : 0,
      cleaned.includes(last) ? 0.8 : 0,
    ];
    const score = Math.max(...candidates);
    if (!best || score > best.score) best = { profile, score };
  }

  if (best && best.score >= 0.55) return best;
  return null;
}

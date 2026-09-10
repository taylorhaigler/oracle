// profiles.js (static-demo client port)
// Same fuzzy name-matching logic as server/profiles.js, but running entirely
// in the browser against a bundled JSON file instead of a live API — this
// is what lets the GitHub Pages build work with no backend at all.

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents (Mößnang -> mossnang-ish)
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

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

export async function loadProfiles() {
  const res = await fetch("./data/profiles.json");
  const data = await res.json();
  return data.students || [];
}

/**
 * Fuzzy-matches a raw speech transcript against the loaded profile roster.
 * Returns { profile, score } or null if nothing clears the threshold.
 */
export function matchProfileByName(transcript, profiles) {
  if (!transcript) return null;
  const cleaned = normalize(transcript.replace(FILLER, " "));
  const spokenTokens = cleaned.split(/\s+/).filter(Boolean);
  if (spokenTokens.length === 0) return null;

  let best = null;
  for (const profile of profiles) {
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

  // Slightly loosened from 0.55 — the browser's speech recognizer is often
  // noisy on names it doesn't know, so a bit more tolerance here catches
  // more real matches without asking people to repeat themselves.
  if (best && best.score >= 0.5) return best;
  return null;
}

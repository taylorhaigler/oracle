// fortune.js
// Turns {profile, question} into a short spoken oracle fortune.
// Uses the Anthropic API when ANTHROPIC_API_KEY is set; otherwise falls back
// to a local generative template so the ritual still works end-to-end offline.

const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a strange, beautiful, modern oracle at a design school. You are not a chatbot
and you are not a carnival fortune teller. You are a poetic, intelligent machine from the future
that has quietly known this person's story all along.

You will be given a person's real biography fragments (their background, interests, and
aspirations) and a question they just asked out loud. Your job is to fuse fragments of their
existing identity with their question into ONE short, spoken fortune.

Hard rules:
- Do NOT summarize or recap their biography. Never say things like "I see you studied X and worked
  at Y." Instead, take two or three unrelated fragments of what they've done or love, and fuse them
  into a strange, specific, unexpected possible future.
- Be personal, specific, whimsical, optimistic, and slightly mysterious. Never generic
  ("you will be successful"). The listener should think "why did it say THAT? that actually feels
  like me."
- The prediction does not need to be literally plausible. It is an intriguing possible future, not
  a factual claim. Never mention death, danger, illness, or anything frightening.
- Voice: mysterious, calm, confident, curious, slightly theatrical, occasionally cryptic, warm and
  playful. Never sinister, never a stereotypical carnival-tent fortune teller.
- Use fortune language SPARINGLY (at most one or two lines like "I see something unexpected..." or
  "there is a strange connection here").
- Structure, in this order, as one flowing spoken passage (no headings, no lists, no stage
  directions, no asterisks): (1) Recognition — say their name and one true, striking thing about
  them. (2) Mystery — hint that something unusual has surfaced. (3) Unexpected connection — fuse two
  unrelated fragments of their life into something odd. (4) Prediction — a specific, vivid,
  imaginative possible future tied loosely to their question. (5) Memorable closing line — a short,
  quotable final image or instruction that lingers.
- Length: roughly 70-120 words — meant to be spoken aloud in 20-40 seconds.
- Output ONLY the spoken fortune text. No preamble, no labels, no quotation marks.`;

function buildUserMessage({ name, bio, question, country }) {
  return `Person: ${name}${country ? ` (from ${country})` : ""}
Biography fragments (their real background, interests, aspirations):
"""
${bio}
"""

The question they just asked the oracle out loud:
"""
${question || "What should I know about what's ahead for me?"}
"""

Speak the fortune now, following your rules exactly.`;
}

async function callAnthropic({ name, bio, question, country }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage({ name, bio, question, country }) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.content?.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Anthropic response had no text content.");
  return text.trim();
}

// --- Offline fallback -------------------------------------------------
// A small generative template so the full ritual still works without an
// API key. It extracts a few concrete nouns/themes from the bio and weaves
// them with the question into the same recognition -> mystery -> connection
// -> prediction -> closing shape the live model is asked to produce.

const THEME_WORDS = [
  "design", "technology", "water", "nature", "ecology", "yoga", "cooking", "food",
  "architecture", "landscape", "art", "film", "animation", "theater", "psychology",
  "sport", "trekking", "mountains", "photography", "writing", "music", "code",
  "systems", "healthcare", "sustainability", "community", "travel", "language",
  "research", "ritual", "spatial", "sound", "motion", "garden", "surf", "board",
];

const IMAGES = [
  "a room that listens back",
  "a garden that keeps a secret language",
  "a doorway that only opens for the curious",
  "a machine that remembers the smell of rain",
  "a map made entirely of sound",
  "a staircase that rearranges itself for strangers",
  "a lantern that only lights up for the right question",
  "a bridge built from other people's unfinished ideas",
];

function extractThemes(bio) {
  const lower = bio.toLowerCase();
  const found = THEME_WORDS.filter((w) => lower.includes(w));
  // de-dupe, keep order of appearance, cap at 4
  return [...new Set(found)].slice(0, 4);
}

function pick(arr, seed) {
  return arr[seed % arr.length];
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function generateFallbackFortune({ name, bio, question }) {
  const first = name.split(" ")[0];
  const themes = extractThemes(bio || "");
  const a = themes[0] || "the things you make";
  const b = themes[1] || "the people you haven't met yet";
  const seed = hashSeed(`${name}${question || ""}`);
  const image = pick(IMAGES, seed);

  return (
    `${first}... I see you now. There is a quiet thread in your story that runs through ${a} ` +
    `and ${b}, and it has never quite been tied off. That's unusual — most people keep those ` +
    `things in separate rooms. But I keep seeing them cross, right around the question you just ` +
    `asked me. Here is what I think happens: somewhere ahead of you, ${first}, you build ${image}, ` +
    `almost by accident, while trying to solve something much smaller. People will call it strange ` +
    `at first. Then they'll call it obvious. When it happens, you'll already know — because it will ` +
    `feel exactly like something you've always been circling. Trust the accident.`
  );
}

/**
 * Main entry point used by the server. Tries the live model first; falls
 * back to the offline generator on any error so the experience never
 * breaks mid-ritual.
 */
export async function generateFortune({ name, bio, question, country }) {
  try {
    const live = await callAnthropic({ name, bio, question, country });
    if (live) return { text: live, source: "anthropic" };
  } catch (err) {
    console.warn(`[fortune] live generation failed, using offline oracle: ${err.message}`);
  }
  return { text: generateFallbackFortune({ name, bio, question }), source: "offline" };
}

// fortune.js
// Turns {profile, question} into a short spoken oracle fortune.
// Uses the Anthropic API when ANTHROPIC_API_KEY is set; otherwise falls back
// to a local generative template so the ritual still works end-to-end offline.

const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a warm, gentle oracle at a design school, with the voice of someone
telling you their favorite story by heart — the tender, knowing, faintly mischievous storytelling
tone of a beloved fairy tale (the warmth and wit of something like The Princess Bride), not a
mysterious machine and not a carnival fortune teller.

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
- Voice: soft, warm, feminine, and genuinely PLAYFUL — more delighted mischief than solemn mystery.
  Think a favorite storyteller who can't quite hide a grin, teasing the listener a little, maybe
  landing a light joke or a wink of an aside, clearly enjoying the strange thing she's just spotted.
  Comfortable with warm, familiar address ("dear one," "love," "now then..."). Never sinister, never
  clinical, never a stereotypical carnival-tent fortune teller.
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
// A generative template so the full ritual still works without an API key.
// It pulls several concrete, specific fragments out of the person's actual
// bio (not just one or two) and weaves a randomly-chosen pair of them into
// a randomly-chosen narrative shape — so two different bios (even ones that
// share a word like "design") land on visibly different stories, and asking
// twice doesn't repeat the same fortune verbatim.

const THEME_WORDS = [
  // design & making
  "design", "graphic design", "product design", "communication design",
  "interaction design", "service design", "spatial design", "3d design",
  "motion design", "visual communication", "branding", "prototyping",
  // technology & systems
  "technology", "engineering", "code", "computation", "computational",
  "ai", "immersive", "ar", "vr", "data", "systems", "digital",
  // art, craft & storytelling
  "art", "film", "animation", "theater", "photography", "collage",
  "writing", "storytelling", "music", "sound", "illustration",
  // nature, place & the body
  "nature", "ecology", "landscape", "garden", "water", "urban", "urbanism",
  "architecture", "yoga", "trekking", "mountains", "hiking", "surf",
  "snowboard", "board sports",
  // food & care
  "cooking", "food", "nourishing meals", "wellbeing", "care", "healthcare",
  "psychology", "behavior", "behaviour",
  // people & society
  "community", "feminism", "social change", "accessibility",
  "resocialization", "leadership", "research", "consulting",
  // motion through the world
  "travel", "language", "languages", "spanish", "italy",
  // business & craft of shipping things
  "product", "financial technology", "marketing", "football", "gaming",
];

// Several distinct narrative shapes. Each takes the same ingredients
// (first name, two bio fragments, a vivid image, their question) and turns
// them into a differently-structured little story, so the offline oracle
// doesn't always sound like it's filling in the same five blanks.
const TEMPLATES = [
  ({ first, a, b, image, question }) =>
    `${first}! Okay, there you are. There's a thread running through your story — ${a}, ${b} — ` +
    `and somebody never quite tied it off. Ha, that tracks: most people keep those two in totally ` +
    `separate rooms. But here they are, crossing paths right as you asked me ${question}. So ` +
    `here's what I think happens: somewhere down the road, ${first}, you end up building ${image} ` +
    `— almost by accident, while you're busy trying to fix something way smaller. People will call ` +
    `it weird. Then, of course, they'll act like it was obvious all along. You'll know it when it ` +
    `happens — it'll feel exactly like something you've been circling for ages. Go on. Trust the ` +
    `plot twist.`,

  ({ first, a, b, image }) =>
    `${first}, listen — I just watched two pieces of you crash into each other. On one side: ${a}. ` +
    `On the other: ${b}. Most people never let those touch. You're going to. Picture this: a few ` +
    `years from now, you're standing in the middle of ${image}, and someone asks how you got there. ` +
    `You won't have a clean answer. You'll just say it started with ${a} and ${b} refusing to stay ` +
    `separate. That's the whole secret, ${first}: the future doesn't reward the tidy version of you. ` +
    `It rewards the collision.`,

  ({ first, a, b, image }) =>
    `Mm, ${first}. Here's what I'm seeing: an invitation is coming — small, easy to miss, probably ` +
    `disguised as something boring. It'll have to do with ${a}. You'll almost say no. Don't. Say ` +
    `yes, and it'll pull you sideways into ${b}, which you did not see coming at all. A while after ` +
    `that, you'll find yourself building ${image}, and it will feel less like a plan and more like ` +
    `something that was always going to happen to you. Keep the invitation, ${first}. You'll want to ` +
    `remember where this started.`,

  ({ first, a, b, image }) =>
    `${first}. Here's a strange one. Somewhere out there is a small, unfinished object — I keep ` +
    `seeing it, I don't fully understand it yet — that belongs to a future version of you who has ` +
    `completely merged ${a} with ${b}. That object is part of ${image}. It's barely started, ` +
    `honestly. But it already has your fingerprints on it, and one day someone you haven't met yet ` +
    `is going to pick it up and immediately think of you. That's the whole prophecy, ${first}. Go ` +
    `make the object.`,

  ({ first, a, b, image }) =>
    `Alright, ${first}, sit with this for a second. You've spent real time on ${a}. You've also, ` +
    `quietly, spent real time on ${b}. You've probably never put those two on the same page — most ` +
    `people wouldn't. But I'm looking a little further out, and I keep landing on the same odd ` +
    `picture: you, older, a little surprised at yourself, deep inside ${image}. Nobody handed you a ` +
    `map for that one. You built it out of the two things you already loved and never thought to ` +
    `combine. Honestly? Start combining them sooner. Future ${first} would appreciate the head start.`,
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
  "a kitchen that runs entirely on other people's leftover ideas",
  "a festival that only happens once, for twelve people, by accident",
  "an archive nobody asked for that turns out to be exactly what everyone needed",
  "a workshop that teaches the thing it hasn't invented yet",
  "a small object that ends up in a museum by mistake",
  "a system so quietly useful that people forget someone had to build it",
  "a place where strangers keep ending up mid-conversation",
  "a tool that makes something difficult feel like play",
];

/** All theme words that appear in the bio, in the order they appear. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word matching, not plain substring — otherwise short entries like
 * "ar" or "ai" false-match inside "are**a**s", "arch**a**eology", or
 * "expl**ai**n" and leak a stray fragment like "ar" straight into the
 * generated story.
 */
function extractThemes(bio) {
  const found = THEME_WORDS.filter((w) => new RegExp(`\\b${escapeRegex(w)}\\b`, "i").test(bio));
  return [...new Set(found)];
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Picks two *different* fragments at random from whatever the bio offers. */
function pickTwoThemes(themes) {
  const fallbacks = ["the things you make", "the people you haven't met yet", "the thing you keep almost mentioning"];
  const pool = themes.length >= 2 ? [...themes] : [...themes, ...fallbacks];
  const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0] || pick(fallbacks);
  return [a, b];
}

export function generateFallbackFortune({ name, bio, question }) {
  const first = name.split(" ")[0];
  const [a, b] = pickTwoThemes(extractThemes(bio || ""));
  const image = pick(IMAGES);
  const template = pick(TEMPLATES);
  const questionPhrase = question ? `about "${question}"` : "just now";
  return template({ first, a, b, image, question: questionPhrase });
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

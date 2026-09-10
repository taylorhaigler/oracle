// fortune.js
// Turns {profile, question} into a short spoken oracle fortune.
// Uses the Anthropic API when ANTHROPIC_API_KEY is set; otherwise falls back
// to a local generative template so the ritual still works end-to-end offline.

const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a warm, playful oracle at a design school who reads a kind of tarot
that exists only in your own head — a deck nobody else has ever seen, full of cards you invent on
the spot: things like "The Unlit Lantern," "The Second Door," "The Understudy," "The Loose Thread."
Every reading, you draw ONE such card — invent a brand-new, specific, evocative name for it right
then, decide whether it lands upright or reversed, and read it for the person in front of you.

You will be given a person's real biography fragments and a question they just asked out loud.
IMPORTANT: the invented card and what it means should carry almost all of the imagination here —
the bio is a light seasoning, not the main ingredient. Do NOT build the reading primarily out of
their literal biography (no "I see you studied X and did Y"). At most one brief, glancing aside may
wink at something from their life; the rest of the reading should come from the card itself.

Hard rules:
- Invent a fresh, specific, evocative card name every single time — never reuse a card, never use a
  real tarot card name (no "The Fool," "The Tower," "The Star," etc.) — invent your own in that
  spirit, unique to this reading.
- State plainly whether it's upright or reversed. Reversed means a twist, a delay, or a complication
  — never a disaster.
- The card's meaning should be a vivid, oddly specific scenario or image about their future — never
  generic ("you will be successful"). Tie it loosely to their question. The listener should think
  "why did it say THAT?" and also feel weirdly seen.
- The prediction does not need to be literally plausible — it's an intriguing possible future, not a
  factual claim. Never mention death, danger, illness, or anything frightening.
- Voice: warm, playful, a little mischievous — like a sharp friend who takes tarot just seriously
  enough to be fun, not a solemn mystic. Casual, warm, occasionally teasing. Never sinister, never
  clinical, never a stereotypical carnival-tent fortune teller.
- Vary your opening line and structure every time. Don't reach for the same beat twice in a row —
  surprise yourself as much as the listener.
- Length: roughly 70-120 words — meant to be spoken aloud in 20-40 seconds.
- Output ONLY the spoken reading. No headings, no stage directions, no asterisks, no preamble, no
  quotation marks.`;

function buildUserMessage({ name, bio, question, country }) {
  return `Person: ${name}${country ? ` (from ${country})` : ""}
Biography fragments (their real background, interests, aspirations — use sparingly, as optional
flavor only; do not structure the reading around this):
"""
${bio}
"""

The question they just asked the oracle out loud:
"""
${question || "What should I know about what's ahead for me?"}
"""

Draw a card and give the reading now, following your rules exactly.`;
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
// Rather than leaning on the person's bio (which made two people with
// overlapping keywords sound alike), this draws from an invented tarot-style
// deck — its own vivid card, upright or reversed, interpreted on the spot —
// so the *card* carries the whimsy and uniqueness, and the bio is at most a
// light, occasional garnish rather than the whole structure.

const DECK = [
  { name: "The Unlit Lantern",
    upright: "a plan you're holding onto right before you're ready to strike the match",
    reversed: "waiting for a permission that was never going to arrive, when you could just light it yourself" },
  { name: "The Second Door",
    upright: "the option nobody mentions, sitting quietly next to the obvious one",
    reversed: "a door you already walked through once without noticing" },
  { name: "The Runaway Kite",
    upright: "something you built that's about to outgrow your hands completely",
    reversed: "still gripping a string long after it stopped needing you to" },
  { name: "The Patient Fire",
    upright: "an idea that isn't ready yet, and knows it, and is in absolutely no hurry",
    reversed: "an idea that's been ready for a while now — you're the one stalling" },
  { name: "The Borrowed Compass",
    upright: "good advice from someone who has no idea it was good advice",
    reversed: "steering by somebody else's north for far too long" },
  { name: "The Upside-Down Garden",
    upright: "growth that looks like chaos until you stand somewhere else",
    reversed: "everything growing exactly the right way up — you're the one upside down" },
  { name: "The Folded Map",
    upright: "a shortcut you already own and haven't unfolded yet",
    reversed: "taking the long way on purpose, and quietly loving it" },
  { name: "The Loud Silence",
    upright: "a room about to go quiet right before something good happens in it",
    reversed: "a good thing that already happened — somebody's about to tell you the story" },
  { name: "The Half-Finished Bridge",
    upright: "a collaboration that only works because nobody finishes their half alone",
    reversed: "trying to finish someone else's half by yourself, when you should just wait for them" },
  { name: "The Left-Handed Star",
    upright: "recognition arriving from the exact direction you stopped watching",
    reversed: "still watching the wrong direction entirely" },
  { name: "The Accidental Key",
    upright: "a small skill you dismissed that's about to open something enormous",
    reversed: "the right key, aimed at the wrong door, for a while now" },
  { name: "The Second Chance Coin",
    upright: "a door you assumed had closed, quietly still open",
    reversed: "checking whether it's closed instead of just walking through it" },
  { name: "The Backwards Clock",
    upright: "doing the steps out of order and somehow arriving early anyway",
    reversed: "doing them in the 'correct' order, which is exactly what's making you late" },
  { name: "The Long Way Home",
    upright: "a detour that turns out to be the actual point of the trip",
    reversed: "rushing straight past the part that actually mattered" },
  { name: "The Understudy",
    upright: "a quieter version of you, rehearsing, about to be handed the lead with no warning",
    reversed: "someone who's been the lead the whole time, still acting like backup" },
  { name: "The Late Bloomer",
    upright: "timing that looks wrong until you can finally see the whole season",
    reversed: "not late at all — everyone else quietly early, and not admitting it" },
  { name: "The Almost Yes",
    upright: "a hesitation you should, just this once, completely ignore",
    reversed: "a yes you already gave, that you haven't told anyone about yet — including yourself" },
  { name: "The Loose Thread",
    upright: "one small unresolved thing about to unravel into the actual answer",
    reversed: "a thread you keep quietly re-tying instead of just pulling" },
  { name: "The Uninvited Idea",
    upright: "a thought that shows up at the worst possible moment and turns out to be exactly right",
    reversed: "an idea you've sent away twice already, currently on its way back a third time" },
  { name: "The Empty Chair",
    upright: "a seat being kept for you, at a table you haven't found yet",
    reversed: "a table you've been standing near for a while now, chair and all" },
];

// Five different reading styles, so the same card can still sound like a
// different reading depending on which one gets picked.
const TEMPLATES = [
  ({ first, card, meaning, question }) =>
    `Alright, ${first}, let's see what turns up. I'm drawing you a card... here it is: ${card.name}. ` +
    `That one's about ${meaning}. Picture it — you, a while from now, right in the middle of that. ` +
    `${question}It won't look like a plan from the outside. It rarely does. Trust the card.`,

  ({ first, card, meaning, question }) =>
    `Ooh, okay. I drew you ${card.name}, ${first}. That's about ${meaning}. ${question}That's the ` +
    `whole reading, honestly — short, a little strange, exactly the kind of thing you ignore for ` +
    `two weeks and then can't stop thinking about.`,

  ({ first, card, meaning }) =>
    `Mm. ${card.name}. ${first}, of all the cards to land on you, that's a good one to sit with — ` +
    `or an annoying one, depending on how you take advice. It's about ${meaning}. Either way, ` +
    `something's about to ask you to notice it. Don't pretend you didn't.`,

  ({ first, card, meaning, question }) =>
    `Here's your card, ${first}: ${card.name}. It's about ${meaning}. I don't make the cards, I ` +
    `just read them, and this one's got your name written all over it — practically. ${question}` +
    `Keep an eye out. It'll be smaller than you expect.`,

  ({ first, card, meaning }) =>
    `${first}. ${card.name} — that one showed up fast, which usually means something. It's about ` +
    `${meaning}. So here's the read: whatever you're waiting for permission to do, that's your ` +
    `permission. Go on, then.`,
];

// A light, occasional touch of the bio — never the backbone of the reading,
// just a wink to show the oracle noticed. Deliberately used rarely (see
// BIO_TOUCH_CHANCE below).
const THEME_WORDS = [
  "design", "technology", "art", "film", "animation", "theater", "music",
  "photography", "writing", "nature", "ecology", "water", "architecture",
  "yoga", "trekking", "cooking", "food", "psychology", "community",
  "feminism", "research", "consulting", "travel", "language", "engineering",
];
const BIO_TOUCH_CHANCE = 0.3;
const BIO_TOUCH_PHRASES = [
  (t) => `(Somewhere in here, your history with ${t} is smiling a little.) `,
  (t) => `Funny, given how much of you is already tangled up in ${t}. `,
  (t) => `Feels like it's aimed a little at the ${t} in you. `,
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word matching so short entries can't false-match inside longer words. */
function findThemes(bio) {
  return [...new Set(THEME_WORDS.filter((w) => new RegExp(`\\b${escapeRegex(w)}\\b`, "i").test(bio)))];
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateFallbackFortune({ name, bio, question }) {
  const first = name.split(" ")[0];
  const card = pick(DECK);
  const reversed = Math.random() < 0.4;
  const meaning = reversed ? card.reversed : card.upright;
  const cardName = reversed ? `${card.name}, reversed` : card.name;

  const questionPhrase = question ? `You asked me about "${question}". ` : "";

  const themes = findThemes(bio || "");
  const bioTouch = themes.length && Math.random() < BIO_TOUCH_CHANCE ? pick(BIO_TOUCH_PHRASES)(pick(themes)) : "";

  const template = pick(TEMPLATES);
  return template({ first, card: { name: cardName }, meaning, question: questionPhrase + bioTouch });
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

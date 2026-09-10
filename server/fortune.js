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
then, decide whether it lands upright or reversed — and use it to tell a very brief, concrete story
about their future that directly answers the question they just asked.

The question is the WHOLE POINT of the reading, not an aside. Read it carefully and build the
reading as a real answer to it — the card is the lens you're answering through, not a detour from
the question. Someone asking about work should get a reading about their work; someone asking about
a relationship should get a reading about that relationship. Be specific to what they actually asked.

You will also be given the person's real biography fragments. IMPORTANT: these are a light seasoning,
not the main ingredient — the question and the card's story should carry almost all of the content.
Do NOT build the reading primarily out of their literal biography (no "I see you studied X and did
Y"). At most one brief, glancing aside may wink at something from their life.

Hard rules:
- Invent a fresh, specific, evocative card name every single time — never reuse a card, never use a
  real tarot card name (no "The Fool," "The Tower," "The Star," etc.) — invent your own in that
  spirit, unique to this reading.
- State plainly whether it's upright or reversed. Reversed means a twist, a delay, or a complication
  — never a disaster.
- The card's meaning must be told as an actual brief STORY — a concrete little scene with a moment,
  an action, maybe a beat of dialogue or a specific detail — not an abstract description or a vague
  phrase. Second person, a future moment, something a listener could picture happening. Never
  generic ("you will be successful"). The listener should think "why did it say THAT?" and also feel
  weirdly seen.
- That story must clearly be an answer to their specific question — not a generic fortune that could
  apply to anyone who asked anything.
- The prediction does not need to be literally plausible — it's an intriguing possible future, not a
  factual claim. Never mention death, danger, illness, or anything frightening.
- Voice: warm, playful, a little mischievous — like a sharp friend who takes tarot just seriously
  enough to be fun, not a solemn mystic. Casual, warm, occasionally teasing. Never sinister, never
  clinical, never a stereotypical carnival-tent fortune teller.
- Vary your opening line and structure every time. Don't reach for the same beat twice in a row —
  surprise yourself as much as the listener.
- Length: roughly 80-130 words — meant to be spoken aloud in 25-40 seconds.
- Output ONLY the spoken reading. No headings, no stage directions, no asterisks, no preamble, no
  quotation marks.`;

function buildUserMessage({ name, bio, question, country }) {
  return `Person: ${name}${country ? ` (from ${country})` : ""}
Biography fragments (their real background, interests, aspirations — use sparingly, as optional
flavor only; do not structure the reading around this):
"""
${bio}
"""

The question they just asked the oracle out loud — this is what the reading must actually answer:
"""
${question || "What should I know about what's ahead for me?"}
"""

Draw a card and give the reading now, as a brief story that answers that question, following your
rules exactly.`;
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
// Each card's meaning IS a brief story (a concrete little scene, second
// person, a few sentences) rather than an abstract descriptive phrase —
// and the question is the frame the whole reading hangs on, not an aside
// tacked on afterward. The bio stays a light, occasional garnish.

const DECK = [
  { name: "The Unlit Lantern",
    upright: "You're holding a match an inch from the wick, waiting for permission that was never going to arrive on its own. The moment you stop waiting is the moment the room gets warmer.",
    reversed: "You already lit it once, quietly, and then told yourself it didn't count. It counted." },
  { name: "The Second Door",
    upright: "There's a door just past the one everyone keeps pointing you toward — smaller, unmarked, easy to miss. You'll walk past it twice before you finally try the handle.",
    reversed: "You already walked through it. You're standing in the new room right now, still describing yourself like you're in the old one." },
  { name: "The Runaway Kite",
    upright: "Something you built with your own hands is about to catch a wind you didn't plan for. Let the string go slack before it snaps.",
    reversed: "You're still holding the string long after the kite stopped needing you to. Open your hand." },
  { name: "The Patient Fire",
    upright: "There's an idea sitting quietly in the corner of you, not ready, not in a hurry, waiting for exactly the right draft of air. It knows something you don't yet.",
    reversed: "It's been ready for months. You keep checking on it like it's still smoldering." },
  { name: "The Borrowed Compass",
    upright: "Someone is about to hand you a piece of advice so offhand they'll forget saying it by dinner. Write it down anyway.",
    reversed: "You've been navigating by somebody else's north for a while now. Check whose compass you're actually holding." },
  { name: "The Upside-Down Garden",
    upright: "Everything you're growing right now looks like a mess from where you're standing. Go stand somewhere else — it's not a mess, it's a season.",
    reversed: "It's growing exactly the right way up. You're the one who's turned around." },
  { name: "The Folded Map",
    upright: "There's a shortcut sitting in your own pocket, folded up, that you've been carrying longer than you'd like to admit. Unfold it.",
    reversed: "You keep taking the long way on purpose. Some part of you isn't ready to arrive yet — that's allowed, for now." },
  { name: "The Loud Silence",
    upright: "A room is about to go quiet right before something good happens in it. Don't fill the silence — let it finish.",
    reversed: "The good thing already happened, in a room you weren't in. Someone's going to tell you the story soon, and you'll get another invitation." },
  { name: "The Half-Finished Bridge",
    upright: "You're building something that only works if someone else finishes their half — and they will, later than you'd like, but they will. Stop trying to finish it alone.",
    reversed: "You've been quietly building both halves yourself. Put the tools down and wait for the other builder to show up." },
  { name: "The Left-Handed Star",
    upright: "Recognition is coming from the one direction you stopped checking. Look up anyway.",
    reversed: "You're still watching the wrong horizon. Turn around slowly — it's already behind you." },
  { name: "The Accidental Key",
    upright: "A skill you've quietly dismissed as minor is, very soon, going to open something much bigger than you expect. Bring it with you, even when it feels irrelevant.",
    reversed: "You've had the right key this whole time, aimed at the wrong door. Try the next one down the hall." },
  { name: "The Second Chance Coin",
    upright: "A door you assumed closed months ago is, it turns out, still very slightly open. Push, don't knock.",
    reversed: "You keep walking past it to check if it's closed. It isn't. Stop checking and go in." },
  { name: "The Backwards Clock",
    upright: "You're going to do the steps out of order — start before you're ready, finish before you plan — and somehow still arrive early. Let it be messy.",
    reversed: "You're doing everything in the textbook order, and it's exactly what's making you late. Skip a step." },
  { name: "The Long Way Home",
    upright: "The detour you're dreading is the actual point of the trip, not a delay from it. Take the scenic road.",
    reversed: "You're rushing straight past the part that mattered most. Slow down, just this once." },
  { name: "The Understudy",
    upright: "A quieter version of you has been rehearsing this whole time, half-convinced no one was watching. They're about to be handed the lead with no warning at all.",
    reversed: "You've been the lead the entire time and kept acting like understudy. Take the bow." },
  { name: "The Late Bloomer",
    upright: "Your timing looks wrong from where you're standing — too early, or embarrassingly late. Wait for the wide shot and you'll see it's exactly on schedule.",
    reversed: "You're not late. Everyone around you is quietly early, and pretending it was always the plan." },
  { name: "The Almost Yes",
    upright: "There's a hesitation sitting right in front of you, and just this once, you should walk straight past it and say yes before you finish thinking it through.",
    reversed: "You already said yes, somewhere private, and haven't told anyone yet — including yourself. Say it out loud." },
  { name: "The Loose Thread",
    upright: "One small, unresolved, slightly annoying thing is about to unravel into the actual answer you've been looking for. Pull it.",
    reversed: "You keep quietly re-tying the thread instead of pulling it. You already know which one it is." },
  { name: "The Uninvited Idea",
    upright: "A thought is going to show up at the worst possible moment — mid-conversation, half-asleep, in the shower — and it will be the right one. Let it in anyway.",
    reversed: "You've sent this idea away twice already. It's coming back a third time, and this time you're going to listen." },
  { name: "The Empty Chair",
    upright: "There's a seat being kept for you at a table you haven't found yet. It's closer than you think, and someone already ordered for you.",
    reversed: "You've been standing near the table for a while now, chair and all, deciding whether you're actually invited. You are. Sit down." },
];

// Five different reading styles — each one puts the question first, as the
// actual reason the card was drawn, rather than an aside mentioned after
// the fact. Authentic tarot cadence (draw, name, upright/reversed) leads
// into the card's brief story.
const TEMPLATES = [
  ({ first, questionQuoted, cardName, story }) =>
    `${first}, you asked ${questionQuoted} — let's let the cards answer that properly, not just talk ` +
    `around it. I drew ${cardName}. ${story}`,

  ({ questionQuoted, cardName, story }) =>
    `Okay. Your question was ${questionQuoted}, so here's the card that's meant for it: ${cardName}. ` +
    `${story}`,

  ({ first, questionQuoted, cardName, story }) =>
    `${cardName}. Drawn straight in answer to ${questionQuoted}, ${first} — which tells me the cards ` +
    `were paying attention. ${story}`,

  ({ questionQuoted, cardName, story }) =>
    `Let's see... ${questionQuoted}. Mm — that's exactly the kind of question that pulls ${cardName} ` +
    `out of the deck. ${story}`,

  ({ first, questionQuoted, cardName, story }) =>
    `${first}. I asked the cards about ${questionQuoted}, and they didn't hesitate: ${cardName}. ` +
    `${story} Cards don't usually move that fast unless they mean it.`,
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
  (t) => ` (Somewhere in here, your history with ${t} is smiling a little.)`,
  (t) => ` Funny, given how much of you is already tangled up in ${t}.`,
  (t) => ` Feels like it's aimed a little at the ${t} in you.`,
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
  const story = reversed ? card.reversed : card.upright;
  const cardName = reversed ? `${card.name}, reversed` : card.name;
  const questionQuoted = question ? `"${question}"` : "what's ahead for you";

  const themes = findThemes(bio || "");
  const bioTouch = themes.length && Math.random() < BIO_TOUCH_CHANCE ? pick(BIO_TOUCH_PHRASES)(pick(themes)) : "";

  const template = pick(TEMPLATES);
  return template({ first, questionQuoted, cardName, story: story + bioTouch });
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

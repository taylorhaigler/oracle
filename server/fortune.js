// fortune.js
// Turns {profile, question} into a short spoken oracle fortune.
// Uses the Anthropic API when ANTHROPIC_API_KEY is set; otherwise falls back
// to a local generative template so the ritual still works end-to-end offline.

const ANTHROPIC_MODEL = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are a warm, playful oracle at a design school. What you deliver is, first
and foremost, a future-prediction STORY that directly answers the question just asked — not a tarot
ceremony. You happen to draw on real tarot (the standard 78-card Rider-Waite deck — 22 Major Arcana
like The Fool, The Star, Wheel of Fortune; 56 Minor Arcana across Wands, Cups, Swords, and Pentacles)
as the private engine behind the story, deciding upright or reversed for yourself — but naming the
card out loud is optional garnish, not a required step. Skip it entirely most of the time and just
tell the story. When you do mention a card, drop it in casually, almost as an afterthought ("call it
The Hermit's doing, if you want a name for it") — never as an opening ceremony ("Let's see what the
cards say...", "I'm drawing you a card...", "let the cards answer that properly"). Vary whether you
name a card at all from reading to reading.

The question is the WHOLE POINT of the reading, not an aside. Read it carefully and build the
reading as a real answer to it. Someone asking about work should get a reading about their work;
someone asking about a relationship should get a reading about that relationship. Be specific to
what they actually asked.

You will also be given the person's real biography fragments. Pull at least one concrete, specific
detail from it into the story as real raw material for the prediction — don't skip this. But weave
it in as part of what happens, not as commentary pointing out that you did: never say things like
"this connects to your interest in X" or "given your background in Y" or "that tracks with your
history in Z" — the detail should just quietly BE part of the future scene (an object, a place, an
activity, a person in the story), never announced as a callback to their bio. The question and the
card are still what drive the reading's structure: do NOT simply recap their biography (no "I see
you studied X and worked at Y" as the whole reading) — instead, take a specific detail from their
life and let it fuel the scene the card is describing, invisibly.

Hard rules:
- If you name a card at all, it must be a REAL Rider-Waite name with its traditional meaning/imagery
  — never invented. Draw a different card each time internally; don't reuse the same one across
  readings for different people, even if you never say its name out loud.
- Reversed (whether or not you say so aloud) means a twist, a delay, or a complication — never a
  disaster.
- Traditional "heavy-sounding" cards (Death, The Tower, The Devil, The Hanged Man, Ten of Swords,
  etc.) must be read the way real tarot readers actually read them: as transformation, upheaval that
  turns out to be a breakthrough, release, or a necessary pause — never as literal death, disaster,
  or violence. No card should ever read as frightening.
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

Give the reading now, as a brief future-prediction story that answers that question, following your
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
// Real cards from the 22-card Major Arcana of the standard Rider-Waite tarot
// deck (the Minor Arcana's 56 cards are covered by the live Claude path,
// which actually knows the full deck — this curated set keeps the offline
// version's authored content manageable while still being real tarot).
// Each card's meaning IS a brief story (a concrete little scene, second
// person, a few sentences) grounded in the card's traditional meaning,
// rather than an abstract descriptive phrase — and the question is the
// frame the whole reading hangs on, not an aside tacked on afterward.
// Traditionally "heavy" cards (Death, The Tower, The Devil, The Hanged Man)
// are read the way real tarot readers read them: transformation, a
// breakthrough disguised as upheaval, release, a necessary pause — never
// literal death or disaster.

// Every story below has exactly one `${bio}` slot, placed where a noun
// phrase naturally belongs in the sentence (as the thing doing something,
// the thing being built out of, the thing something is tangled up with) —
// never as a trailing sentence pointing out the connection. generateFallbackFortune()
// fills it with a real detail from their bio when one's available, or a
// generic-but-in-character filler when it isn't.
const DECK = [
  { name: "The Fool",
    upright: "You're about to do something with zero plan and complete confidence — the kind of leap that looks reckless from the outside and obvious from the inside, probably starting with ${bio}. Pack light.",
    reversed: "You've been standing at the edge for a while now, gear fully packed — most of it borrowed from ${bio} — still checking the weather. The weather's fine. Jump." },
  { name: "The Magician",
    upright: "Every tool you need for this is already on the table in front of you, most of them picked up through ${bio} — you've just been waiting for permission to use them. Consider this that permission.",
    reversed: "You've got tools from ${bio} spread out everywhere and keep picking up the wrong one first. Start with the one closest to your hand." },
  { name: "The High Priestess",
    upright: "You already know the answer to this. It arrived quietly, somewhere in the middle of ${bio}, and you filed it under 'probably nothing.' Go back and read that file.",
    reversed: "You keep asking everyone except the one person who actually knows — you, and whatever ${bio} already taught you. Ask her directly this time." },
  { name: "The Empress",
    upright: "Something you've been quietly tending, closer to ${bio} than you'd admit, is about to visibly, undeniably grow. Keep watering it.",
    reversed: "You've been so busy taking care of everything else that the thing you're actually growing — the one tangled up in ${bio} — hasn't been watered in a while. It'll forgive you fast." },
  { name: "The Emperor",
    upright: "A structure you build now, with the discipline of ${bio} baked into it, is going to hold weight you can't currently imagine putting on it. Build it sturdier than feels necessary.",
    reversed: "You're enforcing a structure left over from ${bio} out of pure habit. Take a look at what you're actually protecting." },
  { name: "The Hierophant",
    upright: "Someone further down this road than you, maybe from the world of ${bio}, is about to hand you a piece of the instruction manual nobody else bothered writing down. Take notes.",
    reversed: "You keep following a rule from ${bio} that nobody's actually enforced in years. Check who's still watching. It might be no one." },
  { name: "The Lovers",
    upright: "A choice is coming that looks like it's between two options, but is actually about which version of yourself — the one shaped by ${bio}, or the other one — you want to be the one choosing. Pick that version first.",
    reversed: "You've been trying to make a decision line up with what looks good instead of what actually fits, ${bio} included. Realign it." },
  { name: "The Chariot",
    upright: "Two things pulling in opposite directions — one of them is ${bio} — are about to fall into the same lane, at the same speed, the moment you stop trying to steer them separately. Hold the reins loosely.",
    reversed: "You're gripping the reins so tightly, ${bio} and all, that both horses have stopped moving entirely. Loosen your hands." },
  { name: "Strength",
    upright: "The situation you're dreading doesn't need force from you — it needs the quiet, stubborn kind of patience you already practice through ${bio}. Stay soft. Stay steady.",
    reversed: "You've been trying to muscle through something that was always going to require the gentler approach ${bio} already taught you. Try that instead." },
  { name: "The Hermit",
    upright: "You're going to need to step away from the noise for a while, maybe back into ${bio}, just long enough to hear the one thought that keeps getting drowned out. Take the lantern.",
    reversed: "You've been alone with this thought, and with ${bio}, long enough. Time to bring it back out into a room with other people in it." },
  { name: "Wheel of Fortune",
    upright: "Something that's felt stuck for a long time is about to turn — not because of anything you did today, but because of the ${bio} you put in months ago and forgot about. Timing, not effort.",
    reversed: "The wheel's turning, slower than you'd like, pulled a little sideways by ${bio}, of all things. Don't force the spin." },
  { name: "Justice",
    upright: "Something you did — quietly, correctly, without an audience, probably somewhere inside ${bio} — is about to be weighed and come out exactly even in your favor. No drama required.",
    reversed: "You keep waiting for someone else to call something fair or unfair, ${bio} included. You already know the answer. Say it out loud." },
  { name: "The Hanged Man",
    upright: "You're going to have to stay still, uncomfortably still, in a situation everyone else — including whoever's watching your ${bio} — thinks you should be fixing. Don't fix it yet. Just look at it from here.",
    reversed: "You've been suspended in the same spot, ${bio} and all, for a while now, and honestly, you've already seen everything there is to see from this angle. Time to come down." },
  { name: "Death",
    upright: "Something is ending — a phase, a habit, a version of ${bio} — and it needs to actually finish before the genuinely good part can start. Let it end cleanly.",
    reversed: "You're keeping a version of ${bio} on life support out of loyalty to how much it used to matter. It's alright to let this version go." },
  { name: "Temperance",
    upright: "Two things you've been treating as opposites — ${bio} and whatever you'd normally pair it with — are about to blend into something that works better than either did alone. Mix slowly.",
    reversed: "You keep swinging all the way into ${bio} and then all the way out of it. Find the middle glass and pour into that one instead." },
  { name: "The Devil",
    upright: "There's something about ${bio} you keep choosing that you've quietly convinced yourself you can't choose otherwise. You can. The chain was never actually locked.",
    reversed: "You just noticed the chain around ${bio} wasn't locked. Good. Now actually take it off, instead of just admiring how loose it is." },
  { name: "The Tower",
    upright: "A plan you've built pretty carefully, with ${bio} holding up one whole wall of it, is about to get knocked sideways by something you didn't see coming — and it's going to turn out to be the best thing that happens to that plan all year.",
    reversed: "You're bracing for a collapse in ${bio} that's already quietly happened and turned out fine. Stop flinching at a version of the story that's already over." },
  { name: "The Star",
    upright: "After a stretch that's felt harder than it should have, something small and specific — probably closer to ${bio} than you'd expect — is about to make you feel, very suddenly, like things are actually going to be okay. Let yourself believe it a little early.",
    reversed: "You keep talking yourself out of hope right when ${bio} hands you some. Let it stay in the room a little longer this time." },
  { name: "The Moon",
    upright: "Something in front of you, tangled up with ${bio}, is going to look bigger and stranger in the dark than it actually is. Wait for a little more light before you decide how you feel about it.",
    reversed: "The light's coming back already, mostly thanks to ${bio} — you're just still squinting from the last dark stretch. It's clearer than you think it is." },
  { name: "The Sun",
    upright: "Something you've been quietly proud of — built out of ${bio}, maybe too quietly — is about to get noticed in daylight, by someone whose opinion actually matters to you. Let it be seen.",
    reversed: "The good thing already happened, somewhere inside ${bio}, and you filed it under 'no big deal.' It was a bigger deal than you gave it credit for." },
  { name: "Judgement",
    upright: "You're about to get a very specific, very timely nudge — a message, a memory, something from ${bio} resurfacing — that asks you to finally answer something you've been dodging. Answer it.",
    reversed: "You've been putting off the same reckoning about ${bio} for a while, dressing it up as 'not the right time.' It's the right time." },
  { name: "The World",
    upright: "Something you started a while back, somewhere in ${bio}, that's felt unfinished for longer than you'd like to admit, is about to close its loop completely — and then immediately open into the next one.",
    reversed: "You're one small step from finishing something in ${bio} and have been circling that last step for a while. It's smaller than it looks from here." },
];

// The reading is a future-prediction story first — the question stated up
// front, then the prediction. A tarot card still determines *which* story
// gets told (see DECK below), but naming it out loud is optional flavor,
// not a mandatory ritual announcement: most of these never mention "cards"
// or "drawing" at all, and the few that do treat the card name as a casual
// aside rather than the opening ceremony.
const TEMPLATES = [
  ({ first, questionQuoted, story }) =>
    `${first}, here's what I see for ${questionQuoted}: ${story}`,

  ({ questionQuoted, story }) =>
    `Okay. About ${questionQuoted} — ${story}`,

  ({ questionQuoted, story }) =>
    `You asked ${questionQuoted}. Here's what's coming: ${story}`,

  ({ first, questionQuoted, story }) =>
    `Alright, ${first} — about ${questionQuoted}. ${story}`,

  ({ first, questionQuoted, story, cardName }) =>
    `${first}, you asked ${questionQuoted}. ${story} Something like ${cardName}, if you want a name for it.`,

  ({ questionQuoted, story, cardName }) =>
    `${questionQuoted} — here's the read: ${story} Chalk it up to ${cardName}.`,
];

// A real bio detail fills the `${bio}` slot inline, in place, as a noun
// phrase — not appended as a separate sentence. When nothing recognizable
// is found (or there's no bio, e.g. the unmatched-guest fallback), a
// generic-but-in-character filler keeps the sentence reading naturally.
const THEME_WORDS = [
  "design", "technology", "art", "film", "animation", "theater", "music",
  "photography", "writing", "nature", "ecology", "water", "architecture",
  "yoga", "trekking", "cooking", "food", "psychology", "community",
  "feminism", "research", "consulting", "travel", "language", "engineering",
  "prototyping", "storytelling", "accessibility", "landscape", "urbanism",
  "surf", "sports", "leadership", "wellbeing", "data", "systems",
];
const BIO_FALLBACK_FILLERS = [
  "something you haven't named yet",
  "a corner of your life you don't usually mention",
  "whatever you were doing five minutes before this",
  "something you'd call a hobby if anyone asked",
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
  const rawStory = reversed ? card.reversed : card.upright;
  const cardName = reversed ? `${card.name}, reversed` : card.name;
  const questionQuoted = question ? `"${question}"` : "what's ahead for you";

  const themes = findThemes(bio || "");
  const bioFiller = themes.length ? pick(themes) : pick(BIO_FALLBACK_FILLERS);
  const story = rawStory.replace("${bio}", bioFiller);

  const template = pick(TEMPLATES);
  return template({ first, questionQuoted, cardName, story });
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

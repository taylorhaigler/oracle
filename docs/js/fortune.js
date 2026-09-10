// fortune.js (static-demo client port)
// The GitHub Pages build has no server to call Anthropic from (and never
// should ship an API key to a static page), so it always uses this same
// offline generator that server/fortune.js falls back to.
//
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

export function generateFortune({ name, bio, question }) {
  const first = name.split(" ")[0];
  const card = pick(DECK);
  const reversed = Math.random() < 0.4;
  const meaning = reversed ? card.reversed : card.upright;
  const cardName = reversed ? `${card.name}, reversed` : card.name;

  const questionPhrase = question ? `You asked me about "${question}". ` : "";

  const themes = findThemes(bio || "");
  const bioTouch = themes.length && Math.random() < BIO_TOUCH_CHANCE ? pick(BIO_TOUCH_PHRASES)(pick(themes)) : "";

  const template = pick(TEMPLATES);
  const text = template({ first, card: { name: cardName }, meaning, question: questionPhrase + bioTouch });

  return { text, source: "offline" };
}

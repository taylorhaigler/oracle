// fortune.js (static-demo client port)
// The GitHub Pages build has no server to call Anthropic from (and never
// should ship an API key to a static page), so it always uses this same
// offline generative template that server/fortune.js falls back to.

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

export function generateFortune({ name, bio, question }) {
  const first = name.split(" ")[0];
  const themes = extractThemes(bio || "");
  const a = themes[0] || "the things you make";
  const b = themes[1] || "the people you haven't met yet";
  const seed = hashSeed(`${name}${question || ""}`);
  const image = pick(IMAGES, seed);

  const text =
    `${first}... there you are, dear one. There is a quiet thread in your story that runs through ` +
    `${a} and ${b}, and it has never once been tied off. That's rare — most people keep those ` +
    `things in separate rooms of themselves. But I keep seeing them cross, right around the ` +
    `question you just asked me. Now, here is what I think happens: somewhere ahead of you, ` +
    `${first}, you build ${image}, almost by accident, while you're busy solving something much ` +
    `smaller. People will call it strange at first. Then, dear one, they'll call it obvious. And ` +
    `when it happens, you'll already know — because it will feel exactly like something you've ` +
    `been circling all along. Trust the turn of the tale.`;

  return { text, source: "offline" };
}

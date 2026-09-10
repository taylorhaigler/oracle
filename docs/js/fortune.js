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
    `${first}! Okay, there you are. There's a thread running through your story — ${a}, ${b} — ` +
    `and somebody never quite tied it off. Ha, that tracks: most people keep those two in totally ` +
    `separate rooms. But here they are, crossing paths right as you asked me that question. So ` +
    `here's what I think happens: somewhere down the road, ${first}, you end up building ${image} ` +
    `— almost by accident, while you're busy trying to fix something way smaller. People will call ` +
    `it weird. Then, of course, they'll act like it was obvious all along. You'll know it when it ` +
    `happens — it'll feel exactly like something you've been circling for ages. Go on. Trust the ` +
    `plot twist.`;

  return { text, source: "offline" };
}

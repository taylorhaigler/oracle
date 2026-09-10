// tts.js
// Real, human-sounding speech via the ElevenLabs API — used when
// ELEVENLABS_API_KEY is set. The browser's built-in Web Speech voices
// (see public/js/speech.js) are always the fallback, so the ritual works
// fine without this, just with a more synthetic-sounding voice.

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Default: "Lily" — warm, mature, British, a genuine storyteller quality.
// Override with your own ElevenLabs voice ID (from your Voice Library) via
// ELEVENLABS_VOICE_ID if you'd like a different one.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku";
// Turbo trades a little quality for speed — worth it here since the fortune
// is already spoken live, and the "thinking" visual state comfortably
// absorbs a second or two of synthesis latency.
const MODEL_ID = "eleven_turbo_v2_5";
const ELEVENLABS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;

export const ttsAvailable = Boolean(ELEVENLABS_API_KEY);

/**
 * Synthesizes `text` and returns an MP3 buffer. Throws on any failure —
 * callers should fall back to the browser's own TTS rather than surface
 * this to the ritual.
 */
export async function synthesizeSpeech(text) {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");

  const res = await fetch(ELEVENLABS_URL, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        // Lower stability + higher style = more expressive/playful delivery
        // rather than a flat, even narration.
        stability: 0.4,
        similarity_boost: 0.75,
        style: 0.6,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${errText.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

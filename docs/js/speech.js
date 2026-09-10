// speech.js
// Thin wrappers around the Web Speech API: an oracle "voice" (TTS) and an
// ear (STT) for capturing the spoken name and question.

export class OracleVoice {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voice = null;
    this._loadVoice();
    if (this.synth && this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = () => this._loadVoice();
    }

    // If a server is running (the full app) and has an ElevenLabs key
    // configured, prefer that for a genuinely human-sounding voice. On the
    // static GitHub Pages build there's no server at all, so this check
    // fails fast and every line just uses the browser voice below — same
    // code, no fork needed between the two builds.
    this.remoteAvailable = false;
    this._audio = null;
    this.ready = this._checkRemote();
  }

  async _checkRemote() {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) return;
      const data = await res.json();
      this.remoteAvailable = Boolean(data.hasVoiceKey);
    } catch {
      this.remoteAvailable = false;
    }
  }

  _loadVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    if (!voices.length) return;
    // Browser TTS quality varies a lot by engine. Edge's "Online (Natural)"
    // voices and Chrome's Google voices are genuinely neural and sound far
    // more human than classic offline voices like Samantha — so try those
    // first, then fall back down through decent offline options.
    this.voice =
      voices.find((v) => /online \(natural\)/i.test(v.name) && /female|aria|jenny|ana|michelle|emma/i.test(v.name)) ||
      voices.find((v) => /online \(natural\)/i.test(v.name)) ||
      voices.find((v) => v.name === "Google US English") ||
      voices.find((v) => v.name === "Google UK English Female") ||
      voices.find((v) => ["Samantha", "Ava", "Karen", "Moira", "Tessa", "Victoria", "Serena"].includes(v.name)) ||
      voices.find((v) => /female/i.test(v.name) && /en/i.test(v.lang)) ||
      voices.find((v) => /en/i.test(v.lang)) ||
      voices[0];
  }

  get supported() {
    return Boolean(this.synth);
  }

  /**
   * Speaks `text`. Resolves when speech ends. `onBoundary(charIndex)` fires
   * as each word is reached (browser voice only), so the caller can reveal
   * captions in sync.
   */
  async speak(text, { onStart, onBoundary, onEnd } = {}) {
    if (this.remoteAvailable) {
      const ok = await this._speakRemote(text, { onStart, onEnd });
      if (ok) return;
      // Remote failed for this line only — fall through to the browser
      // voice rather than breaking the ritual. Keep remoteAvailable true
      // so the *next* line still tries the good voice first.
    }
    return this._speakBrowser(text, { onStart, onBoundary, onEnd });
  }

  /** Returns true on success, false on any failure (caller falls back). */
  async _speakRemote(text, { onStart, onEnd }) {
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return false;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this._audio = audio;
      await new Promise((resolve) => {
        audio.onplay = () => onStart?.();
        const finish = () => {
          URL.revokeObjectURL(url);
          if (this._audio === audio) this._audio = null;
          onEnd?.();
          resolve();
        };
        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(finish);
      });
      return true;
    } catch {
      return false;
    }
  }

  _speakBrowser(text, { onStart, onBoundary, onEnd }) {
    return new Promise((resolve) => {
      if (!this.synth) {
        onStart?.();
        onEnd?.();
        resolve();
        return;
      }
      this.synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      if (this.voice) utter.voice = this.voice;
      // Soft, warm, and unhurried — a bedtime-story cadence rather than a
      // deep "mysterious oracle" register or a clipped assistant one.
      utter.pitch = 1.08;
      utter.rate = 0.9;
      utter.volume = 1;
      utter.onstart = () => onStart?.();
      utter.onboundary = (e) => onBoundary?.(e.charIndex);
      utter.onend = () => {
        onEnd?.();
        resolve();
      };
      utter.onerror = () => {
        onEnd?.();
        resolve();
      };
      this.synth.speak(utter);
    });
  }

  stop() {
    this.synth?.cancel();
    if (this._audio) {
      this._audio.pause();
      this._audio.currentTime = 0;
      this._audio = null;
    }
  }
}

/**
 * Lists the browser's audio input devices with human-readable labels
 * (e.g. "RODE NT-USB Mini"). Labels are blank until mic permission has been
 * granted for this page, so this briefly requests + immediately releases
 * the mic if needed just to unlock them.
 *
 * Important limitation: this tells you whether the browser/OS can *see*
 * a device — it does NOT let you force the Web Speech API's
 * SpeechRecognition to use one specific device. That part is controlled by
 * the OS's default input device and/or the browser's own mic permission
 * picker (Chrome shows a device dropdown in its permission prompt when more
 * than one input exists). See the README for how to point it at a specific
 * mic.
 */
export async function listAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    const needsLabels = devices.some((d) => d.kind === "audioinput" && !d.label);
    if (needsLabels && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch {
        // Permission denied, or no mic at all — return whatever we have,
        // likely still unlabeled.
      }
    }
    return devices.filter((d) => d.kind === "audioinput");
  } catch {
    return [];
  }
}

export class OracleEar {
  constructor() {
    const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(Impl);
    this.Impl = Impl;
    this.recognition = null;
    this.listening = false;
  }

  /**
   * Listens for one utterance. Calls `onSpeechDetected()` the moment any
   * sound/interim result arrives (used to drive the dev-panel status light),
   * `onError(errorCode)` with the raw SpeechRecognition error string if one
   * fires (e.g. "network", "not-allowed", "no-speech", "audio-capture") —
   * this is the main way to tell "no mic access" apart from "browser can't
   * actually run recognition at all" — and resolves with the best
   * transcript, or "" on silence/timeout/error.
   */
  listen({ onSpeechDetected, onError, timeoutMs = 15000 } = {}) {
    return new Promise((resolve) => {
      if (!this.supported) {
        onError?.("unsupported");
        resolve("");
        return;
      }
      const rec = new this.Impl();
      this.recognition = rec;
      rec.lang = "en-US";
      // `continuous: true` stops Chrome from applying its own aggressive
      // internal "no speech yet" cutoff (often ~5s) and ending the session
      // before the person even starts talking. We still end on our own
      // once a final result or error comes in, or our own (generous)
      // timeoutMs elapses — this just gives a real, unhurried window to
      // start speaking instead of racing Chrome's internal timer.
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;

      let settled = false;
      let heardAnything = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.listening = false;
        try { rec.abort(); } catch { /* noop */ }
        resolve(value);
      };

      const timer = setTimeout(() => finish(""), timeoutMs);

      rec.onresult = (event) => {
        if (!heardAnything) {
          heardAnything = true;
          onSpeechDetected?.();
        }
        const result = event.results[event.results.length - 1];
        if (result.isFinal) {
          finish(result[0]?.transcript?.trim() || "");
        }
      };
      rec.onspeechstart = () => {
        if (!heardAnything) {
          heardAnything = true;
          onSpeechDetected?.();
        }
      };
      rec.onerror = (event) => {
        // Many non-Google Chromium browsers (Arc, Brave, Vivaldi, Opera...)
        // implement the webkitSpeechRecognition *interface* but have no
        // access to Chrome's actual (proprietary, Google-only) recognition
        // backend, so every attempt fails here with "network" or
        // "service-not-allowed" — looking, from the outside, exactly like
        // "the mic isn't registering," even though the mic itself is fine.
        // Guard against reporting our own cleanup-triggered "aborted" error
        // after we've already resolved.
        if (!settled) onError?.(event?.error || "unknown");
        finish("");
      };
      rec.onend = () => finish("");

      this.listening = true;
      try {
        rec.start();
      } catch (err) {
        onError?.(err?.message || "start-failed");
        finish("");
      }
    });
  }

  stop() {
    try { this.recognition?.abort(); } catch { /* noop */ }
    this.listening = false;
  }
}

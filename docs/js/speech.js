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
   * and resolves with the best transcript, or "" on silence/timeout/error.
   */
  listen({ onSpeechDetected, timeoutMs = 9000 } = {}) {
    return new Promise((resolve) => {
      if (!this.supported) {
        resolve("");
        return;
      }
      const rec = new this.Impl();
      this.recognition = rec;
      rec.lang = "en-US";
      rec.continuous = false;
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
      rec.onerror = () => finish("");
      rec.onend = () => finish("");

      this.listening = true;
      try {
        rec.start();
      } catch {
        finish("");
      }
    });
  }

  stop() {
    try { this.recognition?.abort(); } catch { /* noop */ }
    this.listening = false;
  }
}

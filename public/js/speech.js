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
  }

  _loadVoice() {
    if (!this.synth) return;
    const voices = this.synth.getVoices();
    if (!voices.length) return;
    // Prefer a soft, warm female voice if one is installed — this is the
    // oracle's storyteller voice, not a flat assistant voice — falling back
    // to any female-sounding voice the browser reports, then anything in
    // English, then whatever's available at all.
    const preferredNames = [
      "Samantha", "Karen", "Moira", "Tessa", "Victoria", "Ava", "Serena",
      "Google UK English Female", "Google US English",
      "Microsoft Zira Desktop - English (United States)",
      "Microsoft Hazel Desktop - English (Great Britain)",
      "Microsoft Aria Online (Natural) - English (United States)",
    ];
    this.voice =
      voices.find((v) => preferredNames.includes(v.name)) ||
      voices.find((v) => /female/i.test(v.name) && /en/i.test(v.lang)) ||
      voices.find((v) => /en/i.test(v.lang)) ||
      voices[0];
  }

  get supported() {
    return Boolean(this.synth);
  }

  /**
   * Speaks `text`. Resolves when speech ends. `onBoundary(charIndex)` fires
   * as each word is reached, so the caller can reveal captions in sync.
   */
  speak(text, { onStart, onBoundary, onEnd } = {}) {
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

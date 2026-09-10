// audio.js
// Procedural ambient soundscape (Web Audio API — no sound files to manage).
// Every ritual state gets its own quiet texture; TTS is always mixed louder
// than any of this.

const STATE_SOUND = {
  idle: { gain: 0.03, freqs: [55, 82.4], filter: 500, lfo: 0.06 },
  awaken: { gain: 0.09, freqs: [110, 164.8, 220], filter: 1400, lfo: 0.4 },
  listening: { gain: 0.015, freqs: [98], filter: 400, lfo: 0.05 },
  searching: { gain: 0.07, freqs: [174.6, 261.6, 329.6], filter: 2200, lfo: 1.1 },
  thinking: { gain: 0.08, freqs: [130.8, 196, 261.6], filter: 1800, lfo: 0.6 },
  reveal: { gain: 0.06, freqs: [196, 293.6, 392], filter: 2600, lfo: 0.2 },
  settle: { gain: 0.04, freqs: [110, 164.8], filter: 900, lfo: 0.15 },
};

export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.masterGain = null;
    this.ready = false;
    this._unlockBound = this._unlock.bind(this);
    document.addEventListener("click", this._unlockBound, { once: true });
    document.addEventListener("keydown", this._unlockBound, { once: true });
  }

  _unlock() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.9;
    this.masterGain.connect(this.ctx.destination);

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 500;
    this.filter.connect(this.masterGain);

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.filter);

    this.lfo = this.ctx.createOscillator();
    this.lfo.frequency.value = 0.1;
    this.lfoGain = this.ctx.createGain();
    this.lfoGain.gain.value = 0.15;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.droneGain.gain);
    this.lfo.start();

    this.oscillators = [];
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = 60;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.droneGain);
      osc.start();
      this.oscillators.push({ osc, gain: g });
    }

    this.ready = true;
    this.setState(this._pendingState || "idle");
  }

  setState(name) {
    if (!this.ready) {
      this._pendingState = name;
      return;
    }
    const cfg = STATE_SOUND[name] || STATE_SOUND.idle;
    const now = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.linearRampToValueAtTime(cfg.filter, now + 2.2);
    this.droneGain.gain.cancelScheduledValues(now);
    this.droneGain.gain.linearRampToValueAtTime(cfg.gain, now + 1.8);
    this.lfo.frequency.linearRampToValueAtTime(cfg.lfo, now + 1.5);

    this.oscillators.forEach((o, i) => {
      const freq = cfg.freqs[i % cfg.freqs.length];
      o.osc.frequency.linearRampToValueAtTime(freq, now + 2);
      o.gain.gain.linearRampToValueAtTime(i === 0 ? 1 : 0.5, now + 2);
    });
  }

  /** A short rising chime — used the instant the oracle awakens. */
  chime({ rising = true } = {}) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const notes = rising ? [392, 523.25, 659.25] : [659.25, 523.25, 392];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.masterGain);
      const t0 = now + i * 0.18;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.linearRampToValueAtTime(0.06, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      osc.start(t0);
      osc.stop(t0 + 1.5);
    });
  }

  /** Soft resolving chord for the moment of revelation. */
  resolve() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    [261.63, 329.63, 392, 523.25].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this.masterGain);
      osc.frequency.setValueAtTime(freq, now);
      g.gain.linearRampToValueAtTime(0.045, now + 0.6 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);
      osc.start(now);
      osc.stop(now + 4.6);
    });
  }
}

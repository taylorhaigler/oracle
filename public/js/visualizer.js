// visualizer.js
// A single breathing orb + particle field rendered on <canvas>. No loading
// spinners, no UI chrome — every ritual state maps to light, color, and
// motion instead.

const STATE_PRESETS = {
  idle: { energy: 0.10, hue: 248, sat: 45, particles: 18, speed: 0.15, jitter: 0.15, mode: "drift" },
  awaken: { energy: 0.5, hue: 40, sat: 70, particles: 70, speed: 0.6, jitter: 0.35, mode: "expand" },
  listening: { energy: 0.28, hue: 190, sat: 55, particles: 26, speed: 0.22, jitter: 0.08, mode: "calm" },
  searching: { energy: 0.6, hue: 300, sat: 65, particles: 90, speed: 1.1, jitter: 0.6, mode: "search" },
  thinking: { energy: 0.55, hue: 265, sat: 70, particles: 100, speed: 0.9, jitter: 0.4, mode: "spiral" },
  reveal: { energy: 1.0, hue: 46, sat: 85, particles: 160, speed: 0.8, jitter: 0.5, mode: "radiate" },
  settle: { energy: 0.35, hue: 260, sat: 50, particles: 40, speed: 0.25, jitter: 0.15, mode: "drift" },
};

function lerp(a, b, t) { return a + (b - a) * t; }

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.time = 0;
    this.current = { ...STATE_PRESETS.idle };
    this.target = { ...STATE_PRESETS.idle };
    this.stateName = "idle";
    this.particles = [];
    this.burstUntil = 0;
    this._resize();
    window.addEventListener("resize", () => this._resize());
    this._seedParticles(120);
    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  _resize() {
    const { innerWidth: w, innerHeight: h } = window;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.w = w;
    this.h = h;
    this.cx = w / 2;
    this.cy = h / 2;
  }

  _seedParticles(n) {
    this.particles = Array.from({ length: n }, () => this._newParticle());
  }

  _newParticle() {
    const angle = Math.random() * Math.PI * 2;
    const radius = 40 + Math.random() * Math.min(this.w, this.h) * 0.45;
    return {
      angle,
      radius,
      baseRadius: radius,
      speed: (Math.random() - 0.5) * 0.6,
      size: 0.6 + Math.random() * 2.2,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.3 + Math.random() * 0.5,
    };
  }

  /** Smoothly move the whole system toward a named ritual state. */
  setState(name) {
    if (!STATE_PRESETS[name]) return;
    this.stateName = name;
    this.target = { ...STATE_PRESETS[name] };
  }

  /** One-shot outward burst, used at the moment of revelation. */
  burst() {
    this.burstUntil = this.time + 1.4;
    for (const p of this.particles) {
      p.radius = 10 + Math.random() * 20;
      p.speed = 1.2 + Math.random() * 1.4;
    }
  }

  _tick(t) {
    this._raf = requestAnimationFrame((tt) => this._tick(tt));
    // Two different dt's on purpose: rAF can be throttled to ~1fps (or
    // paused entirely) when the tab is backgrounded, then deliver one huge
    // gap. Particle motion needs a small, capped dt so it doesn't leap
    // across the screen in one step — but the state->target easing below
    // must use the *real* elapsed time, uncapped, or a state transition
    // (e.g. idle -> awaken) would take real-world minutes to complete
    // whenever frames are sparse.
    const rawDt = (t - (this._last || t)) / 1000;
    const dt = Math.min(rawDt, 0.05);
    const easeDt = Math.min(rawDt, 2);
    this._last = t;
    this.time += dt;

    // Ease current params toward target
    const ease = 1 - Math.pow(0.001, easeDt);
    for (const k of ["energy", "sat", "particles", "speed", "jitter"]) {
      this.current[k] = lerp(this.current[k], this.target[k], ease);
    }
    // Hue is circular (0-360) — lerping it naively sweeps through every
    // color in between (e.g. indigo -> amber would pass through green).
    // Take the shorter arc around the wheel instead.
    let hueDelta = ((this.target.hue - this.current.hue + 540) % 360) - 180;
    this.current.hue = (this.current.hue + hueDelta * ease + 360) % 360;
    this.current.mode = this.target.mode;

    this._draw(dt, easeDt);
  }

  _draw(dt, easeDt) {
    const { ctx, w, h, cx, cy, time, current } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Trailing fade instead of hard clear — gives the light a soft wake.
    // The fade amount tracks real elapsed time (not frame count) so a
    // throttled/backgrounded tab still clears properly once it resumes,
    // instead of leaving stale bright pixels smeared across the canvas.
    const fadeAlpha = 1 - Math.pow(0.001, Math.max(easeDt, dt));
    ctx.fillStyle = `rgba(3, 3, 8, ${fadeAlpha})`;
    ctx.fillRect(0, 0, w, h);

    const breathe = 0.85 + Math.sin(time * (0.6 + current.energy)) * 0.15;
    const coreRadius = (28 + current.energy * 120) * breathe;
    const hue = current.hue % 360;

    // Outer glow
    const glowR = coreRadius * (3.2 + current.energy * 2.2);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    glow.addColorStop(0, `hsla(${hue}, ${current.sat}%, 70%, ${0.35 + current.energy * 0.35})`);
    glow.addColorStop(0.5, `hsla(${hue}, ${current.sat}%, 55%, ${0.12 + current.energy * 0.15})`);
    glow.addColorStop(1, "rgba(3,3,8,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Core orb
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
    core.addColorStop(0, `hsla(${hue}, ${Math.min(current.sat + 20, 100)}%, 92%, 0.95)`);
    core.addColorStop(0.6, `hsla(${hue}, ${current.sat}%, 65%, 0.7)`);
    core.addColorStop(1, `hsla(${hue}, ${current.sat}%, 40%, 0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    // Particle field
    const n = Math.round(current.particles);
    while (this.particles.length < n) this.particles.push(this._newParticle());
    while (this.particles.length > n) this.particles.pop();

    const mode = current.mode;
    for (const p of this.particles) {
      p.phase += dt * (0.5 + current.jitter);
      if (mode === "search") {
        // Pulses inward and back out, like scanning.
        const pull = (Math.sin(time * 2.2 + p.phase) + 1) / 2;
        p.radius = lerp(p.baseRadius * 0.15, p.baseRadius, pull);
        p.angle += dt * current.speed * 0.8;
      } else if (mode === "spiral") {
        p.radius = Math.max(6, p.radius - dt * 14);
        if (p.radius < 10) p.radius = p.baseRadius;
        p.angle += dt * (current.speed + 1.2);
      } else if (mode === "radiate") {
        p.radius += dt * (40 + current.energy * 90) * (0.4 + p.speed);
        if (p.radius > Math.max(w, h) * 0.75) {
          p.radius = 8 + Math.random() * 20;
          p.angle = Math.random() * Math.PI * 2;
        }
        p.angle += dt * current.speed * 0.3;
      } else if (mode === "expand") {
        p.radius = lerp(p.radius, p.baseRadius, dt * 0.8);
        p.angle += dt * current.speed * (0.4 + Math.sin(p.phase) * 0.3);
      } else if (mode === "calm") {
        p.angle += dt * current.speed * 0.25;
        p.radius = p.baseRadius + Math.sin(p.phase) * 6;
      } else {
        // drift
        p.angle += dt * current.speed * 0.2;
        p.radius = p.baseRadius + Math.sin(p.phase * 0.6) * 10;
      }

      const x = cx + Math.cos(p.angle) * p.radius;
      const y = cy + Math.sin(p.angle) * p.radius * 0.92; // slight ellipse
      const twinkle = 0.5 + Math.sin(p.phase * 2.3) * 0.5;
      ctx.beginPath();
      ctx.fillStyle = `hsla(${hue + 20}, ${current.sat}%, 80%, ${p.alpha * twinkle * (0.4 + current.energy * 0.6)})`;
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

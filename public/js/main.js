// main.js
// The ritual's state machine: IDLE -> HAND DETECTED -> AWAKEN -> ASK NAME ->
// LISTEN FOR NAME -> IDENTIFY -> ASK QUESTION -> LISTEN FOR QUESTION ->
// INTERPRET -> GENERATE -> REVEAL -> RETURN TO IDLE.
//
// Physical presence, voice, and light are the interface — this file mostly
// just sequences those three things and keeps the dev panel honest about
// what's really happening underneath.

import { Visualizer } from "./visualizer.js";
import { AmbientAudio } from "./audio.js";
import { OracleVoice, OracleEar } from "./speech.js";

// ---------------------------------------------------------------------
// Oracle script. The name/question prompts stay plain and direct — just
// the ask, no scene-setting. All the personality and playfulness is saved
// for the fortune itself (see the "recognized" transition line and the
// system prompt / offline generator below).
// ---------------------------------------------------------------------
const LINES = {
  greeting: [
    "Hi there. What's your name?",
    "Hey. What's your name?",
    "What's your name?",
  ],
  askNameAgain: [
    "Sorry, didn't catch that. What's your name?",
    "One more time — what's your name?",
  ],
  giveUpOnName: "No worries — let's keep going.",
  recognized: (first) => `Hey, ${first}.`,
  askQuestion: "What's your question?",
  askQuestionAgain: [
    "Didn't catch that — what's your question?",
    "One more time — what's your question?",
  ],
  thinkingMurmur: [
    "Ooh, let's see...",
    "Okay, give me a second...",
    "Hmm, let me think...",
  ],
};

function pick(arr) {
  return Array.isArray(arr) ? arr[Math.floor(Math.random() * arr.length)] : arr;
}

// ---------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------
const canvas = document.getElementById("orb-canvas");
const caption = document.getElementById("caption");
const vision = document.getElementById("vision");
const hint = document.getElementById("hint");

const devPanel = document.getElementById("dev-panel");
const devToggle = document.getElementById("dev-toggle");
const devClose = document.getElementById("dev-close");
const devLogEl = document.getElementById("dev-log");
const devStatusList = document.getElementById("dev-status-list");
const devProfileSelect = document.getElementById("dev-profile-select");
const devNameInput = document.getElementById("dev-name-input");
const devQuestionInput = document.getElementById("dev-question-input");

// ---------------------------------------------------------------------
// Core systems
// ---------------------------------------------------------------------
const visualizer = new Visualizer(canvas);
const audio = new AmbientAudio();
const voice = new OracleVoice();
const ear = new OracleEar();

const session = {
  profile: null,
  question: "",
  fortuneText: "",
  nameAttempts: 0,
  questionAttempts: 0,
  ritualActive: false,
};

let ritualState = "idle";
let allProfiles = [];

// ---------------------------------------------------------------------
// Dev logging + status
// ---------------------------------------------------------------------
function log(msg) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  devLogEl.textContent += `[${time}] ${msg}\n`;
  devLogEl.scrollTop = devLogEl.scrollHeight;
}

function setStatus(key, text, cls) {
  const li = devStatusList.querySelector(`li[data-key="${key}"] span`);
  if (!li) return;
  li.textContent = text;
  li.className = cls || "";
}

function setRitualState(name) {
  ritualState = name;
  setStatus("state", name);
}

// ---------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------
function showCaption(text) {
  caption.textContent = text;
  caption.classList.add("visible");
}
function hideCaption() {
  caption.classList.remove("visible");
}
function showVision(text) {
  vision.textContent = text;
  vision.classList.add("visible");
}
function hideVision() {
  vision.classList.remove("visible");
}

// ---------------------------------------------------------------------
// Speaking helper — mirrors captions + dev "audio playing" status to speech.
// ---------------------------------------------------------------------
async function say(text, { asVision = false } = {}) {
  const show = asVision ? showVision : showCaption;
  const hide = asVision ? hideVision : hideCaption;
  await voice.speak(text, {
    onStart: () => {
      setStatus("audio", "playing", "busy");
      show(text);
    },
    onEnd: () => {
      setStatus("audio", "idle", "ok");
    },
  });
  // Let the line breathe on screen for a moment before it fades.
  await wait(1200);
  hide();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// WebSocket — receives real (or dev-simulated) hand events from the server,
// plus Arduino connection status for the dev panel.
// ---------------------------------------------------------------------
function connectSocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    setStatus("ws", "connected", "ok");
    log("connected to oracle server");
  };
  ws.onclose = () => {
    setStatus("ws", "disconnected", "bad");
    log("lost connection to oracle server — retrying in 2s");
    setTimeout(connectSocket, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === "status") applyServerStatus(msg.status);
    if (msg.type === "hand") handleHandChange(msg.value, msg.origin);
  };

  window.__oracleSocket = ws;
}

function applyServerStatus(status) {
  setStatus(
    "arduino",
    status.arduinoConnected ? `connected (${status.arduinoPort})` : "simulation mode",
    status.arduinoConnected ? "ok" : "busy"
  );
}

// ---------------------------------------------------------------------
// Hand presence -> ritual triggers
// ---------------------------------------------------------------------
function handleHandChange(present, origin = "arduino") {
  log(`hand ${present ? "detected" : "removed"} (${origin})`);
  if (present) {
    if (!session.ritualActive) beginRitual();
  } else {
    // Only interrupt the ritual gracefully if we haven't yet identified the
    // person — once we know who they are, let the ritual finish naturally.
    if (session.ritualActive && !session.profile) {
      log("hand removed before recognition completed — easing back to idle");
      abortRitual();
    }
  }
}

// ---------------------------------------------------------------------
// Generation guard.
//
// The ritual is a long chain of awaited steps (speech, listening, network
// calls). A hand lifted early, a reset, or a dev-panel override fired mid-
// chain must not let that *old* chain keep running once a *new* one has
// taken over — otherwise two fortunes can overlap. Every fresh entry point
// bumps `generation` and hands its own snapshot (`gen`) down the chain;
// each step checks `stale(gen)` right after its `await` and bails quietly
// if a newer generation has since started.
// ---------------------------------------------------------------------
let generation = 0;
function stale(gen) {
  return gen !== generation;
}
/** Starts a fresh generation, silencing whatever the previous one was doing. */
function startGeneration() {
  generation += 1;
  voice.stop();
  ear.stop();
  return generation;
}

function abortRitual() {
  const gen = startGeneration();
  returnToIdle(gen, { immediate: true });
}

// ---------------------------------------------------------------------
// The ritual itself — every function takes `gen`, the generation it was
// started under, and re-checks `stale(gen)` after every await.
// ---------------------------------------------------------------------
async function beginRitual() {
  const gen = startGeneration();
  session.ritualActive = true;
  session.profile = null;
  session.question = "";
  session.nameAttempts = 0;
  session.questionAttempts = 0;
  hint.classList.add("hidden");

  setRitualState("awaken");
  visualizer.setState("awaken");
  audio.setState("awaken");
  audio.chime({ rising: true });
  log("ritual begins: awakening");

  await wait(600);
  if (stale(gen)) return;
  await say(pick(LINES.greeting));
  if (stale(gen)) return;

  await listenForName(gen);
}

async function listenForName(gen) {
  setRitualState("listenName");
  visualizer.setState("listening");
  audio.setState("listening");
  setStatus("mic", "listening", "busy");
  setStatus("speech", "waiting...", "");

  const transcript = await ear.listen({
    onSpeechDetected: () => setStatus("speech", "detected", "ok"),
  });
  setStatus("mic", "idle", "ok");
  log(`heard for name: "${transcript || "(nothing)"}"`);

  if (stale(gen)) return;

  if (!transcript) {
    session.nameAttempts += 1;
    if (session.nameAttempts >= 3) {
      await say(LINES.giveUpOnName);
      if (stale(gen)) return;
      await beginAsGuest(undefined, gen);
      return;
    }
    await say(pick(LINES.askNameAgain));
    if (stale(gen)) return;
    await listenForName(gen);
    return;
  }

  await identify(transcript, gen);
}

async function identify(transcript, gen) {
  setRitualState("identify");
  visualizer.setState("searching");
  audio.setState("searching");
  showVision("searching the archive of names...");
  setStatus("ai", "matching", "busy");

  let result = null;
  try {
    const res = await fetch("/api/match-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript }),
    });
    result = await res.json();
  } catch (err) {
    log(`match-name request failed: ${err.message}`);
  }
  setStatus("ai", "idle", "ok");
  await wait(900); // let the "searching" visual/sound register before resolving
  hideVision();

  if (stale(gen)) return;

  if (result?.matched) {
    log(`matched profile: ${result.profile.name} (score ${result.score.toFixed(2)})`);
    setStatus("profile", result.profile.name, "ok");
    session.profile = result.profile;
    await recognizeAndAskQuestion(result.profile, gen);
    return;
  }

  session.nameAttempts += 1;
  log(`no profile matched for "${transcript}"`);
  if (session.nameAttempts >= 3) {
    await say(LINES.giveUpOnName);
    if (stale(gen)) return;
    await beginAsGuest(transcript, gen);
    return;
  }
  await say(pick(LINES.askNameAgain));
  if (stale(gen)) return;
  await listenForName(gen);
}

async function beginAsGuest(rawName = "traveler", gen) {
  const guestProfile = {
    name: rawName.replace(/\b\w/g, (c) => c.toUpperCase()) || "Traveler",
    slug: "guest",
    country: "",
    bio: "A curious traveler whose full story hasn't been written down yet — someone who showed up anyway, sat down, and asked.",
  };
  setStatus("profile", `${guestProfile.name} (unmatched)`, "busy");
  session.profile = guestProfile;
  await recognizeAndAskQuestion(guestProfile, gen);
}

async function recognizeAndAskQuestion(profile, gen) {
  const first = profile.name.split(" ")[0];
  await say(LINES.recognized(first));
  if (stale(gen)) return;
  await askQuestion(gen);
}

async function askQuestion(gen) {
  setRitualState("askQuestion");
  visualizer.setState("listening");
  audio.setState("listening");
  await say(LINES.askQuestion);
  if (stale(gen)) return;
  await listenForQuestion(gen);
}

async function listenForQuestion(gen) {
  setRitualState("listenQuestion");
  setStatus("mic", "listening", "busy");
  setStatus("speech", "waiting...", "");

  const transcript = await ear.listen({
    onSpeechDetected: () => setStatus("speech", "detected", "ok"),
    timeoutMs: 11000,
  });
  setStatus("mic", "idle", "ok");
  log(`heard question: "${transcript || "(nothing)"}"`);

  if (stale(gen)) return;

  if (!transcript) {
    session.questionAttempts += 1;
    if (session.questionAttempts >= 2) {
      session.question = "what lies ahead for me";
      await interpretAndReveal(gen);
      return;
    }
    await say(pick(LINES.askQuestionAgain));
    if (stale(gen)) return;
    await listenForQuestion(gen);
    return;
  }

  session.question = transcript;
  await interpretAndReveal(gen);
}

async function interpretAndReveal(gen) {
  setRitualState("interpret");
  visualizer.setState("thinking");
  audio.setState("thinking");
  setStatus("ai", "generating fortune...", "busy");

  const murmur = say(pick(LINES.thinkingMurmur));

  let fortuneText = "";
  let source = "offline";
  try {
    const res = await fetch("/api/fortune", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: session.profile.name,
        bio: session.profile.bio,
        question: session.question,
        country: session.profile.country,
      }),
    });
    const data = await res.json();
    fortuneText = data.text;
    source = data.source;
  } catch (err) {
    log(`fortune request failed: ${err.message}`);
    fortuneText =
      "Something in the signal broke just now. Even oracles have static. Ask me again sometime.";
  }
  setStatus("ai", "idle", "ok");
  log(`fortune generated (${source}): ${fortuneText}`);

  await murmur;
  session.fortuneText = fortuneText;

  if (stale(gen)) return;
  await revealFortune(fortuneText, gen);
}

async function revealFortune(text, gen) {
  setRitualState("reveal");
  visualizer.setState("reveal");
  visualizer.burst();
  audio.setState("reveal");
  audio.resolve();
  log("revealing fortune");

  await say(text, { asVision: false });
  if (stale(gen)) return;
  await wait(1400);
  if (stale(gen)) return;

  await returnToIdle(gen);
}

async function returnToIdle(gen, { immediate = false } = {}) {
  setRitualState("settle");
  visualizer.setState("settle");
  audio.setState("settle");
  hideCaption();
  hideVision();

  await wait(immediate ? 400 : 2600);
  if (stale(gen)) return;

  setRitualState("idle");
  visualizer.setState("idle");
  audio.setState("idle");
  hint.classList.remove("hidden");
  setStatus("profile", "—", "");

  session.ritualActive = false;
  session.profile = null;
  session.question = "";
  log("returned to idle — ready for the next visitor");
}

// ---------------------------------------------------------------------
// Dev panel wiring
// ---------------------------------------------------------------------
function openDevPanel() { devPanel.hidden = false; }
function closeDevPanel() { devPanel.hidden = true; }

devToggle.addEventListener("click", () => (devPanel.hidden ? openDevPanel() : closeDevPanel()));
devClose.addEventListener("click", closeDevPanel);
window.addEventListener("keydown", (e) => {
  if (e.key === "`") devPanel.hidden ? openDevPanel() : closeDevPanel();
});

document.querySelectorAll("#dev-panel [data-action]").forEach((btn) => {
  btn.addEventListener("click", () => handleDevAction(btn.dataset.action));
});

function sendHandSimulation(value) {
  const ws = window.__oracleSocket;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "simulateHand", value }));
  } else {
    handleHandChange(value, "dev-panel-local");
  }
}

function handleDevAction(action) {
  switch (action) {
    case "hand-on":
      sendHandSimulation(true);
      break;
    case "hand-off":
      sendHandSimulation(false);
      break;
    case "ask-name":
      if (!session.ritualActive) beginRitual();
      break;
    case "reset":
      log("manual reset");
      abortRitual();
      break;
    case "submit-name": {
      const val = devNameInput.value.trim();
      if (!val) return;
      log(`dev: submitting name "${val}"`);
      const gen = startGeneration();
      session.ritualActive = true;
      identify(val, gen);
      break;
    }
    case "select-profile": {
      const slug = devProfileSelect.value;
      const profile = allProfiles.find((p) => p.slug === slug);
      if (!profile) return;
      log(`dev: selecting profile ${profile.name} directly`);
      const gen = startGeneration();
      session.ritualActive = true;
      session.nameAttempts = 0;
      setStatus("profile", profile.name, "ok");
      session.profile = profile;
      recognizeAndAskQuestion(profile, gen);
      break;
    }
    case "submit-question": {
      const val = devQuestionInput.value.trim();
      if (!val || !session.profile) {
        log("dev: need a matched/selected profile before submitting a question");
        return;
      }
      session.question = val;
      log(`dev: submitting question "${val}"`);
      const gen = startGeneration();
      interpretAndReveal(gen);
      break;
    }
    case "generate-fortune": {
      const val = devQuestionInput.value.trim() || session.question;
      if (!session.profile) {
        log("dev: need a profile first");
        return;
      }
      session.question = val || "what lies ahead for me";
      const gen = startGeneration();
      interpretAndReveal(gen);
      break;
    }
    case "reveal-fortune": {
      if (!session.fortuneText) {
        log("dev: no fortune generated yet");
        return;
      }
      const gen = startGeneration();
      revealFortune(session.fortuneText, gen);
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------
async function boot() {
  setStatus("mic", ear.supported ? "idle" : "unsupported", ear.supported ? "ok" : "bad");
  setStatus("voice", "checking...", "");
  setStatus("audio", "idle", "ok");
  setStatus("profile", "—", "");
  setStatus("ai", "idle", "ok");
  setStatus("speech", "—", "");
  setRitualState("idle");
  visualizer.setState("idle");
  audio.setState("idle");

  voice.ready.then(() => {
    setStatus("voice", voice.remoteAvailable ? "ElevenLabs" : "browser (Web Speech)", voice.remoteAvailable ? "ok" : "busy");
  });

  connectSocket();

  try {
    const res = await fetch("/api/status");
    applyServerStatus(await res.json());
  } catch { /* ws status will arrive shortly anyway */ }

  try {
    const res = await fetch("/api/profiles");
    const data = await res.json();
    allProfiles = data.students || [];
    devProfileSelect.innerHTML =
      `<option value="">— choose a profile —</option>` +
      allProfiles.map((p) => `<option value="${p.slug}">${p.name}</option>`).join("");
    log(`loaded ${allProfiles.length} cached CIID profiles`);
  } catch (err) {
    log(`could not load profiles: ${err.message}`);
  }
}

boot();

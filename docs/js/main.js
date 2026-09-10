// main.js (static-demo build, for GitHub Pages)
// Same ritual state machine as the full app's public/js/main.js, but with
// every server-dependent piece swapped for a client-side equivalent:
//   - profile loading + fuzzy matching -> ./profiles.js (reads data/profiles.json)
//   - fortune generation -> ./fortune.js (the same offline generator the
//     full server falls back to — no API key ships to a static page)
//   - the Arduino bridge -> ./webserial.js (Web Serial API, straight from
//     the browser, no Node process required)
//
// IDLE -> HAND DETECTED -> AWAKEN -> ASK NAME -> LISTEN FOR NAME -> IDENTIFY
//      -> ASK QUESTION -> LISTEN FOR QUESTION -> INTERPRET -> GENERATE
//      -> REVEAL -> RETURN TO IDLE.

import { Visualizer } from "./visualizer.js";
import { AmbientAudio } from "./audio.js";
import { OracleVoice, OracleEar } from "./speech.js";
import { loadProfiles, matchProfileByName } from "./profiles.js";
import { generateFortune } from "./fortune.js";
import { WebSerialBridge } from "./webserial.js";

// ---------------------------------------------------------------------
// Oracle script — a warm, gentle storyteller's voice (think a fairy tale
// being read aloud, with a bit of that grand, knowing Princess Bride
// charm) rather than a mysterious machine. Name and question prompts stay
// short and direct — no wandering before the actual ask.
// ---------------------------------------------------------------------
const LINES = {
  greeting: [
    "Well now... someone has come. Come closer, dear one — tell me your name.",
    "Ah, there you are. I felt you arrive. Now — what is your name?",
    "Hush now, hush... someone has stepped into my light. Tell me your name.",
  ],
  askNameAgain: [
    "Now, now, don't be shy — say your name once more.",
    "That got lost on its way to me, love. Tell me your name again.",
    "Come a little closer, dear one, and say your name once more.",
  ],
  giveUpOnName: "No matter, no matter. Some names like to hide a while. We'll go on all the same.",
  recognized: (first) =>
    `Ah, ${first}... there you are. I've always known a bit more about you than you'd guess.`,
  askQuestion: "Now then — ask me your question.",
  askQuestionAgain: [
    "Come now, ask me again — a little louder this time.",
    "That one got away from me. Ask your question once more.",
  ],
  thinkingMurmur: [
    "Mm... hold still a moment...",
    "Wait now... there's a thread here...",
    "Let me see... let me see...",
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
const serial = new WebSerialBridge();

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
  await wait(1200);
  hide();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Hand presence -> ritual triggers
// ---------------------------------------------------------------------
function handleHandChange(present, origin = "sensor") {
  log(`hand ${present ? "detected" : "removed"} (${origin})`);
  if (present) {
    if (!session.ritualActive) beginRitual();
  } else {
    if (session.ritualActive && !session.profile) {
      log("hand removed before recognition completed — easing back to idle");
      abortRitual();
    }
  }
}

// ---------------------------------------------------------------------
// Generation guard — see the full app's main.js for the rationale. A hand
// lifted early, a reset, or a dev-panel override fired mid-chain must not
// let that *old* chain keep running once a *new* one has taken over.
// ---------------------------------------------------------------------
let generation = 0;
function stale(gen) {
  return gen !== generation;
}
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
// The ritual itself
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

  const result = matchProfileByName(transcript, allProfiles);

  setStatus("ai", "idle", "ok");
  await wait(900); // let the "searching" visual/sound register before resolving
  hideVision();

  if (stale(gen)) return;

  if (result?.profile) {
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

  // No server in the static build — always the offline generator.
  const { text: fortuneText, source } = generateFortune({
    name: session.profile.name,
    bio: session.profile.bio,
    question: session.question,
  });

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
// Web Serial (real Arduino, straight from the browser — no server)
// ---------------------------------------------------------------------
async function connectSerial() {
  const ok = await serial.connect(
    (present) => handleHandChange(present, "arduino-webserial"),
    (msg) => log(msg)
  );
  setStatus(
    "arduino",
    ok ? "connected (Web Serial)" : serial.supported ? "not connected" : "unsupported browser",
    ok ? "ok" : serial.supported ? "busy" : "bad"
  );
}

async function disconnectSerial() {
  await serial.disconnect((msg) => log(msg));
  setStatus("arduino", "not connected", "busy");
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

function handleDevAction(action) {
  switch (action) {
    case "hand-on":
      handleHandChange(true, "dev-panel");
      break;
    case "hand-off":
      handleHandChange(false, "dev-panel");
      break;
    case "ask-name":
      if (!session.ritualActive) beginRitual();
      break;
    case "reset":
      log("manual reset");
      abortRitual();
      break;
    case "connect-serial":
      // Needs a user gesture — this click *is* that gesture.
      connectSerial();
      break;
    case "disconnect-serial":
      disconnectSerial();
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
  setStatus("mode", "static demo (GitHub Pages)", "busy");
  setStatus("arduino", serial.supported ? "not connected" : "unsupported browser", serial.supported ? "busy" : "bad");
  setStatus("mic", ear.supported ? "idle" : "unsupported", ear.supported ? "ok" : "bad");
  setStatus("audio", "idle", "ok");
  setStatus("profile", "—", "");
  setStatus("ai", "idle", "ok");
  setStatus("speech", "—", "");
  setRitualState("idle");
  visualizer.setState("idle");
  audio.setState("idle");

  try {
    allProfiles = await loadProfiles();
    devProfileSelect.innerHTML =
      `<option value="">— choose a profile —</option>` +
      allProfiles.map((p) => `<option value="${p.slug}">${p.name}</option>`).join("");
    log(`loaded ${allProfiles.length} cached CIID profiles`);
  } catch (err) {
    log(`could not load profiles: ${err.message}`);
  }
}

boot();

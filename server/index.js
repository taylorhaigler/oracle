// index.js
// The Oracle's brain: serves the front-end ritual, caches CIID profiles once
// at startup, bridges the Arduino photoresistor over serial + WebSocket, and
// generates fortunes (live via Anthropic, or an offline fallback).

import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfiles, getProfiles, matchProfileByName } from "./profiles.js";
import { generateFortune } from "./fortune.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4173;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

// ---------------------------------------------------------------------
// Shared runtime status, broadcast to every connected browser client so
// the dev/debug panel can show it live.
// ---------------------------------------------------------------------
const status = {
  arduinoConnected: false,
  arduinoPort: null,
  handPresent: false,
  profilesLoaded: 0,
  hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
};

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "status", status }));
  socket.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      // Dev panel can simulate a hand event by round-tripping through the
      // server, so every connected client (e.g. a second screen) sees it.
      if (msg.type === "simulateHand") {
        setHandPresent(Boolean(msg.value), "dev-panel");
      }
    } catch {
      // ignore malformed messages
    }
  });
});

function setHandPresent(value, origin = "arduino") {
  if (status.handPresent === value) return;
  status.handPresent = value;
  broadcast({ type: "hand", value, origin });
}

// ---------------------------------------------------------------------
// Arduino / photoresistor bridge (optional — the experience simulates this
// gracefully via the dev panel if no board is attached).
// ---------------------------------------------------------------------
async function connectArduino() {
  let SerialPort, ReadlineParser;
  try {
    ({ SerialPort, ReadlineParser } = await import("serialport"));
  } catch {
    console.warn("[arduino] `serialport` package not installed — running in simulation mode. " +
      "Run `npm install` (it's an optional dependency) and rebuild for a real board, or use the dev panel.");
    return;
  }

  try {
    const ports = await SerialPort.list();
    const preferred = process.env.ARDUINO_PORT;
    const found =
      (preferred && ports.find((p) => p.path === preferred)) ||
      ports.find((p) => /usbmodem|usbserial|wchusbserial|ttyUSB|ttyACM/i.test(p.path));

    if (!found) {
      console.warn("[arduino] no matching serial port found — running in simulation mode.");
      return;
    }

    const port = new SerialPort({ path: found.path, baudRate: 9600 });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    port.on("open", () => {
      status.arduinoConnected = true;
      status.arduinoPort = found.path;
      console.log(`[arduino] connected on ${found.path}`);
      broadcast({ type: "status", status });
    });

    port.on("close", () => {
      status.arduinoConnected = false;
      console.warn("[arduino] serial port closed.");
      broadcast({ type: "status", status });
    });

    port.on("error", (err) => {
      console.error(`[arduino] serial error: ${err.message}`);
    });

    // The Arduino sketch prints "HAND:1" when a hand covers the photoresistor
    // (light drops below threshold) and "HAND:0" when it's uncovered.
    parser.on("data", (line) => {
      const trimmed = line.trim();
      if (trimmed === "HAND:1") setHandPresent(true, "arduino");
      else if (trimmed === "HAND:0") setHandPresent(false, "arduino");
    });
  } catch (err) {
    console.warn(`[arduino] could not open serial connection: ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------

app.get("/api/status", (_req, res) => {
  res.json(status);
});

app.get("/api/profiles", (_req, res) => {
  res.json({ students: getProfiles() });
});

app.post("/api/match-name", (req, res) => {
  const { transcript } = req.body || {};
  const result = matchProfileByName(transcript || "");
  if (!result) {
    return res.json({ matched: false });
  }
  res.json({ matched: true, score: result.score, profile: result.profile });
});

app.post("/api/fortune", async (req, res) => {
  const { name, bio, question, country } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const fortune = await generateFortune({ name, bio: bio || "", question, country });
    res.json(fortune);
  } catch (err) {
    console.error(`[fortune] unexpected failure: ${err.message}`);
    res.status(500).json({ error: "fortune generation failed" });
  }
});

// Manual dev-panel triggers that should also reach any other connected
// screen/client (kept separate from simulateHand for clarity in logs).
app.post("/api/dev/hand", (req, res) => {
  const { value } = req.body || {};
  setHandPresent(Boolean(value), "dev-panel-http");
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------
async function main() {
  const profiles = await loadProfiles();
  status.profilesLoaded = profiles.length;

  await connectArduino();

  httpServer.listen(PORT, () => {
    console.log(`\n🔮 The oracle is listening at http://localhost:${PORT}`);
    console.log(`   Profiles cached: ${status.profilesLoaded}`);
    console.log(`   Anthropic API key present: ${status.hasApiKey}`);
    console.log(`   Arduino connected: ${status.arduinoConnected}${status.arduinoConnected ? ` (${status.arduinoPort})` : " (simulation mode — use the dev panel)"}\n`);
  });
}

main();

/*
 * The Oracle — photoresistor awakening trigger
 * -------------------------------------------------------------------------
 * Wiring (a standard photoresistor voltage divider):
 *
 *   5V ---- photoresistor ----+---- 10kΩ resistor ---- GND
 *                              |
 *                              +---- A0 (analog in)
 *
 * When a hand covers the photoresistor, less light reaches it, its
 * resistance rises, and the voltage at A0 drops. The sketch watches for
 * that drop, and prints a single line over Serial the moment it changes:
 *
 *   HAND:1   -> a hand has covered the sensor (oracle should awaken)
 *   HAND:0   -> the hand has been lifted (oracle can rest again)
 *
 * The Node server (server/index.js) reads these lines and relays them to
 * the browser over a WebSocket. Nothing on the Arduino side needs to know
 * about the ritual itself — it only reports light vs. shadow.
 *
 * The "covered" threshold is RELATIVE to the current ambient baseline, not
 * a fixed number — this is what lets it work whether the room is bright
 * (baseline ~400+, a hand blocks ~90% of it) or dimmed (baseline ~20-25,
 * where a hand can only block it down to single digits in absolute terms,
 * but is still a real ~50-90% relative drop). A fixed absolute threshold
 * tuned for a bright room simply cannot fire at all once the ambient
 * reading itself is smaller than that threshold. THRESHOLD_MIN_ABS is a
 * floor so the relative threshold doesn't shrink to nothing (and start
 * false-triggering on sensor noise) in very dim rooms.
 *
 * Calibration: open the Serial Monitor at 9600 baud to watch the raw
 * values, and adjust THRESHOLD_RATIO / THRESHOLD_MIN_ABS below if a
 * particular room still isn't triggering reliably.
 */

const int SENSOR_PIN = A0;
const unsigned long CALIBRATION_MS = 1500;   // time to sample ambient light at boot
const float THRESHOLD_RATIO = 0.25;          // fraction of ambient counted as "covered"
const int THRESHOLD_MIN_ABS = 3;             // floor so the threshold never shrinks below sensor noise
const unsigned long DEBOUNCE_MS = 150;       // ignore flicker shorter than this

int ambientBaseline = 0;
bool handPresent = false;
unsigned long lastChangeMs = 0;

int readSmoothed() {
  // A handful of quick samples smooths out mains-frequency flicker and
  // sensor noise — matters more now that dim-room thresholds are small.
  long sum = 0;
  const int samples = 12;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(SENSOR_PIN);
    delay(2);
  }
  return sum / samples;
}

int coveredThreshold() {
  int scaled = (int)(ambientBaseline * THRESHOLD_RATIO);
  return scaled > THRESHOLD_MIN_ABS ? scaled : THRESHOLD_MIN_ABS;
}

void setup() {
  Serial.begin(9600);
  pinMode(SENSOR_PIN, INPUT);

  // Sample ambient light for a moment so the threshold adapts to the room.
  // Uses the brightest reading seen, not the average — if a hand happens to
  // be near the sensor for part of this window (e.g. right after plugging
  // in), an average would drag the "ambient" baseline down permanently,
  // making the sensor think a shadow is the room's normal light level.
  // The brightest sample is a much better proxy for genuinely uncovered.
  unsigned long start = millis();
  int brightest = 0;
  while (millis() - start < CALIBRATION_MS) {
    int v = analogRead(SENSOR_PIN);
    if (v > brightest) brightest = v;
    delay(20);
  }
  ambientBaseline = brightest > 0 ? brightest : 512;
}

void loop() {
  int value = readSmoothed();
  bool covered = value < (ambientBaseline - coveredThreshold());

  unsigned long now = millis();
  if (covered != handPresent && (now - lastChangeMs) > DEBOUNCE_MS) {
    handPresent = covered;
    lastChangeMs = now;
    Serial.println(handPresent ? "HAND:1" : "HAND:0");
  }

  // Slowly drift the baseline to follow gradual changes in room light
  // (e.g. someone dimming the lights, or a lamp switching on nearby), but
  // never while a hand is actively covering the sensor.
  if (!handPresent) {
    ambientBaseline = (ambientBaseline * 19 + value) / 20;
  }

  delay(30);
}

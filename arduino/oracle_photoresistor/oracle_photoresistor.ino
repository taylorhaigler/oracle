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
 * Calibration: open the Serial Monitor at 9600 baud, watch the raw values
 * printed during CALIBRATION_MS at boot, and adjust THRESHOLD_OFFSET below
 * if the room is much brighter or darker than expected.
 */

const int SENSOR_PIN = A0;
const unsigned long CALIBRATION_MS = 1500;   // time to sample ambient light at boot
const int THRESHOLD_OFFSET = 120;            // how far below ambient counts as "covered"
const unsigned long DEBOUNCE_MS = 150;       // ignore flicker shorter than this

int ambientBaseline = 0;
bool handPresent = false;
unsigned long lastChangeMs = 0;

int readSmoothed() {
  // A handful of quick samples smooths out mains-frequency flicker.
  long sum = 0;
  const int samples = 8;
  for (int i = 0; i < samples; i++) {
    sum += analogRead(SENSOR_PIN);
    delay(2);
  }
  return sum / samples;
}

void setup() {
  Serial.begin(9600);
  pinMode(SENSOR_PIN, INPUT);

  // Sample ambient light for a moment so the threshold adapts to the room.
  unsigned long start = millis();
  long sum = 0;
  int count = 0;
  while (millis() - start < CALIBRATION_MS) {
    sum += analogRead(SENSOR_PIN);
    count++;
    delay(20);
  }
  ambientBaseline = count > 0 ? sum / count : 512;
}

void loop() {
  int value = readSmoothed();
  bool covered = value < (ambientBaseline - THRESHOLD_OFFSET);

  unsigned long now = millis();
  if (covered != handPresent && (now - lastChangeMs) > DEBOUNCE_MS) {
    handPresent = covered;
    lastChangeMs = now;
    Serial.println(handPresent ? "HAND:1" : "HAND:0");
  }

  // Slowly drift the baseline to follow gradual changes in room light
  // (e.g. someone turning on a lamp nearby), but never while a hand is
  // actively covering the sensor.
  if (!handPresent) {
    ambientBaseline = (ambientBaseline * 19 + value) / 20;
  }

  delay(30);
}

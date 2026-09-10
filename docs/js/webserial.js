// webserial.js
// A server-free Arduino bridge for the static build: the Web Serial API
// lets a page talk directly to a USB-serial device from Chrome/Edge over
// HTTPS (which is exactly what GitHub Pages serves over) — no Node process
// in between at all. It reads the same "HAND:1" / "HAND:0" lines the
// Arduino sketch already prints (see arduino/oracle_photoresistor).
//
// Requires a user gesture to open (browser security), so it's wired to the
// dev panel's "Connect sensor" button rather than happening automatically.

export class WebSerialBridge {
  constructor() {
    this.supported = "serial" in navigator;
    this.port = null;
    this.reader = null;
    this.connected = false;
    this._closing = false;
  }

  /** Must be called from inside a user-gesture handler (e.g. a click). */
  async connect(onHand, onLog) {
    if (!this.supported) {
      onLog?.("Web Serial isn't supported in this browser — try Chrome or Edge.");
      return false;
    }
    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 9600 });
      this.connected = true;
      this._closing = false;
      onLog?.("Arduino connected over Web Serial.");
      this._readLoop(onHand, onLog);
      return true;
    } catch (err) {
      onLog?.(`Web Serial connect failed/cancelled: ${err.message}`);
      return false;
    }
  }

  async _readLoop(onHand, onLog) {
    const textDecoder = new TextDecoderStream();
    const readableClosed = this.port.readable.pipeTo(textDecoder.writable);
    this.reader = textDecoder.readable.getReader();

    let buffer = "";
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line === "HAND:1") onHand?.(true);
          else if (line === "HAND:0") onHand?.(false);
        }
      }
    } catch (err) {
      if (!this._closing) onLog?.(`Web Serial read error: ${err.message}`);
    } finally {
      this.reader.releaseLock();
      await readableClosed.catch(() => {});
    }
  }

  async disconnect(onLog) {
    this._closing = true;
    this.connected = false;
    try {
      await this.reader?.cancel();
    } catch { /* noop */ }
    try {
      await this.port?.close();
    } catch { /* noop */ }
    onLog?.("Arduino disconnected.");
  }
}

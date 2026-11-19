// Runs on the audio thread. Resamples the microphone from the device's rate
// (usually 44.1 or 48 kHz) to 16 kHz and posts 50 ms chunks of 16-bit PCM, the
// chunk size AssemblyAI recommends for streaming STT.
//
// Resampling happens here rather than by asking the browser for a 16 kHz
// AudioContext, because browsers differ on whether a microphone can be
// connected to a context at a different rate.
const TARGET_RATE = 16000;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE; // input samples per output sample
    this.position = 0; // where the next output sample falls in the input stream
    this.previous = 0; // last input sample of the previous block
    this.chunk = new Int16Array(TARGET_RATE * 0.05);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    // Linear interpolation between neighbouring input samples.
    while (this.position < input.length) {
      const index = Math.floor(this.position);
      const before = index === 0 ? this.previous : input[index - 1];
      const fraction = this.position - index;
      const sample = before + (input[index] - before) * fraction;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.chunk[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      if (this.filled === this.chunk.length) {
        const out = this.chunk.slice();
        this.port.postMessage(out.buffer, [out.buffer]);
        this.filled = 0;
      }
      this.position += this.step;
    }
    this.position -= input.length;
    this.previous = input[input.length - 1];
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);

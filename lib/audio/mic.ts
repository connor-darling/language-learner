/**
 * Captures the microphone as 16 kHz mono 16-bit PCM in 50 ms chunks.
 *
 * Echo cancellation matters here: the tutor's voice comes out of the speakers
 * and would otherwise be transcribed as the learner talking, which the agent
 * would treat as an interruption of itself.
 *
 * `onChunk` also receives the chunk's loudness (0 to 1), which drives the
 * level meter in the UI: the quickest way to tell "the mic is silent" apart
 * from "speech isn't being recognised".
 */
export async function startMic(onChunk: (pcm: ArrayBuffer, level: number) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/pcm-worklet.js");
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture");
  node.port.onmessage = (event) => {
    const pcm = event.data as ArrayBuffer;
    const samples = new Int16Array(pcm);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    onChunk(pcm, Math.sqrt(sum / samples.length) / 0x8000);
  };
  // The node must lead to the destination or some browsers never run it. The
  // muted gain keeps the microphone from being played back.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(ctx.destination);
  // A context created after an await can start suspended, which captures nothing.
  await ctx.resume();

  return {
    /** The input device the browser picked, for display. */
    label: stream.getAudioTracks()[0]?.label ?? "unknown microphone",
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close();
    },
  };
}

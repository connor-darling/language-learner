export const TTS_SAMPLE_RATE = 24000;

type Queued = { id: string; chunks: Int16Array[]; done: boolean; started: boolean };

/**
 * Plays speech segments strictly in the order they were queued.
 *
 * Segments come from different TTS sessions (one per language), and a later
 * segment's audio can arrive before an earlier one has finished synthesizing.
 * Each segment therefore buffers its own audio, and only the segment at the
 * head of the queue is scheduled for playback.
 */
export class SegmentPlayer {
  private ctx: AudioContext;
  private queue: Queued[] = [];
  private sources = new Set<AudioBufferSourceNode>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private nextTime = 0;

  onSegmentStart?: (id: string) => void;
  /** Fires once everything queued has finished playing. */
  onIdle?: () => void;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
  }

  resume() {
    return this.ctx.resume();
  }

  get busy() {
    return this.queue.length > 0 || this.sources.size > 0;
  }

  enqueue(id: string) {
    this.queue.push({ id, chunks: [], done: false, started: false });
  }

  /** Returns how long from now this audio will start playing, in ms. */
  push(id: string, pcm: Int16Array): number | null {
    const segment = this.queue.find((s) => s.id === id);
    if (!segment) return null; // cancelled
    segment.chunks.push(pcm);
    const startsAt = this.pump();
    return segment === this.queue[0] && startsAt !== null
      ? Math.max(0, (startsAt - this.ctx.currentTime) * 1000)
      : null;
  }

  finish(id: string) {
    const segment = this.queue.find((s) => s.id === id);
    if (!segment) return;
    segment.done = true;
    this.pump();
    this.checkIdle();
  }

  /** Barge-in: silence everything now and forget what was queued. */
  stop() {
    this.queue = [];
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
    }
    this.sources.clear();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.nextTime = 0;
  }

  close() {
    this.stop();
    void this.ctx.close();
  }

  private pump(): number | null {
    let firstStart: number | null = null;
    while (this.queue.length) {
      const head = this.queue[0];
      for (const chunk of head.chunks) {
        const start = this.schedule(chunk);
        firstStart ??= start;
        if (!head.started) {
          head.started = true;
          this.at(start, () => this.onSegmentStart?.(head.id));
        }
      }
      head.chunks = [];
      if (!head.done) break;
      this.queue.shift();
    }
    return firstStart;
  }

  private schedule(pcm: Int16Array) {
    const buffer = this.ctx.createBuffer(1, pcm.length, TTS_SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 0x8000;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    const start = Math.max(this.nextTime, this.ctx.currentTime + 0.02);
    source.start(start);
    this.nextTime = start + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      this.checkIdle();
    };
    return start;
  }

  private at(time: number, fn: () => void) {
    const timer = setTimeout(
      () => {
        this.timers.delete(timer);
        fn();
      },
      Math.max(0, (time - this.ctx.currentTime) * 1000),
    );
    this.timers.add(timer);
  }

  private checkIdle() {
    if (!this.busy) this.onIdle?.();
  }
}

import { describe, expect, it } from 'vitest';
import { VOICES } from './timbres';

// Minimal recording stand-in for the Web Audio graph the voices build.
type Ev = { kind: 'set' | 'lin' | 'target'; v: number; t: number; tau?: number };
class Param {
  value = 0;
  events: Ev[] = [];
  setValueAtTime(v: number, t: number) { this.events.push({ kind: 'set', v, t }); return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push({ kind: 'lin', v, t }); return this; }
  setTargetAtTime(v: number, t: number, tau: number) { this.events.push({ kind: 'target', v, t, tau }); return this; }
}
class Node {
  outs: Node[] = [];
  connect(n: any) { this.outs.push(n); return n; }
}
class Src extends Node {
  startAt = NaN;
  stopAt = NaN;
  start(t: number) { this.startAt = t; }
  stop(t: number) { this.stopAt = t; }
}
class Osc extends Src { type = ''; frequency = new Param(); detune = new Param(); }
class BufSrc extends Src { buffer: any = null; loop = false; playbackRate = new Param(); }
class Gain extends Node { gain = new Param(); }
class Filter extends Node { type = ''; frequency = new Param(); Q = new Param(); }
class Ctx {
  buffers = 0;
  oscs: Osc[] = [];
  bufSrcs: BufSrc[] = [];
  gains: Gain[] = [];
  constructor(public sampleRate: number) {}
  createOscillator() { const o = new Osc(); this.oscs.push(o); return o; }
  createBufferSource() { const s = new BufSrc(); this.bufSrcs.push(s); return s; }
  createGain() { const g = new Gain(); this.gains.push(g); return g; }
  createBiquadFilter() { return new Filter(); }
  createBuffer(_ch: number, length: number, sampleRate: number) {
    this.buffers++;
    const data = new Float32Array(length);
    return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
  }
}
const play = (id: keyof typeof VOICES, ctx: Ctx, freq: number, t = 1, dur = 0.5, vel = 0.7) =>
  VOICES[id]({ ctx: ctx as any, out: new Node() as any, freq, t, dur, vel });

/** Gain at `time` for the automation shapes the voices use (set / linear ramp / target). */
function gainAt(p: Param, time: number) {
  let v = p.value, t0 = -Infinity;
  for (const e of p.events) {
    if (e.t > time) {
      if (e.kind === 'lin') v += ((e.v - v) * (time - t0)) / (e.t - t0);
      return v;
    }
    if (e.kind === 'target') {
      // runs until the next event (if any)
      const next = p.events.find((x) => x.t > e.t);
      const until = next ? Math.min(time, next.t) : time;
      v = e.v + (v - e.v) * Math.exp(-(until - e.t) / e.tau!);
      if (!next || next.t > time) return v;
    } else v = e.v;
    t0 = e.t;
  }
  return v;
}

/** Hann-windowed spectrum peak near `guess`, refined until well below 0.1 cent. */
function peakFreq(d: Float32Array, sr: number, guess: number) {
  const a = Math.floor(0.1 * sr), n = Math.floor(sr);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = d[a + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const mag = (f: number) => {
    const c = 2 * Math.cos((2 * Math.PI * f) / sr);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  let best = guess, span = guess * 0.04;
  while (span > guess * 1e-6) {
    let bm = -1, bf = best;
    for (let k = -10; k <= 10; k++) {
      const f = best + (span * k) / 10;
      const m = mag(f);
      if (m > bm) { bm = m; bf = f; }
    }
    best = bf;
    span /= 5;
  }
  return best;
}
const cents = (f: number, ref: number) => 1200 * Math.log2(f / ref);

describe('harp', () => {
  it('plays the exact frequency: playbackRate × the Karplus–Strong loop pitch', () => {
    const sr = 48000;
    for (const freq of [47.3, 55, 71.7, 110, 127.8, 233.08, 262, 440 * 2 ** (0.37 / 12), 698.5, 987]) {
      const ctx = new Ctx(sr);
      play('harp', ctx, freq);
      const src = ctx.bufSrcs[0];
      const d: Float32Array = src.buffer.getChannelData(0);
      const loopF0 = peakFreq(d, sr, freq / src.playbackRate.value);
      // the buffer really sounds at f0 = sr / (N - 0.5) ...
      expect(Math.abs(cents(loopF0, freq / src.playbackRate.value))).toBeLessThan(1);
      // ... so the played pitch is the target to well within a cent
      expect(Math.abs(cents(loopF0 * src.playbackRate.value, freq))).toBeLessThan(1);
      // semitone bands keep the resampling small
      expect(Math.abs(cents(src.playbackRate.value, 1))).toBeLessThan(70);
    }
  });

  it('fades out before it stops instead of cutting a ringing string', () => {
    for (const freq of [47.3, 70, 130, 260, 987]) {
      const ctx = new Ctx(48000);
      play('harp', ctx, freq, 2, 0.5, 0.55);
      const src = ctx.bufSrcs[0];
      const g = ctx.gains[0].gain;
      const level = gainAt(g, 2.01);
      expect(level).toBeGreaterThan(0);
      expect(gainAt(g, src.stopAt - 0.36)).toBeCloseTo(level, 9);
      // ≥ 48 dB down by the stop
      expect(gainAt(g, src.stopAt) / level).toBeLessThan(0.004);
      // the stop never runs past the end of the buffer, at any playbackRate
      expect(src.stopAt - 2).toBeLessThanOrEqual(src.buffer.duration / src.playbackRate.value);
      expect(src.stopAt - 2).toBeGreaterThan(2.3);
    }
  });

  it('reuses one buffer per semitone band', () => {
    const ctx = new Ctx(44100);
    play('harp', ctx, 220);
    play('harp', ctx, 220 * 2 ** (0.4 / 12));
    play('harp', ctx, 220 * 2 ** (-0.4 / 12));
    expect(ctx.buffers).toBe(1);
    play('harp', ctx, 220 * 2 ** (1 / 12));
    expect(ctx.buffers).toBe(2);
  });

  it('keeps the buffer cache bounded (LRU)', () => {
    const ctx = new Ctx(32000);
    const bands = Array.from({ length: 40 }, (_, i) => 60 * 2 ** (i / 12));
    for (const f of bands) play('harp', ctx, f);
    expect(ctx.buffers).toBe(40);
    play('harp', ctx, bands[39]); // recent: still cached
    expect(ctx.buffers).toBe(40);
    play('harp', ctx, bands[0]); // oldest: evicted, rendered again
    expect(ctx.buffers).toBe(41);
    // continuous pitches over two octaves (25 bands, fits the cache): one render per band
    const ctx2 = new Ctx(22050);
    for (let i = 0; i < 2000; i++) play('harp', ctx2, 110 * 2 ** (Math.random() * 2));
    expect(ctx2.buffers).toBeLessThanOrEqual(25);
  });
});

describe('flute', () => {
  it('holds its level into the release (no click)', () => {
    for (const [freq, dur] of [[262, 0.5], [131, 0.9], [600, 0.05]]) {
      const ctx = new Ctx(48000);
      play('flute', ctx, freq, 1, dur, 0.75);
      const g = ctx.gains[0].gain;
      const rel = 1 + Math.max(dur, 0.1);
      const before = gainAt(g, rel - 1e-6);
      expect(before).toBeGreaterThan(0);
      expect(Math.abs(gainAt(g, rel) - before) / before).toBeLessThan(1e-4);
      expect(gainAt(g, rel + 0.5) / before).toBeLessThan(0.01);
    }
  });

  const partials = (freq: number) => {
    const ctx = new Ctx(48000);
    play('flute', ctx, freq);
    // every tonal oscillator (the 5 Hz vibrato LFO excluded) and the gain it feeds
    return ctx.oscs
      .filter((o) => o.frequency.value > 20)
      .map((o) => ({ mult: o.frequency.value / freq, amp: o.outs[0] instanceof Gain && o.outs[0] !== ctx.gains[0] ? (o.outs[0] as Gain).gain.value : 1, o }));
  };

  it('is unchanged from 220 Hz up: sine + 0.18 octave', () => {
    for (const f of [220, 262, 523]) {
      expect(partials(f).map(({ mult, amp }) => [mult, amp])).toEqual([[1, 1], [2, 0.18]]);
    }
  });

  it('adds exact harmonics to low notes so a phone speaker still carries the pitch', () => {
    const p = partials(72);
    expect(p.map(({ mult }) => mult)).toEqual([1, 2, 3, 4]);
    expect(p.map(({ amp }) => +amp.toFixed(3))).toEqual([1, 0.5, 0.22, 0.12]);
    const mid = partials(160); // halfway: k = 0.5
    expect(mid.map(({ amp }) => +amp.toFixed(3))).toEqual([1, 0.34, 0.11, 0.06]);
    // all partials start and stop together
    const ends = new Set(p.map(({ o }) => o.stopAt));
    expect(ends.size).toBe(1);
  });
});

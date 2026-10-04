// Synthesized voices. Every voice takes an exact frequency, so any real-valued pitch
// (continuous tonic detune) sounds identical in quality. No samples are needed.

export type TimbreId = 'glass' | 'epiano' | 'musicbox' | 'harp' | 'pad' | 'flute';

export const TIMBRES: { id: TimbreId; name: string; sustained: boolean }[] = [
  { id: 'glass', name: '글래스 벨', sustained: false },
  { id: 'epiano', name: '로즈 E-피아노', sustained: false },
  { id: 'musicbox', name: '뮤직박스', sustained: false },
  { id: 'harp', name: '하프', sustained: false },
  { id: 'pad', name: '웜 패드', sustained: true },
  { id: 'flute', name: '소프트 플루트', sustained: true },
];

export interface VoiceArgs {
  ctx: AudioContext;
  out: AudioNode;
  freq: number;
  t: number; // absolute AudioContext time
  dur: number;
  vel: number;
}

const env = (g: GainNode, t: number, peak: number, attack: number, decayTo: number, decay: number) => {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(decayTo, t + attack, decay);
};

// Keep high notes from getting shrill and low notes from vanishing.
const loudness = (freq: number) => Math.min(1.3, Math.max(0.55, Math.pow(262 / freq, 0.35)));

function osc(ctx: AudioContext, type: OscillatorType, freq: number) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

function fm(a: VoiceArgs, ratio: number, indexStart: number, indexEnd: number, indexDecay: number, ampDecay: number) {
  const { ctx, out, freq, t, dur, vel } = a;
  const car = osc(ctx, 'sine', freq);
  const mod = osc(ctx, 'sine', freq * ratio);
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(freq * indexStart, t);
  modGain.gain.setTargetAtTime(freq * indexEnd, t, indexDecay);
  mod.connect(modGain).connect(car.frequency);
  const g = ctx.createGain();
  const peak = 0.32 * vel * loudness(freq);
  env(g, t, peak, 0.004, 0.0001, ampDecay);
  const end = t + Math.max(dur, ampDecay * 3);
  g.gain.setTargetAtTime(0, t + Math.max(dur, 0.05) + ampDecay * 1.5, 0.15);
  car.connect(g).connect(out);
  car.start(t);
  mod.start(t);
  car.stop(end + 0.6);
  mod.stop(end + 0.6);
}

function glass(a: VoiceArgs) {
  fm(a, 3.5, 1.6, 0.2, 0.25, 0.9);
  // soft octave shimmer
  const { ctx, out, freq, t, vel } = a;
  const o = osc(ctx, 'sine', freq * 2);
  const g = ctx.createGain();
  env(g, t, 0.06 * vel * loudness(freq), 0.003, 0.0001, 0.45);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 2.5);
}

function epiano(a: VoiceArgs) {
  fm(a, 1, 2.2, 0.35, 0.18, 1.3);
  // tine "ding"
  const { ctx, out, freq, t, vel } = a;
  const o = osc(ctx, 'sine', freq * 14);
  const g = ctx.createGain();
  env(g, t, 0.025 * vel * loudness(freq), 0.002, 0.0001, 0.05);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.5);
}

function musicbox(a: VoiceArgs) {
  const { ctx, out, freq, t, vel } = a;
  // glockenspiel-like inharmonic partials, fast-decaying uppers
  const partials: [number, number, number][] = [
    [1, 1, 1.1],
    [2.0, 0.25, 0.5],
    [3.01, 0.12, 0.35],
    [5.4, 0.05, 0.15],
  ];
  for (const [ratio, amp, decay] of partials) {
    const o = osc(ctx, 'sine', freq * ratio);
    const g = ctx.createGain();
    env(g, t, 0.28 * amp * vel * loudness(freq), 0.002, 0.0001, decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay * 6 + 0.1);
  }
}

// Karplus–Strong rendered once per (rounded) frequency, then fine-tuned with playbackRate
// so the pitch is exact even though the delay line has an integer length.
// The buffer is rendered for the nearest equal-tempered semitone (playbackRate then stays
// within about ±3%), so the continuous tonic still reuses buffers, and the cache is a small
// LRU: each 2.5 s buffer is ~0.5 MB and would otherwise pile up over a long session.
const HARP_CACHE_MAX = 32;
const harpCache = new Map<string, { buf: AudioBuffer; f0: number }>();
function harpBuffer(ctx: AudioContext, freq: number) {
  const sr = ctx.sampleRate;
  const band = 440 * Math.pow(2, Math.round(12 * Math.log2(freq / 440)) / 12);
  const N = Math.max(3, Math.round(sr / band + 0.5));
  const key = `${sr}:${N}`;
  const hit = harpCache.get(key);
  if (hit) {
    harpCache.delete(key); // re-insert as most recently used
    harpCache.set(key, hit);
    return hit;
  }
  const len = Math.floor(sr * 2.5);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = Math.random() * 2 - 1;
  // soften the excitation
  for (let k = 0; k < 2; k++) for (let i = 1; i < N; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
  let idx = 0;
  const damp = Math.pow(0.5, 1 / ((sr / N) * 0.8)); // same ~0.8 s half-life in every register
  for (let i = 0; i < len; i++) {
    const next = (idx + 1) % N;
    const v = line[idx];
    d[i] = v;
    line[idx] = damp * 0.5 * (v + line[next]);
    idx = next;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= peak || 1;
  // y[n+N] = (y[n] + y[n+1]) / 2, so the loop period is N - 0.5 samples
  const entry = { buf, f0: sr / (N - 0.5) };
  harpCache.set(key, entry);
  // evicting a buffer that is still playing is safe: its source node holds a reference
  if (harpCache.size > HARP_CACHE_MAX) harpCache.delete(harpCache.keys().next().value!);
  return entry;
}

function harp(a: VoiceArgs) {
  const { ctx, out, freq, t, vel } = a;
  const { buf, f0 } = harpBuffer(ctx, freq);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const rate = freq / f0;
  src.playbackRate.value = rate;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(9000, freq * 10);
  const g = ctx.createGain();
  const level = 0.8 * vel * loudness(freq);
  // The string is still ringing (around -30 dB) when the note ends, so fade it over 0.35 s
  // (~50 dB) instead of cutting it; the end stays inside the buffer at any playbackRate.
  const end = t + Math.min(2.45, buf.duration / rate - 0.02);
  g.gain.setValueAtTime(level, t);
  g.gain.setValueAtTime(level, end - 0.35);
  g.gain.setTargetAtTime(0, end - 0.35, 0.06);
  src.connect(lp).connect(g).connect(out);
  src.start(t);
  src.stop(end);
}

function pad(a: VoiceArgs) {
  const { ctx, out, freq, t, dur, vel } = a;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(2400, freq * 4);
  lp.Q.value = 0.4;
  const g = ctx.createGain();
  const peak = 0.12 * vel * loudness(freq);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.18);
  g.gain.setValueAtTime(peak, t + Math.max(dur, 0.2));
  g.gain.setTargetAtTime(0, t + Math.max(dur, 0.2), 0.25);
  lp.connect(g).connect(out);
  // symmetric chorus keeps the perceived pitch centre exact
  for (const cents of [-5, 0, 5]) {
    const o = osc(ctx, 'sawtooth', freq);
    o.detune.value = cents;
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 1.5);
  }
  const sub = osc(ctx, 'sine', freq);
  const sg = ctx.createGain();
  sg.gain.value = 0.6;
  sub.connect(sg).connect(lp);
  sub.start(t);
  sub.stop(t + dur + 1.5);
}

let noiseBuf: AudioBuffer | null = null;
function flute(a: VoiceArgs) {
  const { ctx, out, freq, t, dur, vel } = a;
  const g = ctx.createGain();
  const peak = 0.22 * vel * loudness(freq);
  const rel = t + Math.max(dur, 0.1);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.07);
  g.gain.setValueAtTime(peak, rel); // hold, then release (a step in level here clicks)
  g.gain.setTargetAtTime(0, rel, 0.08);
  g.connect(out);
  const o1 = osc(ctx, 'sine', freq);
  // A near-pure sine below ~220 Hz has nothing a phone speaker can reproduce, so low notes
  // get stronger upper partials (exact multiples: the pitch is unchanged). From 220 Hz up
  // the voice is the original sine + 0.18 octave.
  const k = Math.min(1, Math.max(0, (220 - freq) / 120));
  const uppers: OscillatorNode[] = [];
  for (const [mult, amp] of [[2, 0.18 + 0.32 * k], [3, 0.22 * k], [4, 0.12 * k]]) {
    if (amp <= 0) continue;
    const o = osc(ctx, 'sine', freq * mult);
    const og = ctx.createGain();
    og.gain.value = amp;
    o.connect(og).connect(g);
    uppers.push(o);
  }
  // gentle, late vibrato (symmetric around the target pitch)
  const lfo = osc(ctx, 'sine', 5);
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(freq * 0.002, t + 0.6);
  lfo.connect(lg);
  lg.connect(o1.frequency);
  o1.connect(g);
  // breath
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const n = ctx.createBufferSource();
  n.buffer = noiseBuf;
  n.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq * 2;
  bp.Q.value = 2;
  const ng = ctx.createGain();
  ng.gain.value = 0.05;
  n.connect(bp).connect(ng).connect(g);
  const end = t + dur + 0.6;
  for (const s of [o1, ...uppers, lfo, n]) {
    s.start(t);
    s.stop(end);
  }
}

export const VOICES: Record<TimbreId, (a: VoiceArgs) => void> = {
  glass,
  epiano,
  musicbox,
  harp,
  pad,
  flute,
};

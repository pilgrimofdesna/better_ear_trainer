import { VOICES, type TimbreId } from './timbres';
import type { NoteEvent } from '../music/context';
import { freqOf } from '../music/theory';
import { settings } from '../settings';

let ctx: AudioContext | null = null;
let master: GainNode;
let dry: GainNode;
let live: GainNode | null = null; // current phrase bus, so "stop" can cut it

function impulse(c: AudioContext, seconds: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

/** Must be called from a user gesture the first time (mobile autoplay rules). */
export function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = settings.value.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    dry = ctx.createGain();
    dry.connect(master);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    dry.connect(verb).connect(wet).connect(master);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setVolume(v: number) {
  audio();
  master.gain.value = v;
}

/**
 * Wall-clock (epoch ms, the Date.now() clock) of an AudioContext time, for logging.
 * The performance clock stops while an Android phone sleeps, so it is mapped to
 * Date.now() with an offset measured now rather than with performance.timeOrigin.
 */
export function wallClock(audioTime: number): number {
  const c = audio();
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.contextTime !== undefined && ts.performanceTime) {
    return Date.now() - performance.now() + ts.performanceTime + (audioTime - ts.contextTime) * 1000;
  }
  return Date.now() + (audioTime - c.currentTime) * 1000;
}

export interface PlayResult {
  start: number; // AudioContext time
  end: number;
}

/** Fade out whatever phrase is playing (e.g. when the user replays or moves on). */
export function stopAll() {
  if (!ctx || !live) return;
  const g = live;
  g.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
  setTimeout(() => g.disconnect(), 400);
  live = null;
}

export function playEvents(
  events: NoteEvent[],
  tonicHz: number,
  timbre: TimbreId,
  opts: { delay?: number; sustainTimbre?: TimbreId; keep?: boolean } = {},
): PlayResult {
  const c = audio();
  if (!opts.keep) stopAll();
  if (!live) {
    live = c.createGain();
    live.connect(dry);
  }
  const start = c.currentTime + (opts.delay ?? 0.08);
  let end = start;
  for (const e of events) {
    const voice = e.sustain && opts.sustainTimbre ? opts.sustainTimbre : timbre;
    VOICES[voice]({ ctx: c, out: live, freq: freqOf(tonicHz, e.semi), t: start + e.t, dur: e.dur, vel: e.vel });
    end = Math.max(end, start + e.t + e.dur);
  }
  return { start, end };
}

export const playNote = (semi: number, tonicHz: number, timbre: TimbreId, dur = 0.9, keep = false) =>
  playEvents([{ semi, t: 0, dur, vel: 0.7 }], tonicHz, timbre, { keep, delay: 0.02 });

export const now = () => audio().currentTime;

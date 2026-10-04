// Weakness model and the hidden random/biased block schedule.
//
// Blocks of 4 questions: two random in a row and two biased in a row, order RRBB or
// BBRR chosen per block. Assuming the user is influenced only by the previous
// question, the second question of each pair follows a same-mode question, so it is a
// clean measurement of that mode ("pairPos 1").
import type { Selection, TrialRec } from '../data/db';
import { pc } from '../music/theory';

export interface Slot {
  selection: Selection;
  blockPos: number;
  pairPos: number;
}

export class BlockSchedule {
  private order: Selection[] = [];
  private pos = 0;
  next(): Slot {
    if (this.pos % 4 === 0) {
      this.order = Math.random() < 0.5 ? ['random', 'random', 'biased', 'biased'] : ['biased', 'biased', 'random', 'random'];
    }
    const blockPos = this.pos % 4;
    this.pos++;
    return { selection: this.order[blockPos], blockPos, pairPos: blockPos % 2 };
  }
}

// ---- response latency ----

/** Time from a note sounding to its answer: onset-based for single notes, per note for dictation. */
export function noteLatencies(t: TrialRec): number[] {
  if (t.exercise === 'single') return [t.tSubmit - t.tAudioStart];
  return t.tInputs.map((ti, i) => ti - (t.tAudioStart + i * t.noteDur * 1000));
}

export const latency = (t: TrialRec) => {
  const xs = noteLatencies(t);
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
};

// ---- patterns ----

export interface Outcome {
  key: string;
  err: number; // 0..1 error weight
}

export function singlePatterns(t: Pick<TrialRec, 'target' | 'registerOctave' | 'timbre'>, prevPc: number | null): string[] {
  const p = pc(t.target[0]);
  const keys = [`deg:${p}`, `reg:${p}@${t.registerOctave}`, `tim:${p}@${t.timbre}`];
  if (prevPc !== null) keys.push(`trans:${prevPc}>${p}`);
  return keys;
}

export function dictationPatterns(target: number[]): string[] {
  const keys = new Set<string>();
  target.forEach((s, i) => {
    keys.add(`deg:${pc(s)}`);
    if (i > 0) keys.add(`int:${pc(target[i - 1])}>${pc(s)}`);
  });
  return [...keys];
}

/** Error weight for each pattern of a finished trial. Slow correct answers count a little. */
export function outcomes(t: TrialRec, slowMs: number): Outcome[] {
  const slow = latency(t) > slowMs ? 0.3 : 0;
  if (t.exercise === 'single') {
    const err = t.allCorrect ? slow : 1;
    return t.patterns.map((key) => ({ key, err }));
  }
  const out: Outcome[] = [];
  t.target.forEach((s, i) => {
    out.push({ key: `deg:${pc(s)}`, err: t.correct[i] ? slow : 1 });
    if (i > 0) {
      const ok = t.correct[i] && t.correct[i - 1];
      out.push({ key: `int:${pc(t.target[i - 1])}>${pc(s)}`, err: ok ? slow : 1 });
    }
  });
  return out;
}

// ---- Beta sampling ----

function gammaSample(k: number): number {
  // Marsaglia–Tsang; boost for k < 1
  if (k < 1) return gammaSample(k + 1) * Math.pow(Math.random(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = Math.random() || 1e-12;
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export const betaSample = (a: number, b: number) => {
  const x = gammaSample(a);
  return x / (x + gammaSample(b));
};

interface Stat {
  err: number;
  ok: number;
  last: number;
}

export class WeaknessModel {
  private stats = new Map<string, Stat>();
  private n = 0; // trials seen
  private rts: number[] = [];

  constructor(
    history: TrialRec[] = [],
    private halfLife = 150,
  ) {
    for (const t of history) this.add(t);
  }

  /** Answers slower than twice the median correct latency count as shaky. */
  slowThreshold(): number {
    if (this.rts.length < 10) return Infinity;
    const s = [...this.rts].sort((a, b) => a - b);
    return 2 * s[Math.floor(s.length / 2)];
  }

  add(t: TrialRec) {
    const slow = this.slowThreshold();
    this.n++;
    if (t.allCorrect) {
      this.rts.push(latency(t));
      if (this.rts.length > 300) this.rts.shift();
    }
    for (const o of outcomes(t, slow)) {
      const s = this.decayed(o.key);
      s.err += o.err;
      s.ok += 1 - o.err;
      this.stats.set(o.key, s);
    }
  }

  private decayed(key: string): Stat {
    const s = this.stats.get(key);
    if (!s) return { err: 0, ok: 0, last: this.n };
    const f = Math.pow(0.5, (this.n - s.last) / this.halfLife);
    return { err: s.err * f, ok: s.ok * f, last: this.n };
  }

  /** Posterior mean error rate (prior Beta(1, 2)). */
  errorRate(key: string): number {
    const s = this.decayed(key);
    return (1 + s.err) / (3 + s.err + s.ok);
  }

  evidence(key: string): number {
    const s = this.decayed(key);
    return s.err + s.ok;
  }

  sample(key: string): number {
    const s = this.decayed(key);
    return betaSample(1 + s.err, 2 + s.ok);
  }

  /** Thompson sampling: the candidate whose sampled error rate is highest. */
  pick(candidates: string[]): string {
    const seen = candidates.filter((k) => this.evidence(k) > 0.5);
    const pool = seen.length ? seen : candidates;
    let best = pool[0];
    let bestV = -1;
    for (const k of pool) {
      const v = this.sample(k);
      if (v > bestV) {
        bestV = v;
        best = k;
      }
    }
    return best;
  }

  /** Keys ranked by posterior error, only those with some evidence. */
  weakest(prefix = '', min = 3, limit = 8): { key: string; rate: number; n: number }[] {
    return [...this.stats.keys()]
      .filter((k) => k.startsWith(prefix) && this.evidence(k) >= min)
      .map((key) => ({ key, rate: this.errorRate(key), n: this.evidence(key) }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, limit);
  }
}

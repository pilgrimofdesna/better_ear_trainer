// Weakness model and the hidden random/biased block schedule.
//
// Blocks of 4 questions: two random in a row and two biased in a row, order RRBB or
// BBRR chosen per block. Assuming the user is influenced only by the previous
// question, the second question of each pair follows a same-mode question, so it is a
// clean measurement of that mode ("pairPos 1"). Two blocks can also meet as RR|RR or
// BB|BB, so the stats classify trials by the trial that actually came before them.
import type { Selection, SessionRec, TrialRec } from '../data/db';
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

// ---- scoring ----

/** False for a note whose answer was shown as a hint: it is entered but never scored. */
export const scored = (t: Pick<TrialRec, 'hinted'>, i: number) => !t.hinted?.includes(i);

/** Scored outcomes of a trial: the trial itself for single notes, each unhinted note for dictation. */
export const units = (t: TrialRec): boolean[] =>
  t.exercise === 'single' ? (scored(t, 0) ? [t.allCorrect] : []) : t.correct.filter((_, i) => scored(t, i));

/** Every scored answer right (a mistyped hint note doesn't count). */
export const trialOk = (t: TrialRec) => units(t).every(Boolean);

/** Old dictation records predate `hinted`; recover it from the session's settings snapshot. */
export function withHints(trials: TrialRec[], sessions: SessionRec[]): TrialRec[] {
  const hintOn = new Set(
    sessions
      .filter((s) => s.exercise === 'dictation' && (s.settings as { dictation?: { firstHint?: boolean } } | null)?.dictation?.firstHint)
      .map((s) => s.id),
  );
  return trials.map((t) => (t.exercise === 'dictation' && !t.hinted && hintOn.has(t.sessionId) ? { ...t, hinted: [0] } : t));
}

// ---- response latency ----

/**
 * Time from each note first sounding to its answer, aligned with `target` (one value for
 * single notes). Measured from the first presentation, so time spent on replays counts as
 * deliberation. NaN where it can't be measured: hinted notes, inputs made before the note
 * sounded, and old records (no tPlays) whose onset a replay overwrote.
 */
export function noteLatencies(t: TrialRec): number[] {
  const onsetKnown = t.tPlays !== undefined || t.replays + t.contextReplays === 0;
  const raw =
    t.exercise === 'single'
      ? [t.tSubmit - t.tAudioStart]
      : t.target.map((_, i) => (t.tInputs[i] ?? NaN) - (t.tAudioStart + i * t.noteDur * 1000));
  return raw.map((x, i) => (onsetKnown && scored(t, i) && x >= 0 ? x : NaN));
}

/** Mean of the measurable note latencies, NaN if there are none. */
export const latency = (t: TrialRec) => {
  const xs = noteLatencies(t).filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
};

// the target sounded more than once before the answer (skipping the context to reach it
// doesn't count); old records without tPlays fall back to the replay counters
const replayed = (t: TrialRec) => (t.tPlays ? t.tPlays.length > 1 : t.replays + t.contextReplays > 0);

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

/** Dictation keys: degree, two-note interval, and degree at a position (`pos:p@i`). */
export function dictationPatterns(target: number[]): string[] {
  const keys = new Set<string>();
  target.forEach((s, i) => {
    keys.add(`deg:${pc(s)}`);
    keys.add(`pos:${pc(s)}@${i}`);
    if (i > 0) keys.add(`int:${pc(target[i - 1])}>${pc(s)}`);
  });
  return [...keys];
}

/**
 * Pattern keys a trial exercises. Dictation keys are recomputed from the target so old
 * records get newer pattern families; single-note `trans:` needs the stored list.
 */
export const trialPatterns = (t: TrialRec) => (t.exercise === 'dictation' ? dictationPatterns(t.target) : t.patterns);

/** Indices of the scored notes that belong to a pattern key (an interval's two notes). */
export function patternNotes(t: TrialRec, key: string): number[] {
  if (t.exercise === 'single') return scored(t, 0) && t.patterns.includes(key) ? [0] : [];
  const [kind, body] = key.split(':');
  const notes = new Set<number>();
  const pcs = t.target.map(pc);
  if (kind === 'deg') pcs.forEach((p, i) => p === +body && notes.add(i));
  if (kind === 'pos') {
    const [p, i] = body.split('@').map(Number);
    if (pcs[i] === p) notes.add(i);
  }
  if (kind === 'int') {
    const [a, b] = body.split('>').map(Number);
    for (let i = 1; i < pcs.length; i++) if (pcs[i - 1] === a && pcs[i] === b) notes.add(i - 1).add(i);
  }
  return [...notes].filter((i) => scored(t, i)).sort((a, b) => a - b);
}

/**
 * Error weight for each pattern of a finished trial. Correct answers that were slow or
 * needed a replay count a little. Hinted notes are left out; an interval that starts
 * on a hinted note is scored on its other note.
 */
export function outcomes(t: TrialRec, slowMs: number): Outcome[] {
  const shaky = latency(t) > slowMs || replayed(t) ? 0.3 : 0;
  if (t.exercise === 'single') {
    if (!scored(t, 0)) return [];
    const err = t.allCorrect ? shaky : 1;
    return t.patterns.map((key) => ({ key, err }));
  }
  const out: Outcome[] = [];
  t.target.forEach((s, i) => {
    const p = pc(s);
    if (scored(t, i)) {
      const err = t.correct[i] ? shaky : 1;
      out.push({ key: `deg:${p}`, err }, { key: `pos:${p}@${i}`, err });
    }
    if (i > 0) {
      const notes = [i - 1, i].filter((j) => scored(t, j));
      if (notes.length) out.push({ key: `int:${pc(t.target[i - 1])}>${p}`, err: notes.every((j) => t.correct[j]) ? shaky : 1 });
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

  /** Answers slower than twice the median correct (unreplayed) latency count as shaky. */
  slowThreshold(): number {
    if (this.rts.length < 10) return Infinity;
    const s = [...this.rts].sort((a, b) => a - b);
    return 2 * s[Math.floor(s.length / 2)];
  }

  add(t: TrialRec) {
    const slow = this.slowThreshold();
    this.n++;
    const lat = latency(t);
    if (trialOk(t) && !replayed(t) && Number.isFinite(lat)) {
      this.rts.push(lat);
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

  /**
   * Keys with some evidence, ranked by a cautious error estimate (posterior mean minus two
   * sd) so that sparse keys with a few unlucky misses don't crowd out well-measured
   * weaknesses. `rate` is the posterior mean.
   */
  weakest(prefix = '', min = 3, limit = 8): { key: string; rate: number; n: number }[] {
    const out: { key: string; rate: number; n: number; score: number }[] = [];
    for (const key of this.stats.keys()) {
      if (!key.startsWith(prefix)) continue;
      const s = this.decayed(key);
      const n = s.err + s.ok;
      if (n < min) continue;
      const a = 1 + s.err;
      const b = 2 + s.ok;
      const rate = a / (a + b);
      const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
      out.push({ key, rate, n, score: rate - 2 * sd });
    }
    return out
      .sort((x, y) => y.score - x.score)
      .slice(0, limit)
      .map(({ key, rate, n }) => ({ key, rate, n }));
  }
}

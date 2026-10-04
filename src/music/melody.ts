// Random melodies that stay in the intended key.
// Constraints: start/end on tonic-chord tones, chromatic notes resolve by step to a
// scale tone, no upward semitone "leading tone" into a non-tonic degree (♯4→5 etc.,
// which would tonicize another key), then a Krumhansl–Schmuckler check.
import { type Mode, SCALES, TONIC_TRIAD, pc, inScale } from './theory';
import { keyCheck } from './keyfinder';

export interface MelodyOptions {
  mode: Mode;
  length: number;
  pool: number[]; // allowed pitch classes (semitones 0..11)
  maxLeap?: number; // semitones
  low?: number; // lowest semi relative to tonic
  high?: number;
}

export interface Melody {
  semis: number[]; // relative to tonic, with octave
  attempts: number;
  keyRank: number; // melody-only K-S rank of the intended key (0 = first)
  keyMargin: number; // combined context+melody margin
}

const weightOf = (interval: number) => {
  const a = Math.abs(interval);
  if (a === 0) return 0.25;
  if (a <= 2) return 3;
  if (a <= 4) return 1.6;
  if (a <= 7) return 0.8;
  return 0.35;
};

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Is moving from `a` to `b` allowed (both semis relative to tonic)? */
export function transitionOk(a: number, b: number, mode: Mode): boolean {
  const chromA = !inScale(a, mode);
  const chromB = !inScale(b, mode);
  if (chromA && chromB) return false;
  if (chromA) {
    // must resolve by step to a scale tone
    if (Math.abs(b - a) > 2 || Math.abs(b - a) === 0) return false;
    // upward semitone into a non-tonic degree tonicizes that degree (♯4→5, ♯1→2, ...)
    if (b - a === 1 && pc(b) !== 0) return false;
  }
  return true;
}

function attempt(o: Required<MelodyOptions>): number[] | null {
  const triad = TONIC_TRIAD[o.mode];
  const poolTriad = o.pool.filter((p) => triad.includes(p));
  const ends = poolTriad.length ? poolTriad : o.pool.filter((p) => inScale(p, o.mode));
  if (!ends.length) return null;

  const placements = (p: number) => [p - 12, p, p + 12, p + 24].filter((s) => s >= o.low && s <= o.high);
  const firstPc = ends[Math.floor(Math.random() * ends.length)];
  const firstOpts = placements(firstPc);
  if (!firstOpts.length) return null;
  const seq = [firstOpts[Math.floor(Math.random() * firstOpts.length)]];

  for (let i = 1; i < o.length; i++) {
    const prev = seq[i - 1];
    const last = i === o.length - 1;
    const pcs = last ? ends : o.pool;
    const cands: number[] = [];
    for (const p of pcs) {
      for (const s of placements(p)) {
        if (Math.abs(s - prev) > o.maxLeap) continue;
        if (!transitionOk(prev, s, o.mode)) continue;
        // a chromatic note must leave room to resolve, so never place one last
        if (last && !inScale(s, o.mode)) continue;
        // at most one chromatic note in any 4-note window
        if (!inScale(s, o.mode) && seq.slice(-3).some((x) => !inScale(x, o.mode))) continue;
        cands.push(s);
      }
    }
    if (!cands.length) return null;
    seq.push(weightedPick(cands, cands.map((s) => weightOf(s - prev))));
  }
  // longer melodies keep returning to tonic-chord tones
  const triadCount = seq.filter((s) => triad.includes(pc(s))).length;
  if (o.length >= 5 && triadCount < Math.ceil(o.length / 3)) return null;
  if (o.length >= 6 && !seq.slice(1, -1).some((s) => pc(s) === 0) && o.pool.includes(0)) return null;
  return seq;
}

/** Pitch-class weights of a typical context in the key (stands in for the played context). */
function contextWeights(mode: Mode): number[] {
  const w = new Array(12).fill(0);
  for (const s of SCALES[mode]) w[s] += 1;
  for (const s of TONIC_TRIAD[mode]) w[s] += 1.5;
  return w;
}

export function keyStats(semis: number[], mode: Mode) {
  const mel = new Array(12).fill(0);
  semis.forEach((s, i) => (mel[pc(s)] += i === semis.length - 1 ? 1.5 : 1));
  const alone = keyCheck(mel, 0, mode);
  const ctx = contextWeights(mode);
  const total = mel.reduce((a, b) => a + b, 0);
  const combined = keyCheck(
    mel.map((m, i) => m / total + (0.35 * ctx[i]) / ctx.reduce((a, b) => a + b, 0)),
    0,
    mode,
  );
  return { aloneRank: alone.rank, combinedRank: combined.rank, margin: combined.margin };
}

export function generateMelody(opts: MelodyOptions, maxAttempts = 400): Melody {
  const o: Required<MelodyOptions> = { maxLeap: 7, low: -5, high: 19, ...opts };
  let best: Melody | null = null;
  for (let a = 1; a <= maxAttempts; a++) {
    const seq = attempt(o);
    if (!seq) continue;
    const k = keyStats(seq, o.mode);
    const cand = { semis: seq, attempts: a, keyRank: k.aloneRank, keyMargin: k.margin };
    const strict = o.length >= 4 ? k.aloneRank <= 2 : true;
    if (k.combinedRank === 0 && k.margin > 0.02 && strict) return cand;
    if (!best || cand.keyMargin > best.keyMargin) best = cand;
  }
  if (best) return best;
  // pool cannot satisfy the constraints: fall back to a tonic-only line
  return { semis: new Array(o.length).fill(0), attempts: maxAttempts, keyRank: 0, keyMargin: 0 };
}

/** Generate `n` candidates and keep the one with the highest score (used for biased questions). */
export function generateMelodyBiased(opts: MelodyOptions, score: (semis: number[]) => number, n = 30): Melody {
  let best: Melody | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    const m = generateMelody(opts, 120);
    const s = score(m.semis) + Math.random() * 1e-3;
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best!;
}

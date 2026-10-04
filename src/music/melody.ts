// Random melodies that stay in the intended key.
// Constraints: start/end on tonic-chord tones, chromatic notes resolve by step to a
// scale tone, no upward semitone "leading tone" into a non-tonic degree (♯4→5 etc.,
// which would tonicize another key), then a Krumhansl–Schmuckler check.
// Every note comes from the pool (the answer buttons). When the pool lacks what a rule
// needs, the rule bends, never the pool: the pool's scale tones stand in for missing
// tonic-chord tones, and a chromatic note with no stepwise resolution in the pool leans up
// a semitone or moves to the nearest scale tone the pool has.
import { type Mode, SCALES, TONIC_TRIAD, pc, inScale, pick } from './theory';
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

type Opts = Required<MelodyOptions>;

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

/**
 * Intervals a chromatic pitch class `p` may move by, given the scale tones in the pool:
 * the steps transitionOk allows when the pool has one; otherwise a semitone up into a scale
 * tone (♯4→5 in {1, ♯4, 5}); otherwise the nearest scale tone (♭3→1 in major {1, ♭3, 5}).
 * Empty only when the pool has no scale tone at all.
 */
export function resolutionSteps(p: number, pool: number[], mode: Mode): number[] {
  const scaleTones = pool.filter((q) => inScale(q, mode));
  const onto = (ds: number[]) => ds.filter((d) => scaleTones.includes(pc(p + d)));
  const strict = [...onto([-2, -1, 2]), ...onto([1]).filter((d) => pc(p + d) === 0)];
  if (strict.length) return strict;
  const lean = onto([1]);
  if (lean.length) return lean;
  for (let n = 3; n <= 6; n++) {
    const near = onto([-n, n]);
    if (near.length) return near;
  }
  return [];
}

interface Plan {
  ends: number[]; // pitch classes a line starts and ends on
  free: boolean; // no key rules: any pool tone may follow any other (pool without scale tones)
  steps: Map<number, number[]>; // chromatic pc -> intervals it may move by
  open: number[][]; // open[i]: placements at position i from which the line can still be finished
}

const placements = (o: Opts, p: number) => [p - 12, p, p + 12, p + 24].filter((s) => s >= o.low && s <= o.high);

function stepOk(o: Opts, plan: Plan, a: number, b: number): boolean {
  if (Math.abs(b - a) > o.maxLeap) return false;
  if (plan.free) return true;
  const chromA = !inScale(a, o.mode);
  if (chromA && !inScale(b, o.mode)) return false;
  return !chromA || plan.steps.get(pc(a))!.includes(b - a);
}

function makePlan(o: Opts, forceFree = false): Plan {
  const triad = o.pool.filter((p) => TONIC_TRIAD[o.mode].includes(p));
  const scaleTones = o.pool.filter((p) => inScale(p, o.mode));
  const chromatic = o.pool.filter((p) => !inScale(p, o.mode));
  const plan: Plan = {
    ends: triad.length ? triad : scaleTones.length ? scaleTones : o.pool,
    free: forceFree || !scaleTones.length,
    steps: new Map(chromatic.map((p) => [p, resolutionSteps(p, o.pool, o.mode)])),
    open: [],
  };
  // work back from the last note, so a line never walks into a dead end (e.g. a chromatic
  // note second to last whose resolution is not a tonic-chord tone); since the ends are
  // scale tones, a chromatic note is never last
  const all = o.pool.flatMap((p) => placements(o, p));
  plan.open[o.length - 1] = plan.ends.flatMap((p) => placements(o, p));
  for (let i = o.length - 2; i >= 0; i--) {
    plan.open[i] = all.filter((s) => plan.open[i + 1].some((t) => stepOk(o, plan, s, t)));
  }
  return plan;
}

/** Pool pitch classes that occur in some line the plan can finish (window and recurrence rules aside). */
function placeable(o: Opts, plan: Plan): number[] {
  let reach = plan.open[0].filter((s) => plan.ends.includes(pc(s)));
  const seen = new Set(reach.map(pc));
  for (let i = 1; i < o.length; i++) {
    const from = reach;
    reach = plan.open[i].filter((t) => from.some((s) => stepOk(o, plan, s, t)));
    for (const t of reach) seen.add(pc(t));
  }
  return o.pool.filter((p) => seen.has(p));
}

function attempt(o: Opts, plan: Plan): number[] | null {
  const starts = plan.open[0].filter((s) => plan.ends.includes(pc(s)));
  if (!starts.length) return null;
  const seq = [pick(starts)];

  for (let i = 1; i < o.length; i++) {
    const prev = seq[i - 1];
    const cands = plan.open[i].filter((s) => {
      if (!stepOk(o, plan, prev, s)) return false;
      // at most one chromatic note in any 4-note window
      return plan.free || inScale(s, o.mode) || !seq.slice(-3).some((x) => !inScale(x, o.mode));
    });
    if (!cands.length) return null;
    seq.push(weightedPick(cands, cands.map((s) => weightOf(s - prev))));
  }
  if (plan.free) return seq;
  // longer melodies keep returning to tonic-chord tones (or the scale tones standing in for them)
  const homeCount = seq.filter((s) => plan.ends.includes(pc(s))).length;
  if (o.length >= 5 && homeCount < Math.ceil(o.length / 3)) return null;
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
  const pool = [...new Set(opts.pool.map(pc))];
  const o: Opts = { maxLeap: 7, low: -5, high: 19, ...opts, pool: pool.length ? pool : [...SCALES[opts.mode]] };
  const plan = makePlan(o);
  // The key check prefers plain diatonic lines, so a chromatic button would hardly ever be
  // asked. Draw one pool degree; if it is chromatic and can be placed, the line must contain
  // it, so every chromatic degree in the pool turns up in at least 1/|pool| of the lines.
  const drawn = pick(o.pool);
  const want = !inScale(drawn, o.mode) && placeable(o, plan).includes(drawn) ? drawn : null;
  let best: Melody | null = null; // best line containing `want`
  let backup: Melody | null = null; // best line of any kind
  for (let a = 1; a <= maxAttempts; a++) {
    const seq = attempt(o, plan);
    if (!seq) continue;
    const k = keyStats(seq, o.mode);
    const cand = { semis: seq, attempts: a, keyRank: k.aloneRank, keyMargin: k.margin };
    const strict = o.length >= 4 ? k.aloneRank <= 2 : true;
    const has = want === null || seq.some((s) => pc(s) === want);
    if (has && k.combinedRank === 0 && k.margin > 0.02 && strict) return cand;
    if (has && (!best || cand.keyMargin > best.keyMargin)) best = cand;
    if (!backup || cand.keyMargin > backup.keyMargin) backup = cand;
  }
  const found = best ?? backup;
  if (found) return found;
  // nothing obeyed the rules: a free walk over pool tones can always finish (it may repeat)
  const seq = attempt(o, makePlan(o, true)) ?? new Array(o.length).fill(plan.ends[0]);
  const k = keyStats(seq, o.mode);
  return { semis: seq, attempts: maxAttempts, keyRank: k.aloneRank, keyMargin: k.margin };
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

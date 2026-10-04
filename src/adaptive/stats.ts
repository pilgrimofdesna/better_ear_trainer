// Analysis of the trial log: random vs biased performance, chance-corrected per-degree
// scores (hit rate vs how often the user presses that answer), response times, and
// accuracy spread across tonic height / register / timbre. Notes whose answer was shown
// as a hint are never scored.
import type { Selection, TrialRec } from '../data/db';
import { pc } from '../music/theory';
import { WeaknessModel, noteLatencies, patternNotes, scored, trialOk, trialPatterns, units } from './model';

export interface Rate {
  ok: number;
  n: number;
}
const rate = (): Rate => ({ ok: 0, n: 0 });
export const pct = (r: Rate) => (r.n ? r.ok / r.n : NaN);

/** Outcomes (true = correct) of the scored notes that belong to any of the keys, each note once. */
export function patternHits(t: TrialRec, keys: string[]): boolean[] {
  const notes = new Set(keys.flatMap((k) => patternNotes(t, k)));
  return [...notes].map((i) => t.correct[i]);
}

function add(r: Rate, hits: boolean[]) {
  for (const h of hits) {
    r.n++;
    if (h) r.ok++;
  }
}

export interface SessionPoint {
  sessionId: number;
  start: number;
  random: Rate;
  weakRandom: Rate;
  weakBiased: Rate;
}

// Inverse normal CDF (Acklam) for d′.
function zInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -zInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface DegreeRow {
  pc: number;
  n: number; // times it was the target
  hit: number; // P(answer d | target d)
  pressed: number; // times the user answered d
  fa: number; // P(answer d | target not d, d was offered)
  corrected: number; // hit - fa
  dprime: number;
  medianRt: number;
}

// The tonic is C3 (MIDI 48) + pitch class ± 50 cents, so the bands cut halfway between
// semitones and every pitch class lands in one band whatever its detune.
const TONIC_BANDS = ['낮음 (C3–D3)', '중저 (D♯3–F3)', '중고 (F♯3–G♯3)', '높음 (A3–B3)'];
const tonicBand = (hz: number) => {
  const semis = 12 * Math.log2(hz / 130.8128); // from C3
  return Math.min(3, Math.max(0, Math.floor((semis + 0.5) / 3)));
};

/** Trials must be oldest first, so a session's trials are adjacent and in order. */
export function analyze(trials: TrialRec[], opts: { cleanOnly?: boolean } = {}) {
  const all = trials;
  // selection of the question that really came just before; null at a session start or a gap
  const prevSel: (Selection | null)[] = all.map((t, i) => {
    const p = all[i - 1];
    return p && p.sessionId === t.sessionId && p.index === t.index - 1 ? p.selection : null;
  });
  // clean = same mode as the previous question (one-step memory assumption)
  const use = (i: number) => !opts.cleanOnly || prevSel[i] === all[i].selection;

  // ---- weak patterns, chosen prospectively ----
  // A trial counts toward the weak lines when it exercises a pattern that was among the
  // weakest before it was answered. Picking the set from the final model instead makes the
  // recent end low by construction: those patterns are in the set because they just failed.
  const model = new WeaknessModel();
  let ws = new Set<string>();
  const weakAt = all.map((t, i) => {
    // refreshed at each session start and every 10 questions (ranking every trial is slow on a long log)
    if (i % 10 === 0 || all[i - 1].sessionId !== t.sessionId) ws = new Set(model.weakest('', 3, 6).map((w) => w.key));
    model.add(t);
    return trialPatterns(t).filter((k) => ws.has(k));
  });
  const weak = model.weakest('', 3, 6);

  // ---- trend, per session and per chunk of 20 questions ----
  const trend = (groupOf: (t: TrialRec, i: number) => number) => {
    const groups = new Map<number, SessionPoint>();
    all.forEach((t, i) => {
      const g = groupOf(t, i);
      if (!groups.has(g)) groups.set(g, { sessionId: g, start: t.tPresented, random: rate(), weakRandom: rate(), weakBiased: rate() });
      if (!use(i)) return;
      const p = groups.get(g)!;
      if (t.selection === 'random') add(p.random, units(t));
      add(t.selection === 'random' ? p.weakRandom : p.weakBiased, patternHits(t, weakAt[i]));
    });
    return [...groups.values()].sort((a, b) => a.start - b.start);
  };
  const sessions = trend((t) => t.sessionId);
  const chunks = trend((_, i) => Math.floor(i / 20));

  // ---- overall ----
  // first / clean / sessionFirst split random questions by what came before them (the
  // transition effect), so they ignore the clean toggle.
  const overall = { random: rate(), biased: rate(), clean: rate(), first: rate(), sessionFirst: rate() };
  all.forEach((t, i) => {
    if (use(i)) add(t.selection === 'random' ? overall.random : overall.biased, units(t));
    if (t.selection !== 'random') return;
    add(prevSel[i] === null ? overall.sessionFirst : prevSel[i] === 'random' ? overall.clean : overall.first, units(t));
  });

  // ---- per-degree with chance correction ----
  const deg = new Map<number, { n: number; hit: number; pressed: number; offeredNot: number; faCount: number; rts: number[] }>();
  const get = (p: number) => {
    if (!deg.has(p)) deg.set(p, { n: 0, hit: 0, pressed: 0, offeredNot: 0, faCount: 0, rts: [] });
    return deg.get(p)!;
  };
  const confusion = new Map<string, number>();
  let chanceSum = 0;
  let chanceN = 0;
  all.forEach((t, i) => {
    if (!use(i)) return;
    const lat = noteLatencies(t);
    t.target.forEach((s, j) => {
      if (!scored(t, j)) return;
      const target = pc(s);
      const ans = t.answer[j];
      chanceSum += 1 / Math.max(1, t.choiceSet.length);
      chanceN++;
      const g = get(target);
      g.n++;
      if (ans === target) g.hit++;
      if (Number.isFinite(lat[j])) g.rts.push(lat[j]);
      get(ans).pressed++;
      for (const c of t.choiceSet) {
        if (c === target) continue;
        const o = get(c);
        o.offeredNot++;
        if (ans === c) o.faCount++;
      }
      confusion.set(`${target}>${ans}`, (confusion.get(`${target}>${ans}`) ?? 0) + 1);
    });
  });
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
  const degrees: DegreeRow[] = [...deg.entries()]
    .filter(([, g]) => g.n > 0)
    .map(([p, g]) => {
      const hit = g.hit / g.n;
      const fa = g.offeredNot ? g.faCount / g.offeredNot : 0;
      // log-linear correction keeps d′ finite at 0% / 100%
      const H = (g.hit + 0.5) / (g.n + 1);
      const F = (g.faCount + 0.5) / (g.offeredNot + 1);
      return { pc: p, n: g.n, hit, pressed: g.pressed, fa, corrected: hit - fa, dprime: zInv(H) - zInv(F), medianRt: median(g.rts) };
    })
    .sort((a, b) => a.pc - b.pc);

  // ---- response time vs accuracy, per note ----
  const rtBins = [
    { label: '< 1초', max: 1000, r: rate() },
    { label: '1–2초', max: 2000, r: rate() },
    { label: '2–4초', max: 4000, r: rate() },
    { label: '4초 이상', max: Infinity, r: rate() },
  ];
  const rtCorrect: number[] = [];
  const rtWrong: number[] = [];
  all.forEach((t, i) => {
    if (!use(i)) return;
    noteLatencies(t).forEach((ms, j) => {
      if (!Number.isFinite(ms)) return; // hinted, answered before it sounded, or an unreliable old record
      const ok = t.correct[j];
      add(rtBins.find((b) => ms < b.max)!.r, [ok]);
      (ok ? rtCorrect : rtWrong).push(ms);
    });
  });

  // ---- condition spread (relation learning check) ----
  const group = (keyOf: (t: TrialRec) => string, orderOf: (t: TrialRec) => number = () => 0) => {
    const m = new Map<string, { r: Rate; o: number }>();
    all.forEach((t, i) => {
      if (!use(i)) return;
      const k = keyOf(t);
      if (!m.has(k)) m.set(k, { r: rate(), o: orderOf(t) });
      add(m.get(k)!.r, units(t));
    });
    return [...m.entries()].sort(([a, x], [b, y]) => x.o - y.o || (a < b ? -1 : 1)).map(([k, { r }]) => ({ k, r }));
  };
  const conditions = {
    tonic: group((t) => TONIC_BANDS[tonicBand(t.tonicHz)], (t) => tonicBand(t.tonicHz)),
    register: group((t) => `${t.registerOctave >= 0 ? '+' : ''}${t.registerOctave} 옥타브`, (t) => t.registerOctave),
    timbre: group((t) => t.timbre),
    context: group((t) => (t.contextPlayed ? (t.contextKind ?? '?') : '맥락 없음')),
  };

  // ---- sequential effects (one-step memory assumption) ----
  // Only random questions that follow a random question: their content doesn't depend on
  // history and no mode switch is involved, so a gap between the bars comes from the user,
  // not from the hidden schedule (wrong answers cluster on biased pairs).
  const afterOk = rate();
  const afterBad = rate();
  all.forEach((t, i) => {
    if (t.selection !== 'random' || prevSel[i] !== 'random') return;
    add(trialOk(all[i - 1]) ? afterOk : afterBad, units(t));
  });

  return {
    count: all.length,
    sessions,
    chunks,
    overall,
    degrees,
    confusion,
    chance: chanceN ? chanceSum / chanceN : NaN,
    rtBins,
    rtMedian: { correct: median(rtCorrect), wrong: median(rtWrong) },
    conditions,
    sequential: { afterOk, afterBad },
    weak,
  };
}

export type Analysis = ReturnType<typeof analyze>;

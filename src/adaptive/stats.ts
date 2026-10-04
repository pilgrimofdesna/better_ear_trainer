// Analysis of the trial log: random vs biased performance, chance-corrected per-degree
// scores (hit rate vs how often the user presses that answer), response times, and
// accuracy spread across tonic height / register / timbre.
import type { TrialRec } from '../data/db';
import { pc } from '../music/theory';
import { WeaknessModel, latency, noteLatencies } from './model';

export interface Rate {
  ok: number;
  n: number;
}
const rate = (): Rate => ({ ok: 0, n: 0 });
export const pct = (r: Rate) => (r.n ? r.ok / r.n : NaN);

/** Outcomes (true = correct) of a trial for one pattern key. */
export function patternHits(t: TrialRec, key: string): boolean[] {
  if (!t.patterns.includes(key)) return [];
  if (t.exercise === 'single') return [t.allCorrect];
  const [kind, body] = key.split(':');
  const out: boolean[] = [];
  if (kind === 'deg') t.target.forEach((s, i) => pc(s) === +body && out.push(t.correct[i]));
  if (kind === 'int') {
    const [a, b] = body.split('>').map(Number);
    for (let i = 1; i < t.target.length; i++)
      if (pc(t.target[i - 1]) === a && pc(t.target[i]) === b) out.push(t.correct[i - 1] && t.correct[i]);
  }
  return out;
}

/** Unit outcomes of a trial: the trial itself for single notes, each note for dictation. */
const units = (t: TrialRec) => (t.exercise === 'single' ? [t.allCorrect] : t.correct);

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

export function analyze(trials: TrialRec[], opts: { cleanOnly?: boolean } = {}) {
  const all = trials;
  const use = (t: TrialRec) => !opts.cleanOnly || t.pairPos === 1;
  const model = new WeaknessModel(all);
  const weak = model.weakest('', 3, 6);
  const weakKeys = weak.map((w) => w.key);

  // ---- per session trend ----
  const bySession = new Map<number, SessionPoint>();
  for (const t of all) {
    if (!bySession.has(t.sessionId))
      bySession.set(t.sessionId, { sessionId: t.sessionId, start: t.tPresented, random: rate(), weakRandom: rate(), weakBiased: rate() });
    if (!use(t)) continue;
    const p = bySession.get(t.sessionId)!;
    if (t.selection === 'random') add(p.random, units(t));
    const hits = weakKeys.flatMap((k) => patternHits(t, k));
    add(t.selection === 'random' ? p.weakRandom : p.weakBiased, hits);
  }
  const sessions = [...bySession.values()].sort((a, b) => a.start - b.start);

  // ---- overall ----
  const overall = { random: rate(), biased: rate(), clean: rate(), first: rate() };
  for (const t of all) {
    add(t.selection === 'random' ? overall.random : overall.biased, units(t));
    if (t.selection === 'random') add(t.pairPos === 1 ? overall.clean : overall.first, units(t));
  }

  // ---- per-degree with chance correction ----
  const deg = new Map<number, { n: number; hit: number; pressed: number; offeredNot: number; faCount: number; rts: number[] }>();
  const get = (p: number) => {
    if (!deg.has(p)) deg.set(p, { n: 0, hit: 0, pressed: 0, offeredNot: 0, faCount: 0, rts: [] });
    return deg.get(p)!;
  };
  const confusion = new Map<string, number>();
  let chanceSum = 0;
  let chanceN = 0;
  for (const t of all) {
    if (!use(t)) continue;
    const lat = noteLatencies(t);
    t.target.forEach((s, i) => {
      const target = pc(s);
      const ans = t.answer[i];
      chanceSum += 1 / Math.max(1, t.choiceSet.length);
      chanceN++;
      const g = get(target);
      g.n++;
      if (ans === target) g.hit++;
      if (Number.isFinite(lat[i])) g.rts.push(lat[i]);
      get(ans).pressed++;
      for (const c of t.choiceSet) {
        if (c === target) continue;
        const o = get(c);
        o.offeredNot++;
        if (ans === c) o.faCount++;
      }
      confusion.set(`${target}>${ans}`, (confusion.get(`${target}>${ans}`) ?? 0) + 1);
    });
  }
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

  // ---- response time vs accuracy ----
  const rtBins = [
    { label: '< 1초', max: 1000, r: rate() },
    { label: '1–2초', max: 2000, r: rate() },
    { label: '2–4초', max: 4000, r: rate() },
    { label: '4초 이상', max: Infinity, r: rate() },
  ];
  const rtCorrect: number[] = [];
  const rtWrong: number[] = [];
  for (const t of all) {
    if (!use(t)) continue;
    const per = latency(t);
    const bin = rtBins.find((b) => per < b.max)!;
    add(bin.r, units(t));
    (t.allCorrect ? rtCorrect : rtWrong).push(per);
  }

  // ---- condition spread (relation learning check) ----
  const group = (keyOf: (t: TrialRec) => string) => {
    const m = new Map<string, Rate>();
    for (const t of all) {
      if (!use(t)) continue;
      const k = keyOf(t);
      if (!m.has(k)) m.set(k, rate());
      add(m.get(k)!, units(t));
    }
    return [...m.entries()].map(([k, r]) => ({ k, r })).sort((a, b) => (a.k < b.k ? -1 : 1));
  };
  const tonicBand = (hz: number) => {
    const semis = 12 * Math.log2(hz / 130.81); // from C3
    return semis < 3 ? '낮음 (C3–D♯3)' : semis < 6 ? '중저 (E3–F♯3)' : semis < 9 ? '중고 (G3–A3)' : '높음 (A♯3–C4)';
  };
  const conditions = {
    tonic: group((t) => tonicBand(t.tonicHz)),
    register: group((t) => `${t.registerOctave >= 0 ? '+' : ''}${t.registerOctave} 옥타브`),
    timbre: group((t) => t.timbre),
    context: group((t) => (t.contextPlayed ? (t.contextKind ?? '?') : '맥락 없음')),
  };

  // ---- sequential effects (one-step memory assumption) ----
  const afterOk = rate();
  const afterBad = rate();
  for (let i = 1; i < all.length; i++) {
    const t = all[i];
    const p = all[i - 1];
    if (p.sessionId !== t.sessionId) continue;
    add(p.allCorrect ? afterOk : afterBad, units(t));
  }

  return {
    count: all.length,
    sessions,
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

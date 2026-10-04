import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockSchedule, WeaknessModel, latency, noteLatencies, outcomes, trialOk, units, withHints } from './model';
import { analyze, patternHits, pct } from './stats';
import { buildQuestion, type Question } from '../session/question';
import { DEFAULTS, type Settings } from '../settings';
import { pc } from '../music/theory';
import type { SessionRec, TrialRec } from '../data/db';

function record(q: Question, answer: number[], i: number, latencyMs = 1500, at: Partial<TrialRec> = {}): TrialRec {
  const t0 = 1_000_000 + i * 10_000;
  const correct = q.target.map((s, k) => pc(s) === answer[k]);
  return {
    sessionId: 1 + Math.floor(i / 40),
    exercise: q.exercise,
    index: i,
    mode: q.mode,
    choiceSet: q.choiceSet,
    degreePool: q.degreePool,
    contextPlayed: !!q.context,
    contextKind: q.context?.kind,
    drone: q.drone,
    tonicPc: q.tonicPc,
    detuneCents: q.detuneCents,
    tonicHz: q.tonicHz,
    timbre: q.timbre,
    contextTimbre: q.contextTimbre,
    noteDur: q.noteDur,
    target: q.target,
    registerOctave: q.registerOctave,
    selection: q.slot.selection,
    blockPos: q.slot.blockPos,
    pairPos: q.slot.pairPos,
    biasPattern: q.biasPattern,
    patterns: q.patterns,
    answer,
    correct,
    allCorrect: correct.every(Boolean),
    tPresented: t0,
    tAudioStart: t0 + 3000,
    tAudioEnd: t0 + 4000,
    tPlays: [t0 + 3000],
    tInputs: answer.map((_, k) => t0 + 3000 + k * q.noteDur * 1000 + latencyMs),
    tSubmit: t0 + 3000 + latencyMs,
    rtMs: latencyMs - 1000,
    sincePrevMs: 10_000,
    replays: 0,
    contextReplays: 0,
    probes: 0,
    ...at,
  };
}

/** A user who hears everything except 4, and answers "4" whenever unsure about 3 or 4. */
const answerOf = (target: number) => {
  const p = pc(target);
  if (p === 5 || p === 4) return Math.random() < 0.5 ? 5 : 4;
  return p;
};

describe('block schedule', () => {
  it('mixes two random and two biased per block', () => {
    const s = new BlockSchedule();
    for (let b = 0; b < 50; b++) {
      const block = [s.next(), s.next(), s.next(), s.next()];
      const sel = block.map((x) => x.selection).join(',');
      expect(['random,random,biased,biased', 'biased,biased,random,random']).toContain(sel);
      expect(block.map((x) => x.pairPos)).toEqual([0, 1, 0, 1]);
    }
  });
});

describe('adaptive single-note training', () => {
  it('biased questions concentrate on the weak degrees and stats correct for guessing', () => {
    const model = new WeaknessModel();
    const schedule = new BlockSchedule();
    const trials: TrialRec[] = [];
    let prev = null as Question | null;
    for (let i = 0; i < 600; i++) {
      const q = buildQuestion({
        exercise: 'single',
        s: DEFAULTS,
        slot: schedule.next(),
        model,
        index: i,
        prevRef: prev,
        prevTargetPc: prev ? pc(prev.target[0]) : null,
      });
      const t = record(q, [answerOf(q.target[0])], i);
      model.add(t);
      trials.push(t);
      prev = q;
    }
    const share = (sel: string) => {
      const ts = trials.filter((t) => t.selection === sel);
      return ts.filter((t) => [4, 5].includes(pc(t.target[0]))).length / ts.length;
    };
    // random: 2/7 of questions are 3 or 4; biased should be well above that
    expect(share('random')).toBeLessThan(0.45);
    expect(share('biased')).toBeGreaterThan(0.5);

    const a = analyze(trials);
    const four = a.degrees.find((d) => d.pc === 5)!;
    const three = a.degrees.find((d) => d.pc === 4)!;
    const one = a.degrees.find((d) => d.pc === 0)!;
    expect(four.hit).toBeGreaterThan(0.35);
    expect(four.corrected).toBeLessThan(four.hit); // false alarms pull it down
    expect(one.corrected).toBeGreaterThan(0.9);
    expect(three.dprime).toBeLessThan(one.dprime);
    // the weakest pattern targets 3 or 4 (also as "4 after x")
    expect(a.weak[0].key).toMatch(/^(deg|reg|tim):(4|5)\b|^trans:\d+>(4|5)$/);
  });
});

describe('adaptive dictation', () => {
  it('biased melodies include the weak degree more often', () => {
    const model = new WeaknessModel();
    const schedule = new BlockSchedule();
    const s = { ...DEFAULTS, dictation: { ...DEFAULTS.dictation, length: 4 } };
    const counts = { random: [0, 0], biased: [0, 0] };
    let prev = null as Question | null;
    for (let i = 0; i < 160; i++) {
      const q = buildQuestion({ exercise: 'dictation', s, slot: schedule.next(), model, index: i, prevRef: prev, prevTargetPc: null });
      model.add(record(q, q.target.map(answerOf), i));
      const c = counts[q.slot.selection];
      c[0] += q.target.filter((x) => pc(x) === 5).length;
      c[1] += q.target.length;
      prev = q;
    }
    expect(counts.biased[0] / counts.biased[1]).toBeGreaterThan(counts.random[0] / counts.random[1]);
  });
});

// ---- simulated users over many sessions ----

/** Deterministic Math.random so the simulations below give the same numbers on every run. */
function seed(n: number) {
  let a = n >>> 0;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

const wrongChoice = (q: Question, target: number) => {
  const others = q.choiceSet.filter((c) => c !== pc(target));
  return others[Math.floor(Math.random() * others.length)];
};

interface SimOpts {
  exercise: 'single' | 'dictation';
  s?: Settings;
  sessions: number;
  perSession: number;
  /** answer for each target note; `prev` is the previous question of the same session */
  answer: (q: Question, prev: Question | null) => number[];
  at?: Partial<TrialRec>;
}

/** Runs sessions the way the trainer does: model rebuilt from history, fresh schedule per session. */
function simulate(o: SimOpts): TrialRec[] {
  const s = o.s ?? DEFAULTS;
  const trials: TrialRec[] = [];
  let i = 0;
  for (let si = 0; si < o.sessions; si++) {
    const model = new WeaknessModel(trials);
    const schedule = new BlockSchedule();
    let prev: Question | null = null;
    for (let k = 0; k < o.perSession; k++, i++) {
      const q = buildQuestion({
        exercise: o.exercise,
        s,
        slot: schedule.next(),
        model,
        index: k,
        prevRef: prev,
        prevTargetPc: prev ? pc(prev.target[prev.target.length - 1]) : null,
      });
      const t = record(q, o.answer(q, prev), i, 1500, { sessionId: si + 1, index: k, ...o.at });
      model.add(t);
      trials.push(t);
      prev = q;
    }
  }
  return trials;
}

const sum = (rs: { ok: number; n: number }[]) => rs.reduce((a, r) => ({ ok: a.ok + r.ok, n: a.n + r.n }), { ok: 0, n: 0 });

describe('weak-pattern trend', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stays flat at the recent end for a user with no weakness and no learning', () => {
    const early: { ok: number; n: number }[] = [];
    const recent: { ok: number; n: number }[] = [];
    for (const k of [1, 2, 3, 4]) {
      seed(k);
      const flat = (q: Question) => [Math.random() < 0.75 ? pc(q.target[0]) : wrongChoice(q, q.target[0])];
      const a = analyze(simulate({ exercise: 'single', sessions: 30, perSession: 40, answer: flat }));
      expect(a.sessions).toHaveLength(30);
      early.push(...a.sessions.slice(1, 20).map((p) => p.weakRandom));
      recent.push(...a.sessions.slice(-3).map((p) => p.weakRandom));
    }
    const e = sum(early);
    const r = sum(recent);
    expect(r.n).toBeGreaterThan(40);
    // a weak set picked from the final model drags this to ~35-45%; picked prospectively it stays near 75%
    expect(pct(r)).toBeGreaterThan(0.6);
    expect(Math.abs(pct(r) - pct(e))).toBeLessThan(0.15);
  });

  it('flags a trial as weak from earlier trials only', () => {
    seed(21);
    const flat = (q: Question) => [Math.random() < 0.75 ? pc(q.target[0]) : wrongChoice(q, q.target[0])];
    const trials = simulate({ exercise: 'single', sessions: 12, perSession: 40, answer: flat });
    const last = trials[trials.length - 1].sessionId;
    // the same log with the last session's results reversed
    const flipped = trials.map((t) => (t.sessionId === last ? { ...t, correct: t.correct.map((c) => !c), allCorrect: !t.allCorrect } : t));
    expect(analyze(flipped).sessions.slice(0, -1)).toEqual(analyze(trials).sessions.slice(0, -1));
  });
});

describe('sequential effects', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows no gap after right vs wrong answers for a history-independent user', () => {
    seed(7);
    // never hears 4 (pc 5), always right otherwise; the previous question plays no part
    const user = (q: Question) => [pc(q.target[0]) === 5 ? wrongChoice(q, q.target[0]) : pc(q.target[0])];
    const a = analyze(simulate({ exercise: 'single', sessions: 75, perSession: 40, answer: user }));
    const { afterOk, afterBad } = a.sequential;
    expect(afterBad.n).toBeGreaterThan(50);
    // pooled over biased questions too, this gap is large: misses cluster on biased pairs
    expect(Math.abs(pct(afterOk) - pct(afterBad))).toBeLessThan(0.1);
  });

  it('classifies transitions by the question that really came before', () => {
    seed(11);
    // right only right after a question of the same mode
    const user = (q: Question, prev: Question | null) => [
      prev && prev.slot.selection === q.slot.selection ? pc(q.target[0]) : wrongChoice(q, q.target[0]),
    ];
    const trials = simulate({ exercise: 'single', sessions: 20, perSession: 40, answer: user });
    const a = analyze(trials);
    expect(a.overall.first.n).toBeGreaterThan(0);
    expect(a.overall.first.ok).toBe(0);
    expect(a.overall.clean.ok).toBe(a.overall.clean.n);
    expect(a.overall.sessionFirst.ok).toBe(0);
    // RR|RR block boundaries: some pairPos-0 random questions follow a random one
    const secondOfPair = trials.filter((t) => t.selection === 'random' && t.pairPos === 1).length;
    expect(a.overall.clean.n).toBeGreaterThan(secondOfPair);
    // the headline tiles follow the clean toggle
    expect(pct(a.overall.random)).toBeLessThan(1);
    const c = analyze(trials, { cleanOnly: true });
    expect(c.overall.random.ok).toBe(c.overall.random.n);
    expect(c.overall.biased.ok).toBe(c.overall.biased.n);
  });
});

describe('dictation patterns', () => {
  afterEach(() => vi.restoreAllMocks());
  const s5 = { ...DEFAULTS, dictation: { ...DEFAULTS.dictation, length: 5 } };

  it('learns a middle-note weakness through the position pattern', () => {
    seed(3);
    const user = (q: Question) => q.target.map((x, i) => (i === 2 ? wrongChoice(q, x) : pc(x)));
    const trials = simulate({ exercise: 'dictation', s: s5, sessions: 8, perSession: 40, answer: user });
    const model = new WeaknessModel(trials);
    const posRate = (i: number) => {
      const ks = [0, 2, 4, 5, 7, 9, 11].map((p) => `pos:${p}@${i}`).filter((k) => model.evidence(k) > 1);
      return ks.reduce((a, k) => a + model.errorRate(k), 0) / ks.length;
    };
    expect(posRate(2)).toBeGreaterThan(0.8);
    expect(posRate(1)).toBeLessThan(0.2);
    expect(posRate(3)).toBeLessThan(0.2);
    const weak = analyze(trials).weak;
    expect(weak[0].key).toMatch(/^pos:\d+@2$/);
    expect(weak.filter((w) => /^pos:\d+@2$/.test(w.key)).length).toBeGreaterThanOrEqual(3);
  });

  it('leaves hinted notes out of every score', () => {
    seed(5);
    const s4 = { ...DEFAULTS, dictation: { ...DEFAULTS.dictation, length: 4, firstHint: true } };
    // the hinted first note is always right; the rest is a coin flip
    const user = (q: Question) => q.target.map((x, i) => (i === 0 || Math.random() < 0.5 ? pc(x) : wrongChoice(q, x)));
    const trials = simulate({ exercise: 'dictation', s: s4, sessions: 10, perSession: 40, answer: user, at: { hinted: [0] } });
    const scoredNotes = trials.length * 3;

    const a = analyze(trials);
    expect(a.degrees.reduce((x, d) => x + d.n, 0)).toBe(scoredNotes);
    expect([...a.confusion.values()].reduce((x, y) => x + y, 0)).toBe(scoredNotes);
    expect(a.overall.random.n + a.overall.biased.n).toBe(scoredNotes);
    // melodies start on 1/3/5; counting the hint would lift those degrees well above 50%
    const tonic = a.degrees.find((d) => d.pc === 0)!;
    expect(tonic.hit).toBeGreaterThan(0.38);
    expect(tonic.hit).toBeLessThan(0.62);

    const model = new WeaknessModel(trials);
    for (const p of [0, 4, 7]) expect(model.evidence(`pos:${p}@0`)).toBe(0);
    expect(model.errorRate('deg:0')).toBeGreaterThan(0.35);

    const t = trials[0];
    expect(noteLatencies(t)[0]).toBeNaN();
    expect(patternHits(t, [`pos:${pc(t.target[0])}@0`])).toEqual([]);
    expect(units(t)).toHaveLength(3);
    // a mistyped hint note doesn't fail the melody
    const mistyped = { ...t, answer: [99, ...t.target.slice(1).map(pc)], correct: [false, true, true, true], allCorrect: false };
    expect(trialOk(mistyped)).toBe(true);
    expect(outcomes(mistyped, Infinity).every((o) => o.err === 0)).toBe(true);
  });

  it('recovers the hint flag of old records from the session settings', () => {
    seed(9);
    const trials = simulate({ exercise: 'dictation', sessions: 2, perSession: 4, answer: (q) => q.target.map(pc) });
    const sessions = [
      { id: 1, exercise: 'dictation', settings: { dictation: { firstHint: true } } },
      { id: 2, exercise: 'dictation', settings: { dictation: { firstHint: false } } },
    ] as SessionRec[];
    const out = withHints(trials, sessions);
    expect(out.filter((t) => t.sessionId === 1).every((t) => t.hinted?.[0] === 0)).toBe(true);
    expect(out.filter((t) => t.sessionId === 2).every((t) => !t.hinted)).toBe(true);
  });
});

describe('latency', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is measured from the first presentation and never negative', () => {
    seed(13);
    const s4 = { ...DEFAULTS, dictation: { ...DEFAULTS.dictation, length: 4 } };
    const [base] = simulate({ exercise: 'dictation', s: s4, sessions: 1, perSession: 1, answer: (q) => q.target.map(pc) });
    const T = base.tAudioStart;
    const dur = base.noteDur * 1000;
    // notes 1-2 entered, a replay at T+6 s, notes 3-4 entered after it
    const replayed = { ...base, tPlays: [T, T + 6120], replays: 1, tInputs: [T + 3000, T + 3500, T + 9000, T + 9500] };
    expect(noteLatencies(replayed)).toEqual([3000, 3500 - dur, 9000 - 2 * dur, 9500 - 3 * dur]);
    // a replayed correct answer counts as shaky even when quick
    expect(outcomes(replayed, Infinity).every((o) => o.err === 0.3)).toBe(true);
    // an input before its note sounded is not a reaction to it
    const early = { ...base, tInputs: [T + 200, T + 300, T + 3000, T + 3100] };
    expect(noteLatencies(early)[1]).toBeNaN();
    expect(noteLatencies(early)[0]).toBe(200);
    // old records: the onset was overwritten by a replay, so nothing can be measured
    const legacy = { ...replayed, tPlays: undefined, tAudioStart: T + 6120 };
    expect(noteLatencies(legacy).every(Number.isNaN)).toBe(true);
    expect(latency(legacy)).toBeNaN();
    const a = analyze([legacy]);
    expect(a.rtBins.reduce((x, b) => x + b.r.n, 0)).toBe(0);
    expect(a.degrees.every((d) => Number.isNaN(d.medianRt))).toBe(true);
  });
});

describe('condition spread', () => {
  afterEach(() => vi.restoreAllMocks());

  it('bands tonic height by the nearest semitone, low to high', () => {
    seed(17);
    const [base] = simulate({ exercise: 'single', sessions: 1, perSession: 1, answer: (q) => [pc(q.target[0])] });
    const hz = (p: number, cents: number) => 130.8128 * 2 ** ((p + cents / 100) / 12);
    const ts = [
      { p: 9, c: 0 },
      { p: 3, c: -49 },
      { p: 3, c: 49 },
      { p: 2, c: 49 },
      { p: 6, c: 0 },
      { p: 11, c: 49 },
      { p: 0, c: -49 },
    ].map(({ p, c }, i) => ({ ...base, index: i, tonicPc: p, detuneCents: c, tonicHz: hz(p, c) }));
    const rows = analyze(ts).conditions.tonic;
    expect(rows.map((r) => r.k)).toEqual(['낮음 (C3–D3)', '중저 (D♯3–F3)', '중고 (F♯3–G♯3)', '높음 (A3–B3)']);
    expect(rows.map((r) => r.r.n)).toEqual([2, 2, 1, 2]);
  });
});

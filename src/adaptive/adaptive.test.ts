import { describe, expect, it } from 'vitest';
import { BlockSchedule, WeaknessModel } from './model';
import { analyze } from './stats';
import { buildQuestion, type Question } from '../session/question';
import { DEFAULTS } from '../settings';
import { pc } from '../music/theory';
import type { TrialRec } from '../data/db';

function record(q: Question, answer: number[], i: number, latencyMs = 1500): TrialRec {
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
    tInputs: answer.map((_, k) => t0 + 3000 + k * q.noteDur * 1000 + latencyMs),
    tSubmit: t0 + 3000 + latencyMs,
    rtMs: latencyMs - 1000,
    sincePrevMs: 10_000,
    replays: 0,
    contextReplays: 0,
    probes: 0,
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
    expect(a.weak[0].key).toMatch(/:(4|5)\b/);
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

import { describe, expect, it } from 'vitest';
import { resolutionPath, pc, inScale, TONIC_TRIAD } from './theory';
import { rankKeys, pcWeights } from './keyfinder';
import { generateMelody, transitionOk, keyStats } from './melody';
import { makeContext } from './context';

describe('theory', () => {
  it('resolves degrees stepwise to the nearest tonic', () => {
    expect(resolutionPath(9, 'major')).toEqual([9, 11, 12]);
    expect(resolutionPath(5, 'major')).toEqual([5, 4, 2, 0]);
    expect(resolutionPath(6, 'major')).toEqual([6, 7, 9, 11, 12]);
    expect(resolutionPath(1, 'major')).toEqual([1, 0]);
    expect(resolutionPath(8, 'major')).toEqual([8, 7, 5, 4, 2, 0]);
    expect(resolutionPath(14, 'major')).toEqual([14, 12]);
  });
});

describe('key finder', () => {
  it('finds C major from a C major scale', () => {
    const w = pcWeights([0, 2, 4, 5, 7, 9, 11, 0].map((semi) => ({ semi, dur: 1 })));
    expect(rankKeys(w)[0]).toMatchObject({ tonic: 0, mode: 'major' });
  });
  it('finds A minor from an A harmonic minor line', () => {
    const w = pcWeights([9, 11, 0, 2, 4, 5, 8, 9, 4, 9].map((semi) => ({ semi, dur: 1 })));
    expect(rankKeys(w)[0]).toMatchObject({ tonic: 9, mode: 'minor' });
  });
});

describe('melody generator', () => {
  it('blocks ♯4→5 tonicization but allows 7→1', () => {
    expect(transitionOk(6, 7, 'major')).toBe(false);
    expect(transitionOk(11, 12, 'minor')).toBe(true);
    expect(transitionOk(1, 0, 'major')).toBe(true);
  });

  for (const mode of ['major', 'minor'] as const) {
    for (const length of [3, 5, 8]) {
      it(`${mode} length ${length}: starts/ends on tonic triad, stays in key`, () => {
        const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        let attempts = 0;
        for (let i = 0; i < 40; i++) {
          const m = generateMelody({ mode, length, pool });
          attempts += m.attempts;
          expect(m.semis).toHaveLength(length);
          expect(TONIC_TRIAD[mode]).toContain(pc(m.semis[0]));
          expect(TONIC_TRIAD[mode]).toContain(pc(m.semis[length - 1]));
          for (let j = 1; j < length; j++) expect(transitionOk(m.semis[j - 1], m.semis[j], mode)).toBe(true);
          const k = keyStats(m.semis, mode);
          expect(k.combinedRank).toBe(0);
        }
        expect(attempts / 40).toBeLessThan(60);
      });
    }
  }

  it('respects a diatonic-only pool', () => {
    for (let i = 0; i < 30; i++) {
      const m = generateMelody({ mode: 'major', length: 6, pool: [0, 2, 4, 5, 7, 9, 11] });
      expect(m.semis.every((s) => inScale(s, 'major'))).toBe(true);
    }
  });
});

describe('context pool', () => {
  it('produces phrases of every kind', () => {
    for (const kind of ['cadence', 'drone', 'scale', 'arpeggio'] as const) {
      for (const mode of ['major', 'minor'] as const) {
        const c = makeContext(mode, [kind]);
        expect(c.kind).toBe(kind);
        expect(c.events.length).toBeGreaterThan(0);
        expect(c.length).toBeGreaterThan(1);
      }
    }
  });
  it('cadence key is clear', () => {
    for (let i = 0; i < 30; i++) {
      const c = makeContext('major', ['cadence']);
      expect(rankKeys(pcWeights(c.events))[0]).toMatchObject({ tonic: 0, mode: 'major' });
    }
  });
});

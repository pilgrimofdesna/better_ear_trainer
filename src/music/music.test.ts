import { describe, expect, it } from 'vitest';
import { type Mode, resolutionPath, pc, inScale, SCALES, TONIC_TRIAD } from './theory';
import { rankKeys, pcWeights } from './keyfinder';
import { generateMelody, transitionOk, keyStats, resolutionSteps } from './melody';
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

/** Tones a line must start and end on: the pool's tonic-chord tones, else its scale tones, else any. */
function homeTones(pool: number[], mode: Mode): number[] {
  const triad = pool.filter((p) => TONIC_TRIAD[mode].includes(p));
  const scale = pool.filter((p) => inScale(p, mode));
  return triad.length ? triad : scale.length ? scale : pool;
}

/** Does the pool hold a scale tone that chromatic `p` can reach by a move transitionOk allows? */
const strictlyResolvable = (p: number, pool: number[], mode: Mode) =>
  [-2, -1, 1, 2].some((d) => pool.includes(pc(p + d)) && transitionOk(p, p + d, mode));

function randomPool(): number[] {
  const density = 0.1 + Math.random() * 0.5;
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(() => Math.random() < density);
  return pool.length ? pool : [Math.floor(Math.random() * 12)];
}

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
        const n = 100;
        let attempts = 0;
        let inKey = 0;
        for (let i = 0; i < n; i++) {
          const m = generateMelody({ mode, length, pool });
          attempts += m.attempts;
          expect(m.semis).toHaveLength(length);
          expect(TONIC_TRIAD[mode]).toContain(pc(m.semis[0]));
          expect(TONIC_TRIAD[mode]).toContain(pc(m.semis[length - 1]));
          for (let j = 1; j < length; j++) expect(transitionOk(m.semis[j - 1], m.semis[j], mode)).toBe(true);
          const k = keyStats(m.semis, mode);
          if (k.combinedRank === 0) inKey++;
          // only a line carrying a required chromatic degree may lose the melody-only key check
          // (do–fi–mi is too short for K-S to confirm C major, but the played context does)
          else expect(m.semis.some((s) => !inScale(s, mode))).toBe(true);
        }
        expect(inKey / n).toBeGreaterThan(0.75);
        expect(attempts / n).toBeLessThan(60);
      });
    }
  }

  it('respects a diatonic-only pool', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (let i = 0; i < 30; i++) {
        const m = generateMelody({ mode, length: 6, pool: [...SCALES[mode]] });
        expect(m.semis.every((s) => inScale(s, mode))).toBe(true);
      }
    }
  });

  it('picks pool-aware resolutions for chromatic degrees', () => {
    expect(resolutionSteps(6, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'major')).toEqual([-2, -1]);
    expect(resolutionSteps(11, [0, 11], 'minor')).toEqual([1]); // leading tone into the tonic
    expect(resolutionSteps(6, [0, 6, 7], 'major')).toEqual([1]); // ♯4→5 when 3 and 4 are missing
    expect(resolutionSteps(3, [0, 3, 7], 'major')).toEqual([-3]); // ♭3→1 when 2 and 4 are missing
    expect(resolutionSteps(6, [0, 6], 'major')).toEqual([-6, 6]);
    expect(resolutionSteps(6, [1, 6], 'major')).toEqual([]); // no scale tone at all
  });

  for (const mode of ['major', 'minor'] as const) {
    it(`${mode}: any custom pool yields answerable lines at every length`, () => {
      const pools = [
        [2, 5, 9, 11],
        [2, 5, 11],
        [2, 5, 8, 10],
        [1, 3, 6, 8, 10],
        [1, 4, 6, 9, 11],
        [0, 6, 7],
        [0, 3, 7],
        [0, 3, 6, 7],
        [0, 6],
        [2, 6],
        [0],
        [6],
        [1, 6],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        ...Array.from({ length: 70 }, randomPool),
      ];
      for (const pool of pools) {
        const home = homeTones(pool, mode);
        const hasScale = pool.some((p) => inScale(p, mode));
        for (let length = 2; length <= 8; length++) {
          const m = generateMelody({ mode, length, pool });
          const s = m.semis;
          expect(s).toHaveLength(length);
          for (const x of s) expect(pool).toContain(pc(x));
          expect(home).toContain(pc(s[0]));
          expect(home).toContain(pc(s[length - 1]));
          for (let j = 1; j < length; j++) {
            const [a, b] = [s[j - 1], s[j]];
            expect(Math.abs(b - a)).toBeLessThanOrEqual(7);
            if (!hasScale || inScale(a, mode)) continue;
            // a chromatic note always moves to a scale tone, by the strict rule whenever the
            // pool allows it, otherwise to the nearest scale tone the pool has
            expect(inScale(b, mode)).toBe(true);
            if (strictlyResolvable(a, pool, mode)) expect(transitionOk(a, b, mode)).toBe(true);
            else expect(Math.abs(b - a)).toBeLessThanOrEqual(6);
          }
        }
      }
    }, 30000);
  }

  it('a custom set without tonic-chord tones never falls back to an all-tonic line', () => {
    for (const [mode, pool] of [
      ['major', [2, 5, 9, 11]],
      ['minor', [2, 5, 8, 10]],
    ] as const) {
      for (const length of [5, 6, 8]) {
        for (let i = 0; i < 20; i++) {
          const m = generateMelody({ mode, length, pool: [...pool] });
          expect(m.semis.every((x) => (pool as readonly number[]).includes(pc(x)))).toBe(true);
          expect(new Set(m.semis.map(pc)).size).toBeGreaterThan(1);
        }
      }
    }
  });

  for (const [mode, pool, chromatic] of [
    ['major', [0, 6, 7], 6],
    ['major', [0, 3, 7], 3],
    ['minor', [0, 3, 6, 7], 6],
    ['major', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 3],
  ] as const) {
    it(`${mode} [${pool}]: the chromatic degree ${chromatic} is actually asked`, () => {
      for (let length = 3; length <= 8; length++) {
        const n = 400;
        let hits = 0;
        for (let i = 0; i < n; i++) {
          const m = generateMelody({ mode, length, pool: [...pool] });
          if (m.semis.some((x) => pc(x) === chromatic)) hits++;
        }
        // every chromatic pool degree that fits the length is required in 1/|pool| of the lines
        const canFit = !(pool.length === 12 && length === 3); // ♭3 cannot resolve onto 1/3/5 in one step
        if (canFit) expect(hits / n).toBeGreaterThan(0.5 / pool.length);
      }
    }, 30000);
  }
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
  it('minor i–VII–VI–V–i bass walks down 1–♭7–♭6–5, then up to 1', () => {
    let found = 0;
    for (let i = 0; i < 400 && found < 5; i++) {
      const c = makeContext('minor', ['cadence']);
      if (c.label !== 'i–VII–VI–V–i') continue;
      found++;
      const onsets = [...new Set(c.events.map((e) => e.t))].sort((a, b) => a - b);
      const bass = onsets.map((t) => Math.min(...c.events.filter((e) => e.t === t).map((e) => e.semi)));
      expect(bass.map(pc)).toEqual([0, 10, 8, 7, 0]);
      for (let j = 1; j < 4; j++) expect(bass[j]).toBeLessThan(bass[j - 1]);
      expect(bass[4] - bass[3]).toBe(5);
      expect(Math.min(...bass)).toBeGreaterThanOrEqual(-17);
    }
    expect(found).toBeGreaterThan(0);
  });
  it('cadence bass stays in its register and never leaps a 7th', () => {
    for (const mode of ['major', 'minor'] as const) {
      for (let i = 0; i < 60; i++) {
        const c = makeContext(mode, ['cadence']);
        const onsets = [...new Set(c.events.map((e) => e.t))].sort((a, b) => a - b);
        const bass = onsets.map((t) => Math.min(...c.events.filter((e) => e.t === t).map((e) => e.semi)));
        for (const b of bass) expect(b >= -17 && b <= -5).toBe(true);
        for (let j = 1; j < bass.length; j++) expect(Math.abs(bass[j] - bass[j - 1])).toBeLessThanOrEqual(9);
      }
    }
  });
});

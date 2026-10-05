import { describe, expect, it } from 'vitest';
import { keyLayout } from './DegreePad';
import { MODE_DEGREE_LABELS, SCALES } from '../music/theory';

describe('answer pad follows the mode', () => {
  it('puts the seven scale tones on the bottom row in order', () => {
    for (const mode of ['major', 'minor'] as const) {
      const l = keyLayout(mode);
      expect(SCALES[mode].map((p) => l[p])).toEqual(SCALES[mode].map((_, i) => ({ col: 2 * i + 1, acc: false })));
      expect(SCALES[mode].map((p) => MODE_DEGREE_LABELS[mode][p])).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    }
  });
  it('puts each other tone just right of the scale tone below it', () => {
    const minor = keyLayout('minor');
    expect(minor[4]).toEqual({ col: 6, acc: true }); // ♯3 between 3 and 4
    expect(minor[11]).toEqual({ col: 14, acc: true }); // ♯7 after 7
    const major = keyLayout('major');
    expect(major[6]).toEqual({ col: 8, acc: true }); // ♯4 between 4 and 5
    expect(major[1]).toEqual({ col: 2, acc: true });
  });
});

import { labelFor } from '../music/theory';
describe('naming systems', () => {
  it('names minor degrees in each system', () => {
    // C minor (tonicPc 0): 1, ♭3 and the raised 7th
    const names = (kind: Parameters<typeof labelFor>[0]) => [0, 3, 11].map((p) => labelFor(kind, p, 'minor', 0));
    expect(names('degree')).toEqual(['1', '3', '♯7']);
    expect(names('do')).toEqual(['do', 'me', 'ti']);
    expect(names('la')).toEqual(['la', 'do', 'si']);
    expect(names('movable0')).toEqual(['0', '3', '11']);
    expect([0, 3, 11].map((p) => labelFor('note', p, 'minor', 9))).toEqual(['A', 'C', 'G♯']); // A minor
    expect(labelFor('fixed0', 3, 'minor', 9)).toBe('0');
  });
});

describe('note spelling', () => {
  it('spells from the key', () => {
    const scale = (mode: 'major' | 'minor', t: number, pcs: number[]) => pcs.map((p) => labelFor('note', p, mode, t)).join(' ');
    expect(scale('major', 6, [0, 2, 4, 5, 7, 9, 11])).toBe('F♯ G♯ A♯ B C♯ D♯ E♯');
    expect(scale('major', 3, [0, 2, 4, 5, 7, 9, 11])).toBe('E♭ F G A♭ B♭ C D');
    expect(scale('minor', 2, [0, 2, 3, 5, 7, 8, 10, 11])).toBe('D E F G A B♭ C C♯');
  });
});

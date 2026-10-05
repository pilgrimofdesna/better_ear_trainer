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

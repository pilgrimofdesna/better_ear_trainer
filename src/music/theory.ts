// Scale degrees are semitone offsets from the tonic (0..11). Everything is 12-TET.

export type Mode = 'major' | 'minor';

export const DEGREE_LABELS = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7'] as const;
export const SOLFEGE = ['do', 'ra', 're', 'me', 'mi', 'fa', 'fi', 'sol', 'le', 'la', 'te', 'ti'] as const;
export const SOLFEGE_KO = ['도', '라♭', '레', '미♭', '미', '파', '파♯', '솔', '라♭', '라', '시♭', '시'] as const;

export const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  // natural minor; the harmonic-minor leading tone appears only in context chords (V)
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const TONIC_TRIAD: Record<Mode, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
};

export const pc = (semi: number) => ((semi % 12) + 12) % 12;

export const degreeLabel = (semi: number) => DEGREE_LABELS[pc(semi)];

export const inScale = (semi: number, mode: Mode) => SCALES[mode].includes(pc(semi));

/** Frequency of a note `semi` semitones above a tonic at `tonicHz`. */
export const freqOf = (tonicHz: number, semi: number) => tonicHz * Math.pow(2, semi / 12);

export const midiToHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export type DegreePreset = 'triad' | 'diatonic' | 'chromatic' | 'custom';

export function presetDegrees(preset: DegreePreset, mode: Mode, custom: number[] = []): number[] {
  switch (preset) {
    case 'triad':
      return [...TONIC_TRIAD[mode]];
    case 'diatonic':
      return [...SCALES[mode]];
    case 'chromatic':
      return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    case 'custom':
      return custom.length ? [...custom].sort((a, b) => a - b) : [...SCALES[mode]];
  }
}

/**
 * Stepwise path from a degree to the nearest tonic, used as feedback
 * (e.g. 6 -> 7 -> 1). 1-4 and ♭6 resolve down, ♯4, 5, 6, ♭7, 7 resolve up. Chromatic notes first
 * move by semitone to the neighbouring scale tone in that direction.
 */
export function resolutionPath(semi: number, mode: Mode): number[] {
  const scale = SCALES[mode];
  const p = pc(semi);
  const base = semi - p; // octave floor of the given note
  if (p === 0) return [semi];
  const up = p === 6 || (p >= 7 && p !== 8); // ♭6 leans down onto 5
  const path = [semi];
  let cur = p;
  while (cur !== 0 && cur !== 12) {
    if (up) {
      const next = [...scale, 12].find((s) => s > cur)!;
      cur = scale.includes(cur) || cur === 6 ? next : Math.min(next, cur + 1);
    } else {
      const lower = [...scale].reverse().find((s) => s < cur)!;
      cur = scale.includes(cur) ? lower : Math.max(lower, cur - 1);
    }
    path.push(base + cur);
  }
  return path;
}

export const rand = (n: number) => Math.floor(Math.random() * n);
export const pick = <T,>(arr: readonly T[]): T => arr[rand(arr.length)];
export const uniform = (a: number, b: number) => a + Math.random() * (b - a);
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

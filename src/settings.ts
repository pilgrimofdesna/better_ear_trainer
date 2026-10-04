import { signal, effect } from '@preact/signals';
import type { DegreePreset, Mode } from './music/theory';
import type { TimbreId } from './audio/timbres';
import type { ContextKind } from './music/context';

export interface ExerciseSettings {
  preset: DegreePreset;
  custom: number[];
  modes: Mode[];
}

export interface Settings {
  single: ExerciseSettings & { octaves: number[]; drone: boolean };
  dictation: ExerciseSettings & { length: number; maxLeap: number; firstHint: boolean };
  contextEvery: number; // play context before every Nth question (1 = always)
  contextKinds: ContextKind[];
  timbres: TimbreId[];
  detune: boolean; // ±50 cent continuous reference offset
  labels: 'number' | 'solfege' | 'both';
  autoNext: boolean;
  volume: number;
}

export const DEFAULTS: Settings = {
  single: { preset: 'diatonic', custom: [], modes: ['major'], octaves: [-1, 0, 1], drone: false },
  dictation: { preset: 'diatonic', custom: [], modes: ['major'], length: 4, maxLeap: 7, firstHint: false },
  contextEvery: 1,
  contextKinds: ['cadence', 'drone', 'scale', 'arpeggio'],
  timbres: ['glass', 'epiano', 'musicbox', 'harp', 'flute'],
  detune: true,
  labels: 'both',
  autoNext: true,
  volume: 0.9,
};

const KEY = 'stellar-ear.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        ...DEFAULTS,
        ...s,
        single: { ...DEFAULTS.single, ...s.single },
        dictation: { ...DEFAULTS.dictation, ...s.dictation },
      };
    }
  } catch {
    /* private mode or corrupt: use defaults */
  }
  return structuredClone(DEFAULTS);
}

export const settings = signal<Settings>(load());

effect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.value));
  } catch {
    /* ignore */
  }
});

export function patch(fn: (s: Settings) => void) {
  const next = structuredClone(settings.value);
  fn(next);
  settings.value = next;
}

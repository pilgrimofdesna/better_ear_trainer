// Key-establishing context pool: cadences, drones, scales, arpeggios, with randomized
// voicing, register, top note and tempo, so no single fixed cadence becomes a shortcut.
import { type Mode, SCALES, TONIC_TRIAD, pick, rand, uniform } from './theory';

export interface NoteEvent {
  semi: number; // semitones from the tonic (may be negative)
  t: number; // start, seconds from the beginning of the phrase
  dur: number;
  vel: number; // 0..1
  sustain?: boolean; // drone-style sustained voice
}

export type ContextKind = 'cadence' | 'drone' | 'scale' | 'arpeggio';

export interface ContextPhrase {
  kind: ContextKind;
  label: string; // e.g. "I–IV–V–I"
  events: NoteEvent[];
  length: number; // seconds until the question may start
  topNote?: number; // top voice of the last chord (semi)
}

const CHORDS: Record<Mode, Record<string, number[]>> = {
  major: { I: [0, 4, 7], ii: [2, 5, 9], iii: [4, 7, 11], IV: [5, 9, 12], V: [7, 11, 14], vi: [9, 12, 16] },
  minor: { i: [0, 3, 7], iv: [5, 8, 12], V: [7, 11, 14], VI: [8, 12, 15], III: [3, 7, 10], VII: [10, 14, 17] },
};

const PROGRESSIONS: Record<Mode, string[][]> = {
  major: [
    ['I', 'IV', 'V', 'I'],
    ['I', 'ii', 'V', 'I'],
    ['I', 'vi', 'IV', 'V', 'I'],
    ['I', 'IV', 'I'],
    ['I', 'vi', 'ii', 'V', 'I'],
    ['IV', 'V', 'I'],
  ],
  minor: [
    ['i', 'iv', 'V', 'i'],
    ['i', 'VI', 'iv', 'V', 'i'],
    ['i', 'iv', 'i'],
    ['i', 'VII', 'VI', 'V', 'i'],
    ['iv', 'V', 'i'],
  ],
};

/** All close-position voicings (3 upper voices) of a chord within [lo, hi]. */
function voicings(chord: number[], lo: number, hi: number): number[][] {
  const pcs = chord.map((s) => ((s % 12) + 12) % 12);
  const out: number[][] = [];
  for (let bottom = lo; bottom <= hi; bottom++) {
    if (!pcs.includes(((bottom % 12) + 12) % 12)) continue;
    const v = [bottom];
    let cur = bottom;
    while (v.length < 3) {
      cur++;
      if (pcs.includes(((cur % 12) + 12) % 12) && !v.some((x) => (x - cur) % 12 === 0)) v.push(cur);
    }
    if (v[2] <= hi) out.push(v);
  }
  return out;
}

const moveCost = (a: number[], b: number[]) => a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0);

function cadence(mode: Mode): ContextPhrase {
  const prog = pick(PROGRESSIONS[mode]);
  const beat = uniform(0.55, 0.8);
  const lo = rand(5) - 3; // register of the upper voices shifts per question
  const hi = lo + 17;
  const events: NoteEvent[] = [];
  // final chord: random top note (any tonic-chord tone), then voice-lead backwards
  const finals = voicings(CHORDS[mode][prog[prog.length - 1]], lo, hi);
  let next = pick(finals);
  const voiced: number[][] = [next];
  for (let i = prog.length - 2; i >= 0; i--) {
    const cands = voicings(CHORDS[mode][prog[i]], lo, hi);
    cands.sort((a, b) => moveCost(a, next) - moveCost(b, next) + (Math.random() - 0.5) * 3);
    next = cands[0];
    voiced.unshift(next);
  }
  let bass = 0;
  prog.forEach((name, i) => {
    const root = ((CHORDS[mode][name][0] % 12) + 12) % 12;
    if (i === 0) bass = root - 12 > -5 ? root - 24 : root - 12;
    else {
      // the octave in [-17, -5] nearest the previous bass note, so a stepwise bass keeps its
      // direction (i–VII–VI–V–i walks down 1–♭7–♭6–5 instead of leaping up a 7th to V)
      const prev = bass;
      bass = [root - 24, root - 12]
        .filter((b) => b >= -17 && b <= -5)
        .reduce((a, b) => (Math.abs(b - prev) < Math.abs(a - prev) ? b : a));
    }
    const t = i * beat;
    const last = i === prog.length - 1;
    const dur = last ? beat * 2 : beat * 0.95;
    events.push({ semi: bass, t, dur, vel: 0.55 });
    for (const s of voiced[i]) events.push({ semi: s, t, dur, vel: 0.42 });
  });
  const final = voiced[voiced.length - 1];
  return {
    kind: 'cadence',
    label: prog.join('–'),
    events,
    length: prog.length * beat + beat * 1.4,
    topNote: final[final.length - 1],
  };
}

function drone(): ContextPhrase {
  const octave = pick([-12, 0]);
  const len = uniform(1.8, 2.6);
  return {
    kind: 'drone',
    label: '토닉 드론',
    events: [
      // tonic, fifth and octave; nothing below the tonic octave (inaudible on a phone speaker)
      { semi: octave, t: 0, dur: len, vel: 0.4, sustain: true },
      { semi: octave + 7, t: 0.15, dur: len - 0.15, vel: 0.25, sustain: true },
      { semi: octave + 12, t: 0, dur: len, vel: 0.28, sustain: true },
    ],
    length: len + 0.3,
  };
}

function scale(mode: Mode): ContextPhrase {
  const sc = [...SCALES[mode], 12];
  const down = Math.random() < 0.5;
  const notes = down ? [...sc].reverse() : sc;
  const step = uniform(0.2, 0.3);
  const shift = pick([-12, 0]);
  const events = notes.map((s, i) => ({ semi: s + shift, t: i * step, dur: step * 1.1, vel: 0.5 }));
  // always land on the tonic
  if (!down) events.push({ semi: shift, t: notes.length * step + step, dur: step * 3, vel: 0.5 });
  else events[events.length - 1].dur = step * 3;
  const end = events[events.length - 1];
  return { kind: 'scale', label: down ? '스케일 하행' : '스케일 상행', events, length: end.t + end.dur + 0.4 };
}

function arpeggio(mode: Mode): ContextPhrase {
  const [r, th, f] = TONIC_TRIAD[mode];
  const shift = pick([-12, 0]);
  const shape = pick([
    [r, th, f, 12, f, th, r],
    [r, th, f, 12],
    [12, f, th, r],
  ]);
  const step = uniform(0.22, 0.32);
  const events = shape.map((s, i) => ({ semi: s + shift, t: i * step, dur: step * 1.2, vel: 0.5 }));
  events[events.length - 1].dur = step * 3;
  const end = events[events.length - 1];
  return { kind: 'arpeggio', label: '토닉 아르페지오', events, length: end.t + end.dur + 0.4 };
}

export function makeContext(mode: Mode, kinds: ContextKind[]): ContextPhrase {
  const kind = pick(kinds.length ? kinds : (['cadence'] as ContextKind[]));
  switch (kind) {
    case 'cadence':
      return cadence(mode);
    case 'drone':
      return drone();
    case 'scale':
      return scale(mode);
    case 'arpeggio':
      return arpeggio(mode);
  }
}

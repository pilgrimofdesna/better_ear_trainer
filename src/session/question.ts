// Builds one question: continuous reference pitch, random register/timbre/context,
// and the target chosen randomly or toward a weak pattern.
import { type Mode, pc, pick, presetDegrees, uniform, midiToHz, rand } from '../music/theory';
import { makeContext, type ContextPhrase } from '../music/context';
import { generateMelody, generateMelodyBiased } from '../music/melody';
import { type Slot, type WeaknessModel, singlePatterns, dictationPatterns } from '../adaptive/model';
import type { TimbreId } from '../audio/timbres';
import type { Exercise } from '../data/db';
import type { Settings } from '../settings';

export interface Reference {
  mode: Mode;
  tonicPc: number;
  detuneCents: number;
  tonicHz: number;
}

export interface Question extends Reference {
  exercise: Exercise;
  slot: Slot;
  context: ContextPhrase | null;
  contextTimbre: TimbreId;
  timbre: TimbreId;
  drone: boolean;
  target: number[];
  registerOctave: number;
  noteDur: number;
  choiceSet: number[];
  degreePool: number[];
  biasPattern?: string;
  patterns: string[];
  melodyKeyRank?: number;
  melodyAttempts?: number;
}

export function newReference(modes: Mode[], detune: boolean): Reference {
  const tonicPc = rand(12);
  const detuneCents = detune ? uniform(-50, 50) : 0;
  // tonic lives between about B2 and C4; the target register is randomized separately
  const tonicHz = midiToHz(48 + tonicPc + detuneCents / 100);
  return { mode: pick(modes.length ? modes : (['major'] as Mode[])), tonicPc, detuneCents, tonicHz };
}

export interface BuildArgs {
  exercise: Exercise;
  s: Settings;
  slot: Slot;
  model: WeaknessModel;
  index: number; // question index in the session
  prevRef: Reference | null;
  prevTargetPc: number | null;
}

export function buildQuestion(a: BuildArgs): Question {
  const { s, slot, model } = a;
  const ex = a.exercise === 'single' ? s.single : s.dictation;
  const withContext = !a.prevRef || a.index % Math.max(1, s.contextEvery) === 0;
  const ref = withContext ? newReference(ex.modes, s.detune) : a.prevRef!;
  const pool = presetDegrees(ex.preset, ref.mode, ex.custom);
  const timbres: TimbreId[] = s.timbres.length ? s.timbres : ['glass'];
  let timbre = pick(timbres);
  const contextTimbre = pick(timbres);
  const context = withContext ? makeContext(ref.mode, s.contextKinds) : null;

  if (a.exercise === 'single') {
    const octaves = s.single.octaves.length ? s.single.octaves : [0];
    let targetPc = pick(pool);
    let oct = pick(octaves);
    let biasPattern: string | undefined;
    if (slot.selection === 'biased') {
      const cands: string[] = [];
      for (const p of pool) {
        cands.push(`deg:${p}`);
        for (const o of octaves) cands.push(`reg:${p}@${o}`);
        for (const t of timbres) cands.push(`tim:${p}@${t}`);
        if (a.prevTargetPc !== null) cands.push(`trans:${a.prevTargetPc}>${p}`);
      }
      biasPattern = model.pick(cands);
      const [kind, body] = biasPattern.split(':');
      if (kind === 'deg') targetPc = +body;
      if (kind === 'reg') [targetPc, oct] = body.split('@').map(Number);
      if (kind === 'tim') {
        const [p, t] = body.split('@');
        targetPc = +p;
        timbre = t as TimbreId;
      }
      if (kind === 'trans') targetPc = +body.split('>')[1];
    }
    const target = [targetPc + 12 * oct];
    const q: Question = {
      ...ref,
      exercise: 'single',
      slot,
      context,
      contextTimbre,
      timbre,
      drone: s.single.drone,
      target,
      registerOctave: oct,
      noteDur: uniform(0.9, 1.3),
      choiceSet: pool,
      degreePool: pool,
      biasPattern,
      patterns: [],
    };
    q.patterns = singlePatterns(q, a.prevTargetPc);
    return q;
  }

  const length = s.dictation.length;
  const opts = { mode: ref.mode, length, pool, maxLeap: s.dictation.maxLeap };
  let melody;
  let biasPattern: string | undefined;
  if (slot.selection === 'biased') {
    // one Thompson draw per pattern, then the candidate melody that covers the weakest ones
    const draws = new Map<string, number>();
    const draw = (k: string) => {
      if (!draws.has(k)) draws.set(k, model.evidence(k) > 0.5 ? model.sample(k) : 0.2);
      return draws.get(k)!;
    };
    melody = generateMelodyBiased(opts, (semis) => {
      const ks = dictationPatterns(semis);
      const v = ks.map(draw);
      return Math.max(...v) + v.reduce((x, y) => x + y, 0) / v.length;
    });
    const ks = dictationPatterns(melody.semis);
    biasPattern = ks.reduce((b, k) => (draw(k) > draw(b) ? k : b), ks[0]);
  } else {
    melody = generateMelody(opts);
  }
  return {
    ...ref,
    exercise: 'dictation',
    slot,
    context,
    contextTimbre,
    timbre,
    drone: false,
    target: melody.semis,
    registerOctave: Math.floor(melody.semis[0] / 12),
    noteDur: uniform(0.45, 0.7),
    choiceSet: pool,
    degreePool: pool,
    biasPattern,
    patterns: dictationPatterns(melody.semis),
    melodyKeyRank: melody.keyRank,
    melodyAttempts: melody.attempts,
  };
}

export const firstPc = (q: Question) => pc(q.target[0]);

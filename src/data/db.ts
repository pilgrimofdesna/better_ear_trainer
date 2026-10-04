// Append-only training log in IndexedDB. Records are never edited or deleted;
// old trials can be packed into gzip archives inside the same database.
import Dexie, { type Table } from 'dexie';
import type { Mode } from '../music/theory';
import type { TimbreId } from '../audio/timbres';
import type { ContextKind } from '../music/context';

export const APP_VERSION = '0.1.0';

export type Exercise = 'single' | 'dictation';
export type Selection = 'random' | 'biased';

export interface SessionRec {
  id?: number;
  startedAt: number;
  endedAt?: number;
  exercise: Exercise;
  settings: unknown; // full snapshot of the settings used
  appVersion: string;
  userAgent: string;
}

export interface TrialRec {
  id?: number;
  sessionId: number;
  exercise: Exercise;
  index: number; // within session
  // ---- question setup (degrees of freedom) ----
  mode: Mode;
  choiceSet: number[]; // answer buttons offered (pitch classes)
  degreePool: number[]; // pitch classes the question could use
  contextPlayed: boolean;
  contextKind?: ContextKind;
  contextLabel?: string;
  contextTopNote?: number;
  drone: boolean;
  tonicPc: number; // 0 = C
  detuneCents: number; // real-valued offset of the whole reference
  tonicHz: number;
  timbre: TimbreId;
  contextTimbre: TimbreId;
  noteDur: number; // seconds per note
  // ---- question ----
  target: number[]; // semitones from the tonic, with octave
  registerOctave: number; // octave of the (first) target relative to the tonic
  // ---- selection (hidden from the user) ----
  selection: Selection;
  blockPos: number; // 0..3 inside the 4-question block
  pairPos: number; // 0 = first of its same-mode pair, 1 = second ("clean")
  biasPattern?: string;
  patterns: string[]; // pattern keys this trial exercises
  // ---- response ----
  answer: number[]; // pitch classes, one per target note
  correct: boolean[];
  allCorrect: boolean;
  // ---- timing (epoch ms) ----
  tPresented: number;
  tAudioStart: number;
  tAudioEnd: number;
  tInputs: number[];
  tSubmit: number;
  rtMs: number; // submit - end of the question audio (negative if answered while it played)
  sincePrevMs: number | null; // since the previous trial's submit in this session
  replays: number;
  contextReplays: number;
  probes: number; // buttons auditioned after answering
  melodyKeyRank?: number;
  melodyAttempts?: number;
}

export interface ArchiveRec {
  id?: number;
  fromTrialId: number;
  toTrialId: number;
  count: number;
  createdAt: number;
  data: Blob; // gzip(JSONL of TrialRec)
}

class StellarDB extends Dexie {
  sessions!: Table<SessionRec, number>;
  trials!: Table<TrialRec, number>;
  archives!: Table<ArchiveRec, number>;
  constructor() {
    super('stellar-ear');
    this.version(1).stores({
      sessions: '++id, startedAt, exercise',
      trials: '++id, sessionId, exercise, tSubmit',
      archives: '++id, fromTrialId',
    });
  }
}

export const db = new StellarDB();

export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function startSession(exercise: Exercise, settings: unknown): Promise<number> {
  return db.sessions.add({
    startedAt: Date.now(),
    exercise,
    settings: JSON.parse(JSON.stringify(settings)),
    appVersion: APP_VERSION,
    userAgent: navigator.userAgent,
  });
}

export async function endSession(id: number) {
  await db.sessions.update(id, { endedAt: Date.now() });
}

export const addTrial = (t: TrialRec) => db.trials.add(t);

// ---------- compression ----------

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function gunzip(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Pack all but the most recent `keep` trials into one gzip archive. Nothing is lost. */
export async function archiveOldTrials(keep = 5000): Promise<number> {
  const count = await db.trials.count();
  if (count <= keep) return 0;
  const old = await db.trials.orderBy('id').limit(count - keep).toArray();
  const data = await gzip(old.map((t) => JSON.stringify(t)).join('\n'));
  await db.transaction('rw', db.trials, db.archives, async () => {
    await db.archives.add({
      fromTrialId: old[0].id!,
      toTrialId: old[old.length - 1].id!,
      count: old.length,
      createdAt: Date.now(),
      data,
    });
    await db.trials.bulkDelete(old.map((t) => t.id!));
  });
  return old.length;
}

/** Every trial ever recorded, archived ones included, oldest first. */
export async function allTrials(): Promise<TrialRec[]> {
  const out: TrialRec[] = [];
  for (const a of await db.archives.orderBy('fromTrialId').toArray()) {
    const text = await gunzip(a.data);
    for (const line of text.split('\n')) if (line) out.push(JSON.parse(line));
  }
  out.push(...(await db.trials.orderBy('id').toArray()));
  return out;
}

/** Full backup as gzip JSONL: one line per session and per trial. */
export async function exportBackup(): Promise<Blob> {
  const sessions = await db.sessions.toArray();
  const trials = await allTrials();
  const lines = [
    JSON.stringify({ type: 'meta', app: 'stellar-ear', version: APP_VERSION, exportedAt: Date.now() }),
    ...sessions.map((s) => JSON.stringify({ type: 'session', ...s })),
    ...trials.map((t) => JSON.stringify({ type: 'trial', ...t })),
  ];
  return gzip(lines.join('\n'));
}

/** Merge a backup in; records whose id already exists are skipped. */
export async function importBackup(file: Blob): Promise<{ sessions: number; trials: number }> {
  const text = await gunzip(file);
  const sessions: SessionRec[] = [];
  const trials: TrialRec[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const { type, ...rec } = JSON.parse(line);
    if (type === 'session') sessions.push(rec);
    if (type === 'trial') trials.push(rec);
  }
  const archived = new Set((await allTrials()).map((t) => t.id));
  const haveS = new Set(await db.sessions.toCollection().primaryKeys());
  const newS = sessions.filter((s) => !haveS.has(s.id!));
  const newT = trials.filter((t) => !archived.has(t.id));
  await db.sessions.bulkAdd(newS);
  await db.trials.bulkAdd(newT);
  return { sessions: newS.length, trials: newT.length };
}

export async function storageInfo() {
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  return {
    trials: await db.trials.count(),
    archives: await db.archives.count(),
    archivedTrials: (await db.archives.toArray()).reduce((s, a) => s + a.count, 0),
    sessions: await db.sessions.count(),
    usage: est?.usage,
    persisted: (await navigator.storage?.persisted?.().catch(() => false)) ?? false,
  };
}

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
  hinted?: number[]; // indices of target notes whose answer was shown as a hint (not scored)
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
  // ---- timing (epoch ms, Date.now()) ----
  tPresented: number;
  tAudioStart: number; // first presentation of the target
  tAudioEnd: number;
  tPlays?: number[]; // target onset of every playback, the first one included
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

/** Listening after the answer, written when the user leaves the question. */
export interface FollowupRec {
  id?: number;
  trialId: number;
  sessionId: number;
  probes: number; // buttons auditioned after answering
  postReplays: number;
  postContextReplays: number;
  tLeave: number;
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
  followups!: Table<FollowupRec, number>;
  constructor() {
    super('stellar-ear');
    this.version(1).stores({
      sessions: '++id, startedAt, exercise',
      trials: '++id, sessionId, exercise, tSubmit',
      archives: '++id, fromTrialId',
    });
    this.version(2).stores({
      followups: '++id, trialId',
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

/** Resolves to the new trial's id. */
export const addTrial = (t: TrialRec) => db.trials.add(t);

/** Resolves to the new follow-up's id. */
export const addFollowup = (f: FollowupRec) => db.followups.add(f);

// Archive and import both read, work outside IndexedDB (gzip), then write.
// Running them one at a time keeps two overlapping calls (a double tap, the
// startup archive racing a tap) from acting on the same stale read.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

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
export function archiveOldTrials(keep = 5000): Promise<number> {
  return serial(async () => {
    const old = await db.transaction('r', db.trials, async (): Promise<TrialRec[]> => {
      const count = await db.trials.count();
      return count <= keep ? [] : db.trials.orderBy('id').limit(count - keep).toArray();
    });
    if (!old.length) return 0;
    const ids = old.map((t) => t.id!);
    const data = await gzip(old.map((t) => JSON.stringify(t)).join('\n'));
    return db.transaction('rw', db.trials, db.archives, async () => {
      // another tab may have archived some of these rows since we read them
      if ((await db.trials.bulkGet(ids)).some((t) => !t)) return 0;
      await db.archives.add({
        fromTrialId: ids[0],
        toTrialId: ids[ids.length - 1],
        count: old.length,
        createdAt: Date.now(),
        data,
      });
      await db.trials.bulkDelete(ids);
      return old.length;
    });
  });
}

interface Snapshot {
  sessions: SessionRec[];
  trials: TrialRec[]; // archived and live, oldest first
  followups: FollowupRec[];
}

/** One consistent read of every store. Archives are unpacked after the read
 *  transaction ends, since a Dexie transaction must not await non-Dexie work;
 *  an archive committing meanwhile then cannot hide rows from us. */
async function snapshot(): Promise<Snapshot> {
  const { arcs, live, sessions, followups } = await db.transaction(
    'r',
    [db.archives, db.trials, db.sessions, db.followups],
    async () => ({
      arcs: await db.archives.orderBy('fromTrialId').toArray(),
      live: await db.trials.toArray(),
      sessions: await db.sessions.toArray(),
      followups: await db.followups.toArray(),
    }),
  );
  // the same id twice only comes from an old double archive; count it once
  const trials: TrialRec[] = [];
  const seen = new Set<number>();
  const keep = (t: TrialRec) => {
    if (seen.has(t.id!)) return;
    seen.add(t.id!);
    trials.push(t);
  };
  for (const a of arcs) {
    const text = await gunzip(a.data);
    for (const line of text.split('\n')) if (line) keep(JSON.parse(line));
  }
  live.forEach(keep);
  return { sessions, trials: chronological(trials, sessions), followups };
}

/** Oldest first: by session start, then position in the session. Ids are not
 *  time order once a backup from another device has been merged in. */
function chronological(trials: TrialRec[], sessions: SessionRec[]): TrialRec[] {
  const start = new Map(sessions.map((s) => [s.id!, s.startedAt]));
  const at = (t: TrialRec) => start.get(t.sessionId) ?? t.tPresented;
  return trials.sort(
    (a, b) => at(a) - at(b) || a.sessionId - b.sessionId || a.index - b.index || a.tPresented - b.tPresented || a.id! - b.id!,
  );
}

/** Every trial ever recorded, archived ones included, oldest first. */
export async function allTrials(): Promise<TrialRec[]> {
  return (await snapshot()).trials;
}

export async function allFollowups(): Promise<FollowupRec[]> {
  return db.followups.toArray();
}

/** Full backup as gzip JSONL: one line per session, trial and follow-up. */
export async function exportBackup(): Promise<Blob> {
  const { sessions, trials, followups } = await snapshot();
  const lines = [
    JSON.stringify({ type: 'meta', app: 'stellar-ear', version: APP_VERSION, schema: 2, exportedAt: Date.now() }),
    ...sessions.map((s) => JSON.stringify({ type: 'session', ...s })),
    ...trials.map((t) => JSON.stringify({ type: 'trial', ...t })),
    ...followups.map((f) => JSON.stringify({ type: 'followup', ...f })),
  ];
  return gzip(lines.join('\n'));
}

// Every device numbers its records from 1, so ids say nothing about identity
// across backups. A session is identified by its start time and device, a
// trial by its session and position in it, a follow-up by its trial and time.
const sessionKey = (s: SessionRec) => `${s.startedAt}|${s.userAgent}|${s.exercise}`;
const trialKey = (sKey: string, t: TrialRec) => `${sKey}#${t.index}#${t.tPresented}`;
const followupKey = (tKey: string, f: FollowupRec) => `${tKey}@${f.tLeave}`;

function withoutId<T extends { id?: number }>(rec: T): T {
  const copy = { ...rec };
  delete copy.id;
  return copy;
}

export interface ImportResult {
  sessions: number;
  trials: number;
  followups: number;
  skipped: number; // trials or follow-ups whose session or trial is missing from the file
}

/** Merge a backup in. Records already here (from any device) are skipped; new
 *  ones get fresh ids with their session and trial links rewritten, all in one
 *  transaction so a failure leaves nothing half-imported. */
export function importBackup(file: Blob): Promise<ImportResult> {
  return serial(async () => {
    const text = await gunzip(file);
    const fileS: SessionRec[] = [];
    const fileT: TrialRec[] = [];
    const fileF: FollowupRec[] = [];
    let isBackup = false;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const { type, ...rec } = JSON.parse(line);
      if (type === 'meta') isBackup = rec.app === 'stellar-ear';
      else if (type === 'session') fileS.push(rec);
      else if (type === 'trial') fileT.push(rec);
      else if (type === 'followup') fileF.push(rec);
    }
    if (!isBackup) throw new Error('not a Stellar Ear backup');

    // what is already here, keyed by content
    const local = await snapshot();
    const sessionIds = new Map<string, number>(); // session key -> local id
    const openSessions = new Set<number>(); // local sessions with no end time
    for (const s of local.sessions) {
      const k = sessionKey(s);
      if (!sessionIds.has(k)) sessionIds.set(k, s.id!);
      if (s.endedAt === undefined) openSessions.add(s.id!);
    }
    const localSKey = new Map(local.sessions.map((s) => [s.id!, sessionKey(s)]));
    const trialIds = new Map<string, number>(); // trial key -> local id
    const localTKey = new Map<number, string>();
    for (const t of local.trials) {
      const k = trialKey(localSKey.get(t.sessionId) ?? `?${t.sessionId}`, t);
      trialIds.set(k, t.id!);
      localTKey.set(t.id!, k);
    }
    const haveF = new Set(local.followups.map((f) => followupKey(localTKey.get(f.trialId) ?? `?${f.trialId}`, f)));

    // what the file adds
    const fileSKey = new Map(fileS.map((s) => [s.id!, sessionKey(s)]));
    const newS = new Map<string, SessionRec>();
    const ended: [number, number][] = []; // local sessions the file knows the end of
    for (const s of fileS) {
      const k = sessionKey(s);
      const id = sessionIds.get(k);
      if (id === undefined) {
        if (!newS.has(k)) newS.set(k, withoutId(s));
      } else if (s.endedAt !== undefined && openSessions.has(id)) {
        ended.push([id, s.endedAt]);
        openSessions.delete(id);
      }
    }
    let skipped = 0;
    const fileTrial = new Map<number, { key: string; sKey: string }>(); // file id -> keys
    const newT: { key: string; sKey: string; rec: TrialRec }[] = [];
    const queued = new Set<string>();
    for (const t of fileT) {
      const sKey = fileSKey.get(t.sessionId);
      if (sKey === undefined) {
        skipped++;
        continue;
      }
      const key = trialKey(sKey, t);
      fileTrial.set(t.id!, { key, sKey });
      if (trialIds.has(key) || queued.has(key)) continue; // also drops duplicates inside the file
      queued.add(key);
      newT.push({ key, sKey, rec: withoutId(t) });
    }
    newT.sort((a, b) => a.rec.tSubmit - b.rec.tSubmit);
    const newF: { tKey: string; sKey: string; rec: FollowupRec }[] = [];
    for (const f of fileF) {
      const trial = fileTrial.get(f.trialId);
      if (!trial) {
        skipped++;
        continue;
      }
      const key = followupKey(trial.key, f);
      if (haveF.has(key)) continue;
      haveF.add(key);
      newF.push({ tKey: trial.key, sKey: trial.sKey, rec: withoutId(f) });
    }

    await db.transaction('rw', db.sessions, db.trials, db.followups, async () => {
      const sIds = await db.sessions.bulkAdd([...newS.values()], { allKeys: true });
      [...newS.keys()].forEach((k, i) => sessionIds.set(k, sIds[i]));
      for (const [id, endedAt] of ended) await db.sessions.update(id, { endedAt });
      const tIds = await db.trials.bulkAdd(
        newT.map(({ sKey, rec }) => ({ ...rec, sessionId: sessionIds.get(sKey)! })),
        { allKeys: true },
      );
      newT.forEach(({ key }, i) => trialIds.set(key, tIds[i]));
      await db.followups.bulkAdd(
        newF.map(({ tKey, sKey, rec }) => ({ ...rec, trialId: trialIds.get(tKey)!, sessionId: sessionIds.get(sKey)! })),
      );
    });
    return { sessions: newS.size, trials: newT.length, followups: newF.length, skipped };
  });
}

export async function storageInfo() {
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const counts = await db.transaction('r', [db.trials, db.archives, db.sessions, db.followups], async () => {
    let archivedTrials = 0;
    await db.archives.each((a) => void (archivedTrials += a.count));
    return {
      trials: await db.trials.count(),
      archives: await db.archives.count(),
      archivedTrials,
      sessions: await db.sessions.count(),
      followups: await db.followups.count(),
    };
  });
  return {
    ...counts,
    usage: est?.usage,
    persisted: (await navigator.storage?.persisted?.().catch(() => false)) ?? false,
  };
}

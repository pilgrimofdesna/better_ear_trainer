import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFollowup,
  allFollowups,
  allTrials,
  archiveOldTrials,
  db,
  exportBackup,
  importBackup,
  storageInfo,
  type SessionRec,
  type TrialRec,
} from './db';

const HOUR = 3_600_000;
const T0 = 1_780_000_000_000;

function trial(sessionId: number, index: number, startedAt: number, device: string): TrialRec {
  const tPresented = startedAt + 1000 + index * 5000;
  return {
    sessionId,
    exercise: 'single',
    index,
    mode: 'major',
    choiceSet: [0, 4, 7],
    degreePool: [0, 4, 7],
    contextPlayed: true,
    contextLabel: device, // lets the tests check which device a trial came from
    drone: false,
    tonicPc: 0,
    detuneCents: 0,
    tonicHz: 261.63,
    timbre: 'glass',
    contextTimbre: 'epiano',
    noteDur: 0.8,
    target: [4],
    registerOctave: 0,
    selection: 'random',
    blockPos: index % 4,
    pairPos: index % 2,
    patterns: ['d:4'],
    answer: [4],
    correct: [true],
    allCorrect: true,
    tPresented,
    tAudioStart: tPresented + 2000,
    tAudioEnd: tPresented + 2800,
    tInputs: [tPresented + 3500],
    tSubmit: tPresented + 3500,
    rtMs: 700,
    sincePrevMs: index ? 5000 : null,
    replays: 0,
    contextReplays: 0,
    probes: 0,
  };
}

/** `sessions` sessions of `perSession` trials each on one device, two hours apart. */
async function fill(device: string, firstStart: number, sessions: number, perSession: number) {
  for (let s = 0; s < sessions; s++) {
    const startedAt = firstStart + s * 2 * HOUR;
    const id = await db.sessions.add({
      startedAt,
      endedAt: startedAt + HOUR / 2,
      exercise: 'single',
      settings: { device },
      appVersion: '0.1.0',
      userAgent: `UA ${device}`,
    });
    await db.trials.bulkAdd(Array.from({ length: perSession }, (_, i) => trial(id, i, startedAt, device)));
  }
}

async function gzipLines(lines: object[]): Promise<Blob> {
  const text = lines.map((l) => JSON.stringify(l)).join('\n');
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

/** Every trial must sit in a session from its own device, at its original time. */
function expectLinked(trials: TrialRec[], sessions: SessionRec[]) {
  const byId = new Map(sessions.map((s) => [s.id!, s]));
  for (const t of trials) {
    const s = byId.get(t.sessionId);
    expect(s, `trial ${t.id} has no session`).toBeDefined();
    expect(s!.userAgent).toBe(`UA ${t.contextLabel}`);
    expect(t.tPresented).toBe(s!.startedAt + 1000 + t.index * 5000);
  }
}

// Node's setImmediate (no @types/node here); fake-indexeddb schedules its work on it
declare function setImmediate(cb: () => void): unknown;
const tick = () => new Promise<void>((r) => setImmediate(r));

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('importBackup', () => {
  it('merges another device: keeps every record, remaps ids, links trials to the right sessions', async () => {
    await fill('pc', T0, 3, 10);
    expect(await archiveOldTrials(12)).toBe(18); // part of the PC history is archived
    const pcBackup = await exportBackup();

    await db.delete();
    await db.open();
    await fill('phone', T0 + HOUR, 2, 15); // same ids 1.. as the PC, times interleaved
    const r = await importBackup(pcBackup);
    expect(r).toEqual({ sessions: 3, trials: 30, followups: 0, skipped: 0 });

    const sessions = await db.sessions.toArray();
    const all = await allTrials();
    expect(sessions).toHaveLength(5);
    expect(all).toHaveLength(60);
    expect(new Set(all.map((t) => t.id)).size).toBe(60);
    expectLinked(all, sessions);
    // oldest first across both devices, each session kept together
    const times = all.map((t) => t.tPresented);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const runs = all.map((t) => t.contextLabel).filter((d, i, a) => d !== a[i - 1]);
    expect(runs).toEqual(['pc', 'phone', 'pc', 'phone', 'pc']);
  });

  it('is idempotent: importing the same backup again, or a merged one, adds nothing', async () => {
    await fill('pc', T0, 3, 10);
    const pcBackup = await exportBackup();
    await db.delete();
    await db.open();
    await fill('phone', T0 + HOUR, 2, 15);
    const phoneBackup = await exportBackup();

    expect(await importBackup(phoneBackup)).toEqual({ sessions: 0, trials: 0, followups: 0, skipped: 0 });
    expect((await importBackup(pcBackup)).trials).toBe(30);
    const merged = await exportBackup();
    expect(await importBackup(pcBackup)).toEqual({ sessions: 0, trials: 0, followups: 0, skipped: 0 });
    expect(await importBackup(merged)).toEqual({ sessions: 0, trials: 0, followups: 0, skipped: 0 });
    expect(await db.sessions.count()).toBe(5);
    expect(await allTrials()).toHaveLength(60);

    // the merged backup brings the phone records over to the PC as well
    await db.delete();
    await db.open();
    await fill('pc', T0, 3, 10);
    expect(await importBackup(merged)).toEqual({ sessions: 2, trials: 30, followups: 0, skipped: 0 });
    expectLinked(await allTrials(), await db.sessions.toArray());
  });

  it('drops duplicated trials inside a file instead of failing half-way', async () => {
    await fill('pc', T0, 1, 5);
    const sessions = await db.sessions.toArray();
    const trials = await db.trials.toArray();
    const file = await gzipLines([
      { type: 'meta', app: 'stellar-ear' },
      ...sessions.map((s) => ({ type: 'session', ...s })),
      ...trials.map((t) => ({ type: 'trial', ...t })),
      ...trials.map((t) => ({ type: 'trial', ...t })), // as exported after an old double archive
    ]);
    await db.delete();
    await db.open();
    expect(await importBackup(file)).toEqual({ sessions: 1, trials: 5, followups: 0, skipped: 0 });
    expect(await allTrials()).toHaveLength(5);
  });

  it('does not duplicate trials that the v0.1 id-based import attached to the wrong session', async () => {
    await fill('pc', T0, 2, 15);
    const pcSessions = await db.sessions.toArray();
    const pcTrials = await db.trials.toArray();
    const pcBackup = await exportBackup();
    await db.delete();
    await db.open();
    await fill('phone', T0 + HOUR, 3, 5); // phone trial ids 1-15, sessions 1-3
    // v0.1 import: skipped clashing ids, kept foreign ids and session ids as they were
    await db.sessions.bulkAdd(pcSessions.filter((s) => s.id! > 3));
    await db.trials.bulkAdd(pcTrials.filter((t) => t.id! > 15)); // PC session 2 trials now sit in phone session 2
    const before = (await allTrials()).length;

    const r = await importBackup(pcBackup);
    const all = await allTrials();
    const distinct = new Set(all.map((t) => `${t.contextLabel}|${t.tPresented}`));
    expect(distinct.size).toBe(all.length); // nothing stored twice
    expect(all.length).toBe(before + r.trials);
    expect(r.trials).toBe(15); // only the PC trials the old import dropped are new
  });

  it('rejects a file that is not a Stellar Ear backup', async () => {
    await expect(importBackup(await gzipLines([{ hello: 1 }]))).rejects.toThrow();
    expect(await db.sessions.count()).toBe(0);
  });
});

describe('archiveOldTrials', () => {
  it('two overlapping calls archive each trial once', async () => {
    await fill('pc', T0, 1, 30);
    const n = await Promise.all([archiveOldTrials(10), archiveOldTrials(10)]);
    expect(n).toEqual([20, 0]);
    expect(await db.archives.count()).toBe(1);
    const all = await allTrials();
    expect(all).toHaveLength(30);
    expect(new Set(all.map((t) => t.id)).size).toBe(30);
    const info = await storageInfo();
    expect(info.trials + info.archivedTrials).toBe(30);
  });

  it('two tabs archiving at once archive each trial once', async () => {
    await fill('pc', T0, 1, 30);
    vi.resetModules();
    const otherTab = await import('./db'); // own connection and own call queue
    try {
      const n = await Promise.all([archiveOldTrials(10), otherTab.archiveOldTrials(10)]);
      expect(n.sort((a, b) => a - b)).toEqual([0, 20]);
      expect(await db.archives.count()).toBe(1);
      expect(await allTrials()).toHaveLength(30);
    } finally {
      otherTab.db.close();
    }
  });

  it('allTrials stays complete while an archive is being written', async () => {
    for (let k = 0; k < 16; k++) {
      await db.delete();
      await db.open();
      await fill('pc', T0, 4, 100);
      await archiveOldTrials(300); // an archive already exists, which widens the window
      const running = archiveOldTrials(10);
      for (let i = 0; i < k; i++) await tick();
      const during = await allTrials();
      expect(await running).toBe(290);
      expect(during, `after ${k} ticks`).toHaveLength(400);
      expect(new Set(during.map((t) => t.id)).size).toBe(400);
    }
  });

  it('allTrials counts a trial once even if an old bug archived it twice', async () => {
    await fill('pc', T0, 1, 20);
    await archiveOldTrials(10);
    const [a] = await db.archives.toArray();
    await db.archives.add({ ...a, id: undefined });
    expect(await allTrials()).toHaveLength(20);
  });
});

describe('followups', () => {
  it('round-trip through export and import, pointing at the imported trial', async () => {
    await fill('pc', T0, 1, 5);
    const src = (await db.trials.toArray())[3];
    await db.trials.update(src.id!, { tPlays: [src.tAudioStart, src.tAudioStart + 9000], hinted: [0] });
    await addFollowup({ trialId: src.id!, sessionId: src.sessionId, probes: 2, postReplays: 1, postContextReplays: 1, tLeave: src.tSubmit + 8000 });
    expect((await storageInfo()).followups).toBe(1);
    const backup = await exportBackup();

    await db.delete();
    await db.open();
    await fill('phone', T0 + HOUR, 1, 7); // occupy the ids the PC used
    expect(await importBackup(backup)).toEqual({ sessions: 1, trials: 5, followups: 1, skipped: 0 });

    const [f] = await allFollowups();
    const t = await db.trials.get(f.trialId);
    expect(t).toBeDefined();
    expect(t!.contextLabel).toBe('pc');
    expect(t!.index).toBe(3);
    expect(t!.tPlays).toEqual([src.tAudioStart, src.tAudioStart + 9000]);
    expect(t!.hinted).toEqual([0]);
    expect(f).toMatchObject({ sessionId: t!.sessionId, probes: 2, postReplays: 1, postContextReplays: 1, tLeave: src.tSubmit + 8000 });
    expect((await db.sessions.get(f.sessionId))!.userAgent).toBe('UA pc');

    expect((await importBackup(backup)).followups).toBe(0);
    expect(await allFollowups()).toHaveLength(1);
  });
});

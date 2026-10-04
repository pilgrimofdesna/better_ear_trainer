import { describe, expect, it } from 'vitest';
import { noPresentation, notePlayback } from './question';

const T = 1_700_000_000_000;

describe('notePlayback', () => {
  it('sets the first presentation and only logs replays', () => {
    let p = notePlayback(noPresentation(), T, T + 3000, T + 4000); // context, then target
    expect(p).toEqual({ tPlays: [T + 3000], tAudioStart: T + 3000, tAudioEnd: T + 4000 });
    p = notePlayback(p, T + 6000, T + 6120, T + 7120); // 다시 듣기 after the target sounded
    expect(p).toEqual({ tPlays: [T + 3000, T + 6120], tAudioStart: T + 3000, tAudioEnd: T + 4000 });
    p = notePlayback(p, T + 9000, T + 12000, T + 13000); // 맥락부터
    expect(p.tPlays).toEqual([T + 3000, T + 6120, T + 12000]);
    expect(p.tAudioStart).toBe(T + 3000);
  });

  it('latencies of inputs before and after a replay stay positive', () => {
    // the dictation case from the review: two notes, replay, two more notes
    let p = notePlayback(noPresentation(), T, T, T + 3000);
    p = notePlayback(p, T + 6000, T + 6120, T + 9120);
    const noteDur = 0.6;
    const tInputs = [T + 3000, T + 3500, T + 9000, T + 9400];
    const lat = tInputs.map((ti, i) => ti - (p.tAudioStart + i * noteDur * 1000));
    expect(lat.every((x) => x > 0)).toBe(true);
  });

  it('a playback cut off before its target sounded does not count as presented', () => {
    // replay pressed during the first context: the first target never played
    let p = notePlayback(noPresentation(), T, T + 3000, T + 4000);
    p = notePlayback(p, T + 1500, T + 1620, T + 2620);
    expect(p).toEqual({ tPlays: [T + 1620], tAudioStart: T + 1620, tAudioEnd: T + 2620 });
    // a replay cut off mid-context after the target had sounded keeps the first one
    p = notePlayback(p, T + 5000, T + 8000, T + 9000);
    p = notePlayback(p, T + 6000, T + 6120, T + 7120);
    expect(p).toEqual({ tPlays: [T + 1620, T + 6120], tAudioStart: T + 1620, tAudioEnd: T + 2620 });
  });

  it('does not mutate its input', () => {
    const p0 = notePlayback(noPresentation(), T, T + 100, T + 200);
    const copy = structuredClone(p0);
    notePlayback(p0, T + 500, T + 600, T + 700);
    expect(p0).toEqual(copy);
  });
});

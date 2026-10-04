// Krumhansl–Schmuckler key finding with Krumhansl–Kessler profiles.
import type { Mode } from './theory';

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyScore {
  tonic: number; // pitch class relative to the same reference as the input
  mode: Mode;
  r: number;
}

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** `weights[pc]` = total duration (or count) of each pitch class. Returns keys sorted best first. */
export function rankKeys(weights: number[]): KeyScore[] {
  const out: KeyScore[] = [];
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - t + 12) % 12]);
    out.push({ tonic: t, mode: 'major', r: corr(weights, rot(MAJOR)) });
    out.push({ tonic: t, mode: 'minor', r: corr(weights, rot(MINOR)) });
  }
  return out.sort((x, y) => y.r - x.r);
}

export function pcWeights(notes: { semi: number; dur: number }[]): number[] {
  const w = new Array(12).fill(0);
  for (const n of notes) w[((n.semi % 12) + 12) % 12] += n.dur;
  return w;
}

/** Rank (0 = best) of the intended key, and the margin to the best competing key. */
export function keyCheck(weights: number[], tonic: number, mode: Mode) {
  const ranked = rankKeys(weights);
  const rank = ranked.findIndex((k) => k.tonic === tonic && k.mode === mode);
  const mine = ranked[rank].r;
  const rival = ranked.find((k) => !(k.tonic === tonic && k.mode === mode))!;
  return { rank, margin: mine - rival.r, rival, ranked };
}

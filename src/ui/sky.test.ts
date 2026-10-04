import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSky } from './sky';

// Fake browser globals and a 2D context that records where each star is drawn.
function setup(opts: { w: number; h: number; screenH: number; reduce?: boolean }) {
  const listeners: Record<string, (() => void)[]> = {};
  let frame: ((t: number) => void) | null = null;
  const arcs: string[] = [];
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    arc(x: number, y: number, r: number) { arcs.push(`${x.toFixed(3)},${y.toFixed(3)},${r.toFixed(3)}`); },
    createLinearGradient: () => ({ addColorStop() {} }),
    fillStyle: '',
    strokeStyle: '' as unknown,
    lineWidth: 1,
  };
  const canvas = { width: 300, height: 150, style: {} as Record<string, string>, getContext: () => ctx };
  vi.stubGlobal('innerWidth', opts.w);
  vi.stubGlobal('innerHeight', opts.h);
  vi.stubGlobal('devicePixelRatio', 3);
  vi.stubGlobal('screen', { height: opts.screenH });
  vi.stubGlobal('matchMedia', () => ({ matches: !!opts.reduce }));
  vi.stubGlobal('addEventListener', (type: string, fn: () => void) => (listeners[type] ??= []).push(fn));
  vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => { frame = fn; return 1; });
  vi.stubGlobal('document', { hidden: false });
  startSky(canvas as unknown as HTMLCanvasElement);
  return {
    canvas,
    ctx,
    /** Star positions drawn since the last call. */
    takeArcs: () => arcs.splice(0),
    resize(w: number, h: number) {
      vi.stubGlobal('innerWidth', w);
      vi.stubGlobal('innerHeight', h);
      for (const fn of listeners.resize ?? []) fn();
    },
    tick: (t: number) => frame?.(t),
    hasLoop: () => frame !== null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sky', () => {
  it('keeps every star in place when only the height changes (Android URL bar)', () => {
    const s = setup({ w: 384, h: 700, screenH: 832 });
    const first = s.takeArcs();
    expect(first.length).toBeGreaterThan(50);
    // pinned at the top and as tall as the screen, at dpr capped to 2
    expect(s.canvas.style.height).toBe('832px');
    expect(s.canvas.height).toBe(832 * 2);
    expect(s.canvas.width).toBe(384 * 2);

    const before = { w: s.canvas.width, h: s.canvas.height, clears: s.ctx.clearRect.mock.calls.length };
    s.resize(384, 756); // URL bar hides
    s.resize(384, 700); // and shows again
    // the canvas is not touched (resizing it would clear it)
    expect([s.canvas.width, s.canvas.height]).toEqual([before.w, before.h]);
    expect(s.ctx.clearRect.mock.calls.length).toBe(before.clears);

    s.tick(10_000);
    const after = s.takeArcs();
    expect(after.length).toBe(first.length);
    expect(new Set(after)).toEqual(new Set(first));
  });

  it('scatters the stars again for a new width, and redraws right away', () => {
    const s = setup({ w: 384, h: 700, screenH: 832 });
    const first = s.takeArcs();
    s.resize(832, 360); // rotation
    const rotated = s.takeArcs();
    expect(rotated.length).toBeGreaterThan(0);
    expect(rotated.some((a) => !first.includes(a))).toBe(true);
    expect(s.canvas.width).toBe(832 * 2);
  });

  it('grows the canvas if the window becomes taller than it', () => {
    const s = setup({ w: 1000, h: 700, screenH: 800 });
    expect(s.canvas.style.height).toBe('800px');
    s.resize(1000, 1200);
    expect(s.canvas.style.height).toBe('1200px');
    expect(s.canvas.height).toBe(2400);
  });

  it('draws one static frame with reduced motion, and again after a real resize', () => {
    const s = setup({ w: 384, h: 700, screenH: 832, reduce: true });
    expect(s.hasLoop()).toBe(false);
    expect(s.takeArcs().length).toBeGreaterThan(50);
    s.resize(384, 756);
    expect(s.takeArcs().length).toBe(0); // nothing to redo
    s.resize(700, 384);
    expect(s.takeArcs().length).toBeGreaterThan(20);
  });
});

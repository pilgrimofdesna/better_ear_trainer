// Night-sky background: slowly twinkling stars and the occasional shooting star.
// Runs at a low frame rate to spare the battery; static when reduced motion is set.

interface Star { x: number; y: number; r: number; base: number; speed: number; phase: number; hue: number }

let flash = 0;
/** Brief brightening of the sky (used on a correct answer). */
export function skyFlash() {
  flash = 1;
}

export function startSky(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars: Star[] = [];
  let w = 0, h = 0, dpr = 1; // canvas size in CSS px; h is the tallest viewport, not innerHeight
  let meteor: { x: number; y: number; vx: number; vy: number; life: number } | null = null;

  // Android Chrome fires 'resize' whenever its URL bar shows or hides (height only). The canvas
  // is pinned to the top and kept as tall as the tallest viewport, so that leaves the sky alone;
  // only a new width (rotation) or a taller window scatters the stars again.
  const resize = () => {
    const nextDpr = Math.min(2, devicePixelRatio || 1);
    const regen = innerWidth !== w || innerHeight > h;
    if (!regen && nextDpr === dpr) return;
    dpr = nextDpr;
    if (regen) {
      w = innerWidth;
      h = Math.max(innerHeight, screen.height || 0);
      const n = Math.round((w * h) / 2600);
      stars = Array.from({ length: n }, () => {
        const big = Math.random() < 0.06;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: big ? 1.1 + Math.random() * 0.9 : 0.3 + Math.random() * 0.7,
          base: 0.25 + Math.random() * 0.6,
          speed: 0.4 + Math.random() * 1.6,
          phase: Math.random() * Math.PI * 2,
          hue: Math.random() < 0.2 ? 45 : Math.random() < 0.5 ? 215 : 230,
        };
      });
    }
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(reduce ? 0 : performance.now()); // resizing the canvas cleared it
  };

  const draw = (t: number) => {
    ctx.clearRect(0, 0, w, h);
    const boost = flash;
    for (const s of stars) {
      const tw = reduce ? 1 : 0.65 + 0.35 * Math.sin(t * 0.001 * s.speed + s.phase);
      const a = Math.min(1, s.base * tw + boost * 0.35);
      ctx.fillStyle = `hsla(${s.hue}, 80%, ${s.hue === 45 ? 80 : 88}%, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.r > 1.2) {
        ctx.fillStyle = `hsla(${s.hue}, 90%, 85%, ${a * 0.15})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (meteor) {
      const m = meteor;
      const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 14, m.y - m.vy * 14);
      g.addColorStop(0, `rgba(255,245,210,${m.life})`);
      g.addColorStop(1, 'rgba(255,245,210,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 14, m.y - m.vy * 14);
      ctx.stroke();
      m.x += m.vx;
      m.y += m.vy;
      m.life -= 0.025;
      if (m.life <= 0) meteor = null;
    } else if (!reduce && Math.random() < 0.0025) {
      meteor = { x: Math.random() * w, y: Math.random() * h * 0.4, vx: 7 + Math.random() * 4, vy: 2.5 + Math.random() * 2, life: 1 };
    }
    flash = Math.max(0, flash - 0.04);
  };

  resize(); // also draws the first frame (the only one when reduced motion is set)
  addEventListener('resize', resize);
  if (reduce) return;
  let last = 0;
  const loop = (t: number) => {
    requestAnimationFrame(loop);
    const busy = meteor || flash > 0;
    if (t - last < (busy ? 33 : 66) || document.hidden) return; // ~15fps idle, 30fps while animating
    last = t;
    draw(t);
  };
  requestAnimationFrame(loop);
}

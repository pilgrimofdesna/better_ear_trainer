import { type Mode, SCALES, labelFor } from '../music/theory';
import { settings } from '../settings';

/**
 * Two-row layout that follows the current mode: the mode's seven scale tones on the bottom
 * row, every other tone on the top row between the scale tone below it and the next one.
 * Each button spans two columns, so a top-row button sits halfway between its neighbours.
 */
export function keyLayout(mode: Mode): Record<number, { col: number; acc: boolean }> {
  const scale = SCALES[mode];
  const out: Record<number, { col: number; acc: boolean }> = {};
  scale.forEach((p, i) => (out[p] = { col: 2 * i + 1, acc: false }));
  for (let p = 0; p < 12; p++) {
    if (scale.includes(p)) continue;
    const below = scale.filter((s) => s < p).length - 1; // index of the scale tone under it
    out[p] = { col: 2 * below + 2, acc: true };
  }
  return out;
}

export interface PadMark {
  [pc: number]: 'good' | 'bad' | 'reveal' | undefined;
}

export function DegreePad({
  choices,
  mode,
  tonicPc,
  onPick,
  marks = {},
  disabled = false,
}: {
  choices: number[];
  mode: Mode;
  tonicPc: number;
  onPick: (pc: number) => void;
  marks?: PadMark;
  disabled?: boolean; // dimmed and ignoring touches, e.g. while the context plays
}) {
  const big = settings.value.label ?? 'degree';
  const small = settings.value.smallLabel ?? 'movable0';
  const layout = keyLayout(mode);
  const dim = { opacity: disabled ? '0.45' : '1', transition: 'opacity 0.15s' };
  const button = (p: number, style?: Record<string, string>) => (
    <button
      key={p}
      class={`deg ${layout[p].acc ? 'acc' : ''} ${marks[p] ?? ''}`}
      style={style}
      aria-disabled={disabled}
      aria-label={labelFor(big, p, mode, tonicPc)}
      onPointerDown={(e) => {
        e.preventDefault(); // fire on touch-down for accurate response times
        if (!disabled) onPick(p);
      }}
    >
      <span>{labelFor(big, p, mode, tonicPc)}</span>
      {small !== 'none' && small !== big && <span class="sol">{labelFor(small, p, mode, tonicPc)}</span>}
    </button>
  );
  const hasAcc = choices.some((p) => layout[p].acc);
  if (choices.length <= 7 || !hasAcc) {
    return (
      <div class="pad flat" style={{ '--n': String(Math.min(choices.length, 7)), ...dim }}>
        {choices.map((p) => button(p))}
      </div>
    );
  }
  // minor's ♯7 sits past the last scale tone, so the grid may need one extra column
  const cols = Math.max(14, ...choices.map((p) => layout[p].col + 1));
  return (
    <div class="pad keys" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, ...dim }}>
      {choices.map((p) =>
        button(p, { gridColumn: `${layout[p].col} / span 2`, gridRow: layout[p].acc ? '1' : '2' }),
      )}
    </div>
  );
}

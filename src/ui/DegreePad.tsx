import { DEGREE_LABELS, SOLFEGE } from '../music/theory';
import { settings } from '../settings';

// Column (in a 14-column grid) of each pitch class for the two-row keyboard layout.
const KEY_COL: Record<number, { col: number; acc: boolean }> = {
  0: { col: 1, acc: false },
  2: { col: 3, acc: false },
  4: { col: 5, acc: false },
  5: { col: 7, acc: false },
  7: { col: 9, acc: false },
  9: { col: 11, acc: false },
  11: { col: 13, acc: false },
  1: { col: 2, acc: true },
  3: { col: 4, acc: true },
  6: { col: 8, acc: true },
  8: { col: 10, acc: true },
  10: { col: 12, acc: true },
};

export interface PadMark {
  [pc: number]: 'good' | 'bad' | 'reveal' | undefined;
}

export function DegreePad({ choices, onPick, marks = {} }: { choices: number[]; onPick: (pc: number) => void; marks?: PadMark }) {
  const lbl = settings.value.labels;
  const button = (p: number, style?: Record<string, string>) => (
    <button
      key={p}
      class={`deg ${KEY_COL[p].acc ? 'acc' : ''} ${marks[p] ?? ''}`}
      style={style}
      onPointerDown={(e) => {
        e.preventDefault(); // fire on touch-down for accurate response times
        onPick(p);
      }}
    >
      {lbl !== 'solfege' && <span>{DEGREE_LABELS[p]}</span>}
      {lbl !== 'number' && <span class={lbl === 'solfege' ? '' : 'sol'}>{SOLFEGE[p]}</span>}
    </button>
  );
  const hasAcc = choices.some((p) => KEY_COL[p].acc);
  if (choices.length <= 7 || !hasAcc) {
    return (
      <div class="pad flat" style={{ '--n': String(Math.min(choices.length, 7)) }}>
        {choices.map((p) => button(p))}
      </div>
    );
  }
  return (
    <div class="pad keys">
      {choices.map((p) =>
        button(p, { gridColumn: `${KEY_COL[p].col} / span 2`, gridRow: KEY_COL[p].acc ? '1' : '2' }),
      )}
    </div>
  );
}

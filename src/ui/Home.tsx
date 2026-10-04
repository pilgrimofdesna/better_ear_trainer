import { go } from './App';
import { settings, patch, type ExerciseSettings } from '../settings';
import type { DegreePreset, Mode } from '../music/theory';
import { audio } from '../audio/engine';

const PRESETS: { id: DegreePreset; name: string }[] = [
  { id: 'triad', name: '1·3·5' },
  { id: 'diatonic', name: '다이아토닉' },
  { id: 'chromatic', name: '크로매틱' },
];

const MODES: { id: Mode; name: string }[] = [
  { id: 'major', name: '장조' },
  { id: 'minor', name: '단조' },
];

function ExerciseOptions({ which }: { which: 'single' | 'dictation' }) {
  const ex: ExerciseSettings = settings.value[which];
  const toggleMode = (m: Mode) =>
    patch((s) => {
      const cur = s[which].modes;
      const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
      s[which].modes = next.length ? next : [m];
    });
  return (
    <>
      <div class="row">
        {PRESETS.map((p) => (
          <button class={`chip ${ex.preset === p.id ? 'on' : ''}`} onClick={() => patch((s) => (s[which].preset = p.id))}>
            {p.name}
          </button>
        ))}
      </div>
      <div class="row">
        {MODES.map((m) => (
          <button class={`chip ${ex.modes.includes(m.id) ? 'on' : ''}`} onClick={() => toggleMode(m.id)}>
            {m.name}
          </button>
        ))}
        {which === 'single' && (
          <button class={`chip ${settings.value.single.drone ? 'on' : ''}`} onClick={() => patch((s) => (s.single.drone = !s.single.drone))}>
            드론 위에서
          </button>
        )}
      </div>
      {which === 'dictation' && (
        <div class="row">
          <span class="muted small">음 개수</span>
          {[2, 3, 4, 5, 6, 8].map((n) => (
            <button class={`chip ${settings.value.dictation.length === n ? 'on' : ''}`} onClick={() => patch((s) => (s.dictation.length = n))}>
              {n}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function Home() {
  const start = (r: 'single' | 'dictation') => {
    audio(); // unlock audio inside the tap
    go(r);
  };
  return (
    <div class="page">
      <div class="brand">
        <span class="star">✦</span>
        <div>
          <h1>Stellar Ear</h1>
          <div class="sub">기능 청음 · 조성 안에서 음의 자리를 듣기</div>
        </div>
      </div>

      <div class="card">
        <div class="spread">
          <h2>개별 음 맞추기</h2>
          <span class="muted small">맥락 → 한 음 → 몇 도?</span>
        </div>
        <ExerciseOptions which="single" />
        <button class="primary" onClick={() => start('single')}>
          시작
        </button>
      </div>

      <div class="card">
        <div class="spread">
          <h2>멜로딕 딕테이션</h2>
          <span class="muted small">맥락 → 멜로디 → 순서대로</span>
        </div>
        <ExerciseOptions which="dictation" />
        <button class="primary" onClick={() => start('dictation')}>
          시작
        </button>
      </div>

      <div class="row">
        <button class="grow" onClick={() => go('stats')}>
          기록과 분석
        </button>
        <button class="grow" onClick={() => go('settings')}>
          설정
        </button>
      </div>
    </div>
  );
}

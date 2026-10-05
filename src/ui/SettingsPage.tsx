import { useEffect, useRef, useState } from 'preact/hooks';
import { go } from './App';
import { settings, patch, DEFAULTS } from '../settings';
import { TIMBRES, type TimbreId } from '../audio/timbres';
import { audio, playEvents, setVolume } from '../audio/engine';
import type { ContextKind } from '../music/context';
import { DEGREE_LABELS, LABEL_KINDS, midiToHz, type LabelKind } from '../music/theory';
import { archiveOldTrials, exportBackup, importBackup, storageInfo, requestPersistence } from '../data/db';

const CONTEXTS: { id: ContextKind; name: string }[] = [
  { id: 'cadence', name: '카덴스' },
  { id: 'drone', name: '드론' },
  { id: 'scale', name: '스케일' },
  { id: 'arpeggio', name: '아르페지오' },
];

type DataJob = 'export' | 'import' | 'archive';

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

function preview(id: TimbreId) {
  audio();
  const hz = midiToHz(60);
  const events = [0, 4, 7, 12].map((semi, i) => ({ semi, t: i * 0.28, dur: i === 3 ? 1.2 : 0.3, vel: 0.7, sustain: false }));
  playEvents(events, hz, id);
}

export function SettingsPage() {
  const s = settings.value;
  const [info, setInfo] = useState<Awaited<ReturnType<typeof storageInfo>> | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState<DataJob | null>(null);
  const running = useRef(false); // state alone lets a fast double tap through
  const refresh = () => storageInfo().then(setInfo).catch(() => {});
  useEffect(() => void refresh(), []);

  /** One data job at a time; the export, import and archive buttons are disabled while it runs. */
  async function run(job: DataJob, work: () => Promise<string>, failMsg: string) {
    if (running.current) return;
    running.current = true;
    setBusy(job);
    setMsg('');
    try {
      setMsg(await work());
    } catch {
      setMsg(failMsg);
    } finally {
      running.current = false;
      setBusy(null);
      void refresh();
    }
  }

  const doExport = () =>
    run(
      'export',
      async () => {
        const blob = await exportBackup();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `stellar-ear-backup-${new Date().toISOString().slice(0, 10)}.jsonl.gz`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        return '백업 파일을 만들었어요';
      },
      '내보내기 실패: 다시 시도해 주세요',
    );

  function doImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = ''; // so picking the same file again still fires onChange
    if (!f) return;
    void run(
      'import',
      async () => {
        const r = await importBackup(f);
        if (!r.sessions && !r.trials && !r.followups) return '새로 가져온 기록이 없어요 (이미 모두 들어 있어요)';
        const skipped = r.skipped ? ` · 세션이 없는 기록 ${r.skipped}개는 건너뜀` : '';
        return `가져옴: 세션 ${r.sessions}개, 문제 ${r.trials}개${skipped}`;
      },
      '가져오기 실패: Stellar Ear 백업 파일(.jsonl.gz)인지 확인해 주세요',
    );
  }

  const doArchive = () =>
    run(
      'archive',
      async () => {
        const n = await archiveOldTrials(1000);
        return n ? `오래된 문제 ${n}개를 압축 보관했어요` : '압축할 만큼 쌓이지 않았어요 (최근 1000개는 그대로 둠)';
      },
      '압축 실패: 다시 시도해 주세요',
    );

  return (
    <div class="page">
      <div class="hud">
        <button class="link" onClick={() => go('home')}>
          ← 홈
        </button>
        <span>설정</span>
      </div>

      <div class="card">
        <h2>음색</h2>
        <p class="muted small">켜진 음색 중에서 문제마다 무작위로 골라요. 이름을 누르면 켜고 끄고, ▶로 미리 들어요.</p>
        {TIMBRES.map((t) => (
          <div class="spread">
            <button class={`chip ${s.timbres.includes(t.id) ? 'on' : ''}`} onClick={() => patch((x) => (x.timbres = toggle(x.timbres, t.id)))}>
              {t.name}
              {t.sustained ? ' · 지속음' : ''}
            </button>
            <button class="ghost" onClick={() => preview(t.id)} aria-label={`${t.name} 미리 듣기`}>
              ▶
            </button>
          </div>
        ))}
      </div>

      <div class="card">
        <h2>맥락과 기준음</h2>
        <div class="row">
          {CONTEXTS.map((c) => (
            <button class={`chip ${s.contextKinds.includes(c.id) ? 'on' : ''}`} onClick={() => patch((x) => (x.contextKinds = toggle(x.contextKinds, c.id)))}>
              {c.name}
            </button>
          ))}
        </div>
        <div class="row">
          <span class="muted small">맥락 들려주기</span>
          {[
            [1, '매 문제'],
            [4, '4문제마다'],
            [12, '12문제마다'],
          ].map(([n, name]) => (
            <button class={`chip ${s.contextEvery === n ? 'on' : ''}`} onClick={() => patch((x) => (x.contextEvery = n as number))}>
              {name}
            </button>
          ))}
        </div>
        <label class="field">
          <span>기준음 연속 디튠 (±50센트)</span>
          <input type="checkbox" checked={s.detune} onChange={() => patch((x) => (x.detune = !x.detune))} />
        </label>
        <div class="row">
          <span class="muted small">개별 음 음역</span>
          {[-1, 0, 1, 2].map((o) => (
            <button
              class={`chip ${s.single.octaves.includes(o) ? 'on' : ''}`}
              onClick={() => patch((x) => (x.single.octaves = toggle(x.single.octaves, o).sort()))}
            >
              {o >= 0 ? '+' : ''}
              {o}
            </button>
          ))}
        </div>
      </div>

      <div class="card">
        <h2>직접 고른 디그리</h2>
        <p class="muted small">고르면 두 훈련 모두 "직접 선택" 세트를 써요. 홈에서 프리셋을 누르면 다시 프리셋으로 돌아갑니다.</p>
        <div class="row">
          {DEGREE_LABELS.map((l, p) => (
            <button
              class={`chip ${s.single.preset === 'custom' && s.single.custom.includes(p) ? 'on' : ''}`}
              onClick={() =>
                patch((x) => {
                  const base = x.single.preset === 'custom' ? x.single.custom : [];
                  const next = toggle(base, p).sort((a, b) => a - b);
                  for (const k of ['single', 'dictation'] as const) {
                    x[k].preset = 'custom';
                    x[k].custom = next;
                  }
                })
              }
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div class="card">
        <h2>화면과 진행</h2>
        <label class="field" for="label-big">
          <span>음 이름 (크게)</span>
          <select id="label-big" value={s.label ?? 'degree'} onChange={(e) => patch((x) => (x.label = (e.target as HTMLSelectElement).value as LabelKind))}>
            {LABEL_KINDS.map((k) => (
              <option value={k.id}>{k.name}</option>
            ))}
          </select>
        </label>
        <label class="field" for="label-small">
          <span>작게 함께 표시</span>
          <select
            id="label-small"
            value={s.smallLabel ?? 'movable0'}
            onChange={(e) => patch((x) => (x.smallLabel = (e.target as HTMLSelectElement).value as LabelKind | 'none'))}
          >
            {LABEL_KINDS.map((k) => (
              <option value={k.id}>{k.name}</option>
            ))}
            <option value="none">없음</option>
          </select>
        </label>
        <label class="field">
          <span>정답이면 자동으로 다음 문제</span>
          <input type="checkbox" checked={s.autoNext} onChange={() => patch((x) => (x.autoNext = !x.autoNext))} />
        </label>
        <label class="field">
          <span>딕테이션 첫 음 힌트</span>
          <input type="checkbox" checked={s.dictation.firstHint} onChange={() => patch((x) => (x.dictation.firstHint = !x.dictation.firstHint))} />
        </label>
        <label class="field">
          <span>음량</span>
          <input
            type="range"
            min="0.2"
            max="1.2"
            step="0.05"
            value={s.volume}
            onInput={(e) => {
              const v = +(e.target as HTMLInputElement).value;
              patch((x) => (x.volume = v));
              setVolume(v);
            }}
          />
        </label>
        <button class="ghost" onClick={() => (settings.value = structuredClone(DEFAULTS))}>
          설정 기본값으로
        </button>
      </div>

      <div class="card">
        <h2>기록 데이터</h2>
        {info && (
          <p class="muted small">
            세션 {info.sessions}개 · 문제 {info.trials + info.archivedTrials}개 (압축 보관 {info.archivedTrials}개)
            {info.usage !== undefined && ` · 사용량 ${(info.usage / 1024 / 1024).toFixed(1)}MB`}
            <br />
            영구 저장: {info.persisted ? '허용됨 (브라우저가 자동으로 지우지 않음)' : '미허용, 정기적으로 백업을 권장해요'}
            <br />
            저장 위치: {location.origin} (다른 주소나 포트로 열면 기록이 따로 쌓여요)
          </p>
        )}
        <div class="row">
          <button onClick={doExport} disabled={!!busy}>
            {busy === 'export' ? '내보내는 중…' : '백업 내보내기'}
          </button>
          <label class="chip" style={{ cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.4 : 1 }} aria-disabled={!!busy}>
            {busy === 'import' ? '가져오는 중…' : '백업 가져오기'}
            <input type="file" accept=".gz,application/gzip" style={{ display: 'none' }} disabled={!!busy} onChange={doImport} />
          </label>
        </div>
        <div class="row">
          <button class="ghost" onClick={doArchive} disabled={!!busy}>
            {busy === 'archive' ? '압축 중…' : '오래된 기록 압축'}
          </button>
          {!info?.persisted && (
            <button class="ghost" onClick={() => requestPersistence().then(refresh)}>
              영구 저장 요청
            </button>
          )}
        </div>
        {msg && <p class="small">{msg}</p>}
        <p class="muted small">기록은 지우는 기능 없이 계속 쌓여요. 압축해도 분석에는 모두 포함됩니다.</p>
      </div>
    </div>
  );
}

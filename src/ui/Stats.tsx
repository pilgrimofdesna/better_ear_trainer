import { useEffect, useMemo, useState } from 'preact/hooks';
import { go } from './App';
import { allTrials, type Exercise, type TrialRec } from '../data/db';
import { analyze, pct, type Rate, type SessionPoint } from '../adaptive/stats';
import { DEGREE_LABELS } from '../music/theory';
import { TIMBRES } from '../audio/timbres';

const C = { random: '#8fc7ff', weakR: '#f6d77a', weakB: '#c39bff' };

const fmt = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const sec = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}초` : '–');
const timbreName = (id: string) => TIMBRES.find((t) => t.id === id)?.name ?? id;
const CONTEXT_NAMES: Record<string, string> = { cadence: '카덴스', drone: '드론', scale: '스케일', arpeggio: '아르페지오' };

export function patternName(key: string): string {
  const [kind, body] = key.split(':');
  const d = (x: string) => DEGREE_LABELS[+x];
  switch (kind) {
    case 'deg':
      return `${d(body)}도`;
    case 'int': {
      const [a, b] = body.split('>');
      return `${d(a)} → ${d(b)}`;
    }
    case 'trans': {
      const [a, b] = body.split('>');
      return `${d(a)}도 다음의 ${d(b)}도`;
    }
    case 'reg': {
      const [p, o] = body.split('@');
      return `${d(p)}도 (${+o >= 0 ? '+' : ''}${o} 옥타브)`;
    }
    case 'tim': {
      const [p, t] = body.split('@');
      return `${d(p)}도 · ${timbreName(t)}`;
    }
  }
  return key;
}

function Trend({ points }: { points: SessionPoint[] }) {
  const pts = points.slice(-30);
  const W = 520, H = 180, L = 30, R = 8, T = 10, B = 22;
  const x = (i: number) => L + (pts.length <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const y = (v: number) => T + (1 - v) * (H - T - B);
  const line = (get: (p: SessionPoint) => Rate, color: string) => {
    const segs: string[] = [];
    pts.forEach((p, i) => {
      const r = get(p);
      if (!r.n) return;
      segs.push(`${segs.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(pct(r)).toFixed(1)}`);
    });
    return (
      <g>
        <path d={segs.join(' ')} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" />
        {pts.map((p, i) => {
          const r = get(p);
          return r.n ? <circle cx={x(i)} cy={y(pct(r))} r={Math.min(5, 1.5 + Math.sqrt(r.n) / 2)} fill={color}><title>{`${r.ok}/${r.n}`}</title></circle> : null;
        })}
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="세션별 정확도 추이">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="rgba(160,180,255,0.12)" />
          <text x={L - 4} y={y(v) + 3} text-anchor="end">{`${v * 100}`}</text>
        </g>
      ))}
      <text x={L} y={H - 6}>오래된 세션</text>
      <text x={W - R} y={H - 6} text-anchor="end">최근</text>
      {line((p) => p.random, C.random)}
      {line((p) => p.weakRandom, C.weakR)}
      {line((p) => p.weakBiased, C.weakB)}
    </svg>
  );
}

function Bars({ rows }: { rows: { k: string; r: Rate }[] }) {
  return (
    <div style={{ display: 'grid', gap: '6px' }}>
      {rows.map(({ k, r }) => (
        <div>
          <div class="spread small">
            <span>{k}</span>
            <span class="muted">
              {fmt(pct(r))} · {r.n}
            </span>
          </div>
          <div class="bar">
            <span style={{ width: `${(pct(r) || 0) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Stats() {
  const [trials, setTrials] = useState<TrialRec[] | null>(null);
  const [ex, setEx] = useState<Exercise>('single');
  const [clean, setClean] = useState(false);
  useEffect(() => {
    allTrials().then(setTrials).catch(() => setTrials([]));
  }, []);
  const a = useMemo(() => (trials ? analyze(trials.filter((t) => t.exercise === ex), { cleanOnly: clean }) : null), [trials, ex, clean]);

  return (
    <div class="page">
      <div class="hud">
        <button class="link" onClick={() => go('home')}>
          ← 홈
        </button>
        <span>기록과 분석</span>
      </div>
      <div class="row">
        <button class={`chip ${ex === 'single' ? 'on' : ''}`} onClick={() => setEx('single')}>
          개별 음
        </button>
        <button class={`chip ${ex === 'dictation' ? 'on' : ''}`} onClick={() => setEx('dictation')}>
          딕테이션
        </button>
        <span class="grow" />
        <button class={`chip ${clean ? 'on' : ''}`} onClick={() => setClean(!clean)} title="쌍의 두 번째 문제만 (이전 문제와 같은 출제 방식)">
          깨끗한 측정만
        </button>
      </div>

      {!a ? (
        <p class="muted">불러오는 중…</p>
      ) : a.count === 0 ? (
        <div class="card">
          <p class="muted">아직 기록이 없어요. 몇 문제 풀고 오면 여기에 쌓입니다.</p>
        </div>
      ) : (
        <>
          <div class="tiles">
            <div class="tile">
              <div class="v">{a.count}</div>
              <div class="k">{ex === 'single' ? '문제' : '멜로디'}</div>
            </div>
            <div class="tile">
              <div class="v">{fmt(pct(a.overall.random))}</div>
              <div class="k">랜덤 출제 정확도</div>
            </div>
            <div class="tile">
              <div class="v">{fmt(pct(a.overall.biased))}</div>
              <div class="k">약점 출제 정확도</div>
            </div>
          </div>

          <div class="card">
            <h2>랜덤 vs 약점 패턴</h2>
            <p class="muted small">
              파랑은 전체 실력(랜덤 출제), 금색은 지금 약한 패턴이 랜덤 문제에서 나왔을 때, 보라는 같은 패턴을 일부러 냈을 때의 정확도예요.
              금색이 올라오면 약점 훈련이 실제 실력으로 옮겨가고 있다는 뜻이에요.
            </p>
            <div class="legend">
              <span><i style={{ background: C.random }} />랜덤 전체</span>
              <span><i style={{ background: C.weakR }} />약점 · 랜덤에서</span>
              <span><i style={{ background: C.weakB }} />약점 · 편향 출제</span>
            </div>
            <Trend points={a.sessions} />
            {a.weak.length > 0 && (
              <>
                <h3>지금 약한 패턴</h3>
                <div style={{ display: 'grid', gap: '6px' }}>
                  {a.weak.map((w) => (
                    <div>
                      <div class="spread small">
                        <span>{patternName(w.key)}</span>
                        <span class="muted">오답률 추정 {fmt(w.rate)}</span>
                      </div>
                      <div class="bar">
                        <span style={{ width: `${w.rate * 100}%`, background: 'var(--bad)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div class="card">
            <h2>디그리별 (찍기 보정)</h2>
            <p class="muted small">
              정답률만 보면 긴가민가할 때 자주 누르는 답이 높게 나와요. "누른 횟수"와 오경보율(아닌데 그 답을 고른 비율)을 빼서 보정한 값이 진짜 구분 능력에 가깝습니다. 우연 정답률 평균 {fmt(a.chance)}.
            </p>
            <div class="scroll-x">
              <table class="grid">
                <thead>
                  <tr>
                    <th>도</th>
                    <th>출제</th>
                    <th>정답률</th>
                    <th>누른 횟수</th>
                    <th>오경보</th>
                    <th>보정</th>
                    <th>d′</th>
                    <th>반응</th>
                  </tr>
                </thead>
                <tbody>
                  {a.degrees.map((d) => (
                    <tr>
                      <td>{DEGREE_LABELS[d.pc]}</td>
                      <td>{d.n}</td>
                      <td>{fmt(d.hit)}</td>
                      <td>{d.pressed}</td>
                      <td>{fmt(d.fa)}</td>
                      <td style={{ color: d.corrected < 0.5 ? 'var(--bad)' : 'var(--gold)' }}>{fmt(d.corrected)}</td>
                      <td>{d.dprime.toFixed(1)}</td>
                      <td>{sec(d.medianRt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <h2>혼동 행렬</h2>
            <p class="muted small">행 = 실제 음, 열 = 고른 답</p>
            <div class="scroll-x">
              <table class="grid">
                <thead>
                  <tr>
                    <th />
                    {a.degrees.map((d) => (
                      <th>{DEGREE_LABELS[d.pc]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {a.degrees.map((row) => (
                    <tr>
                      <th>{DEGREE_LABELS[row.pc]}</th>
                      {a.degrees.map((col) => {
                        const v = a.confusion.get(`${row.pc}>${col.pc}`) ?? 0;
                        const share = v / row.n;
                        const bg = row.pc === col.pc ? `rgba(246,215,122,${share * 0.6})` : `rgba(255,143,163,${share * 0.9})`;
                        return <td style={{ background: v ? bg : undefined }}>{v || ''}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <h2>반응 시간</h2>
            <p class="muted small">
              음이 울린 순간부터 답할 때까지 (딕테이션은 음마다). 정답 중앙값 {sec(a.rtMedian.correct)}, 오답 중앙값 {sec(a.rtMedian.wrong)}. 빠른 답은 직관, 느린 답은 머릿속 계산에 가까워요.
            </p>
            <Bars rows={a.rtBins.map((b) => ({ k: b.label, r: b.r }))} />
          </div>

          <div class="card">
            <h2>조건별 정확도</h2>
            <p class="muted small">관계를 듣고 있다면 기준음 높이, 음역, 음색이 달라도 정확도가 비슷해야 해요. 한쪽만 크게 낮으면 표면 단서에 기대고 있다는 신호예요.</p>
            <h3>기준음(토닉) 높이</h3>
            <Bars rows={a.conditions.tonic} />
            <h3>음역</h3>
            <Bars rows={a.conditions.register} />
            <h3>음색</h3>
            <Bars rows={a.conditions.timbre.map((x) => ({ ...x, k: timbreName(x.k) }))} />
            <h3>맥락 종류</h3>
            <Bars rows={a.conditions.context.map((x) => ({ ...x, k: CONTEXT_NAMES[x.k] ?? x.k }))} />
          </div>

          <div class="card">
            <h2>직전 문제의 영향</h2>
            <Bars
              rows={[
                { k: '직전 정답 뒤', r: a.sequential.afterOk },
                { k: '직전 오답 뒤', r: a.sequential.afterBad },
                { k: '랜덤 쌍의 첫 문제', r: a.overall.first },
                { k: '랜덤 쌍의 두 번째 문제', r: a.overall.clean },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'preact/hooks';
import { go } from './App';
import { DegreePad, type PadMark } from './DegreePad';
import { skyFlash } from './sky';
import { settings } from '../settings';
import { audio, playEvents, stopAll, wallClock, setVolume } from '../audio/engine';
import { buildQuestion, type Question, type Reference } from '../session/question';
import { BlockSchedule, WeaknessModel } from '../adaptive/model';
import { addTrial, allTrials, endSession, startSession, type Exercise, type TrialRec } from '../data/db';
import { DEGREE_LABELS, pc, resolutionPath } from '../music/theory';
import type { NoteEvent, ContextPhrase } from '../music/context';

type Phase = 'loading' | 'ready' | 'listening' | 'answer' | 'feedback';

const wall = () => performance.timeOrigin + performance.now();

function questionEvents(q: Question): { events: NoteEvent[]; first: number; last: number } {
  if (q.exercise === 'single') {
    const lead = q.drone ? 0.7 : 0;
    const events: NoteEvent[] = [{ semi: q.target[0], t: lead, dur: q.noteDur, vel: 0.75 }];
    if (q.drone) {
      const low = q.target[0] < 0 ? -24 : -12;
      events.push({ semi: low, t: 0, dur: lead + q.noteDur + 1.6, vel: 0.35, sustain: true });
      events.push({ semi: low + 12, t: 0, dur: lead + q.noteDur + 1.6, vel: 0.25, sustain: true });
    }
    return { events, first: lead, last: lead + q.noteDur };
  }
  const events = q.target.map((semi, i) => ({
    semi,
    t: i * q.noteDur,
    dur: i === q.target.length - 1 ? q.noteDur * 1.6 : q.noteDur * 0.92,
    vel: 0.72,
  }));
  return { events, first: 0, last: (q.target.length - 1) * q.noteDur + q.noteDur * 1.6 };
}

export function Trainer({ exercise }: { exercise: Exercise }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [q, setQ] = useState<Question | null>(null);
  const [input, setInput] = useState<number[]>([]);
  const [marks, setMarks] = useState<PadMark>({});
  const [result, setResult] = useState<boolean[] | null>(null);
  const [tally, setTally] = useState({ n: 0, ok: 0, streak: 0 });

  const r = useRef({
    sessionId: null as Promise<number> | null,
    model: new WeaknessModel(),
    schedule: new BlockSchedule(),
    index: 0,
    prevRef: null as Reference | null,
    prevTargetPc: null as number | null,
    lastContext: null as ContextPhrase | null,
    contextPlayed: false,
    tPresented: 0,
    tAudioStart: 0,
    tAudioEnd: 0,
    tInputs: [] as number[],
    replays: 0,
    contextReplays: 0,
    probes: 0,
    lastSubmit: null as number | null,
    pending: null as TrialRec | null,
    timers: [] as number[],
  });

  const later = (ms: number, fn: () => void) => r.current.timers.push(window.setTimeout(fn, ms));
  const clearTimers = () => {
    r.current.timers.forEach(clearTimeout);
    r.current.timers = [];
  };

  async function flush() {
    const st = r.current;
    if (!st.pending) return;
    const rec = { ...st.pending, probes: st.probes };
    st.pending = null;
    await addTrial(rec);
  }

  useEffect(() => {
    setVolume(settings.value.volume);
    r.current.sessionId = startSession(exercise, settings.value);
    allTrials()
      .then((ts) => {
        r.current.model = new WeaknessModel(ts.filter((t) => t.exercise === exercise));
      })
      .catch(() => {})
      .finally(() => setPhase('ready'));
    return () => {
      clearTimers();
      stopAll();
      void flush().then(async () => {
        const id = await r.current.sessionId;
        if (id) await endSession(id);
      });
    };
  }, []);

  function play(question: Question, withContext: boolean) {
    const st = r.current;
    clearTimers();
    stopAll();
    audio();
    let delay = 0.12;
    const ctxPhrase = withContext ? (question.context ?? st.lastContext) : null;
    if (ctxPhrase) {
      playEvents(ctxPhrase.events, question.tonicHz, question.contextTimbre, { delay, sustainTimbre: 'pad' });
      delay += ctxPhrase.length + 0.3;
    }
    const { events, first, last } = questionEvents(question);
    const res = playEvents(events, question.tonicHz, question.timbre, { delay, keep: true, sustainTimbre: 'pad' });
    st.tAudioStart = wallClock(res.start + first);
    st.tAudioEnd = wallClock(res.start + last);
    setPhase('listening');
    later(Math.max(0, st.tAudioEnd - wall()), () => setPhase((p) => (p === 'listening' ? 'answer' : p)));
  }

  async function next() {
    const st = r.current;
    await flush();
    const question = buildQuestion({
      exercise,
      s: settings.value,
      slot: st.schedule.next(),
      model: st.model,
      index: st.index,
      prevRef: st.prevRef,
      prevTargetPc: st.prevTargetPc,
    });
    st.contextPlayed = !!question.context;
    if (question.context) st.lastContext = question.context;
    st.prevRef = question;
    st.tInputs = [];
    st.replays = 0;
    st.contextReplays = 0;
    st.probes = 0;
    st.tPresented = wall();
    setQ(question);
    setInput([]);
    setMarks({});
    setResult(null);
    play(question, !!question.context);
  }

  async function submit(question: Question, answer: number[]) {
    const st = r.current;
    const tSubmit = wall();
    const correct = question.target.map((t, i) => pc(t) === answer[i]);
    const allCorrect = correct.every(Boolean);
    const rec: TrialRec = {
      sessionId: (await st.sessionId)!,
      exercise,
      index: st.index,
      mode: question.mode,
      choiceSet: question.choiceSet,
      degreePool: question.degreePool,
      contextPlayed: st.contextPlayed,
      contextKind: st.contextPlayed ? question.context?.kind : undefined,
      contextLabel: st.contextPlayed ? question.context?.label : undefined,
      contextTopNote: st.contextPlayed ? question.context?.topNote : undefined,
      drone: question.drone,
      tonicPc: question.tonicPc,
      detuneCents: question.detuneCents,
      tonicHz: question.tonicHz,
      timbre: question.timbre,
      contextTimbre: question.contextTimbre,
      noteDur: question.noteDur,
      target: question.target,
      registerOctave: question.registerOctave,
      selection: question.slot.selection,
      blockPos: question.slot.blockPos,
      pairPos: question.slot.pairPos,
      biasPattern: question.biasPattern,
      patterns: question.patterns,
      answer,
      correct,
      allCorrect,
      tPresented: st.tPresented,
      tAudioStart: st.tAudioStart,
      tAudioEnd: st.tAudioEnd,
      tInputs: [...st.tInputs],
      tSubmit,
      rtMs: tSubmit - st.tAudioEnd,
      sincePrevMs: st.lastSubmit === null ? null : tSubmit - st.lastSubmit,
      replays: st.replays,
      contextReplays: st.contextReplays,
      probes: 0,
      melodyKeyRank: question.melodyKeyRank,
      melodyAttempts: question.melodyAttempts,
    };
    st.pending = rec;
    st.model.add(rec);
    st.lastSubmit = tSubmit;
    st.index++;
    st.prevTargetPc = pc(question.target[question.target.length - 1]);
    setResult(correct);
    setTally((t) => ({ n: t.n + 1, ok: t.ok + (allCorrect ? 1 : 0), streak: allCorrect ? t.streak + 1 : 0 }));
    setPhase('feedback');
    if (!allCorrect) navigator.vibrate?.([25, 50, 25]);
    clearTimers();
    stopAll();

    if (exercise === 'single') {
      const target = question.target[0];
      setMarks(allCorrect ? { [answer[0]]: 'good' } : { [answer[0]]: 'bad', [pc(target)]: 'reveal' });
      const path = resolutionPath(target, question.mode);
      const step = 0.34;
      const events = path.map((semi, i) => ({ semi, t: i * step, dur: i === path.length - 1 ? 1.0 : step, vel: 0.6 }));
      const res = playEvents(events, question.tonicHz, question.timbre, { delay: 0.15 });
      if (allCorrect) {
        skyFlash();
        if (settings.value.autoNext) later((res.end - audio().currentTime) * 1000 + 250, () => void next());
      }
    } else {
      if (allCorrect) {
        skyFlash();
        // a short tonic "landing" then move on
        playEvents([{ semi: 0, t: 0, dur: 0.8, vel: 0.5 }], question.tonicHz, question.timbre, { delay: 0.1 });
        if (settings.value.autoNext) later(1300, () => void next());
      }
    }
  }

  function pick(p: number) {
    const st = r.current;
    if (!q) return;
    if (phase === 'feedback') {
      // audition any degree in the current key after answering
      st.probes++;
      const oct = q.exercise === 'single' ? q.registerOctave : 0;
      playEvents([{ semi: p + 12 * oct, t: 0, dur: 0.8, vel: 0.7 }], q.tonicHz, q.timbre, { delay: 0.01 });
      return;
    }
    if (phase !== 'listening' && phase !== 'answer') return;
    st.tInputs.push(wall());
    navigator.vibrate?.(8);
    const nextInput = [...input, p];
    setInput(nextInput);
    if (nextInput.length >= q.target.length) void submit(q, nextInput);
  }

  function undo() {
    if (phase === 'feedback' || !input.length) return;
    r.current.tInputs.pop();
    setInput(input.slice(0, -1));
  }

  function replay(withContext: boolean) {
    if (!q) return;
    if (withContext) r.current.contextReplays++;
    else r.current.replays++;
    if (phase === 'feedback') {
      // after answering, replays are for listening again; don't touch the timing record
      const { events } = questionEvents(q);
      let delay = 0.1;
      const c = withContext ? (q.context ?? r.current.lastContext) : null;
      if (c) {
        playEvents(c.events, q.tonicHz, q.contextTimbre, { delay, sustainTimbre: 'pad' });
        delay += c.length + 0.3;
      }
      playEvents(events, q.tonicHz, q.timbre, { delay, keep: !!c, sustainTimbre: 'pad' });
      return;
    }
    play(q, withContext);
  }

  async function quit() {
    clearTimers();
    stopAll();
    go('home');
  }

  // PC keyboard: 1–7 = natural degrees, Shift+2/3/4/6/7 = ♭2 ♭3 ♯4 ♭6 ♭7,
  // Space = replay, C = context, Backspace = undo, Enter = next / start
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const naturals = [0, 2, 4, 5, 7, 9, 11];
    const accidentals: Record<number, number> = { 2: 1, 3: 3, 4: 6, 6: 8, 7: 10 };
    const digit = /^Digit([1-7])$/.exec(e.code);
    if (digit) {
      const n = +digit[1];
      const p = e.shiftKey ? accidentals[n] : naturals[n - 1];
      if (p !== undefined && q?.choiceSet.includes(p)) pick(p);
    } else if (e.code === 'Space') replay(false);
    else if (e.code === 'KeyC') replay(true);
    else if (e.code === 'Backspace') undo();
    else if (e.code === 'Enter') {
      if (phase === 'ready' || phase === 'feedback') void next();
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);

  const title = exercise === 'single' ? '개별 음 맞추기' : '멜로딕 딕테이션';
  const acc = tally.n ? Math.round((100 * tally.ok) / tally.n) : 0;

  return (
    <div class="page">
      <div class="hud">
        <button class="link" onClick={quit}>
          ← 끝내기
        </button>
        <span>
          <b>{tally.n}</b> 문제 · <b>{acc}%</b> · 연속 <b>{tally.streak}</b>
        </span>
      </div>

      <div class="stage">
        {phase === 'loading' || phase === 'ready' ? (
          <>
            <h2>{title}</h2>
            <p class="muted small">
              매 문제마다 조성, 기준음 높이(±50센트), 음역, 음색이 바뀝니다.
              <br />
              조성 맥락을 듣고 {exercise === 'single' ? '마지막 음이' : '멜로디의 각 음이'} 몇 도인지 고르세요.
            </p>
            <button class="primary" disabled={phase === 'loading'} onClick={() => void next()}>
              {phase === 'loading' ? '기록 불러오는 중…' : '첫 문제 듣기'}
            </button>
          </>
        ) : exercise === 'single' ? (
          <>
            <div class={`orb ${phase === 'listening' ? 'listening' : ''} ${result ? (result[0] ? 'good' : 'bad') : ''}`}>
              {result && q ? DEGREE_LABELS[pc(q.target[0])] : phase === 'listening' ? '♪' : '?'}
            </div>
            <div class="feedback">
              {result
                ? result[0]
                  ? '정답'
                  : `${DEGREE_LABELS[pc(q!.target[0])]}도였어요. 버튼을 눌러 비교해 보세요`
                : phase === 'listening'
                  ? '듣는 중'
                  : '몇 도일까요?'}
            </div>
          </>
        ) : (
          <>
            <div class="slots">
              {q!.target.map((t, i) => {
                const filled = i < input.length;
                const cls = result ? (result[i] ? 'good' : 'bad') : filled ? 'filled' : i === input.length ? 'cur' : '';
                return (
                  <div
                    class={`slot ${filled ? 'filled' : ''} ${cls}`}
                    onClick={() => result && playEvents([{ semi: t, t: 0, dur: 0.8, vel: 0.7 }], q!.tonicHz, q!.timbre, { delay: 0.01 })}
                  >
                    <div>
                      {filled ? DEGREE_LABELS[input[i]] : i === 0 && settings.value.dictation.firstHint ? <span class="muted">{DEGREE_LABELS[pc(t)]}</span> : ''}
                      {result && !result[i] && <span class="fix">{DEGREE_LABELS[pc(t)]}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div class="feedback">
              {result
                ? result.every(Boolean)
                  ? '모두 정답'
                  : `${result.filter(Boolean).length} / ${result.length} 정답 · 작은 금색 숫자가 정답, 칸을 누르면 그 음이 나와요`
                : phase === 'listening'
                  ? '듣는 중'
                  : '순서대로 입력하세요'}
            </div>
          </>
        )}
      </div>

      {q && phase !== 'ready' && (
        <>
          <div class="controls">
            <button onClick={() => replay(false)}>다시 듣기</button>
            <button onClick={() => replay(true)}>맥락부터</button>
            {exercise === 'dictation' && phase !== 'feedback' && (
              <button onClick={undo} disabled={!input.length}>
                지우기
              </button>
            )}
            {phase === 'feedback' && (
              <button class="primary" onClick={() => void next()}>
                다음
              </button>
            )}
          </div>
          <DegreePad choices={q.choiceSet} onPick={pick} marks={marks} />
        </>
      )}
    </div>
  );
}

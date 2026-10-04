import { useEffect, useRef, useState } from 'preact/hooks';
import { go } from './App';
import { DegreePad, type PadMark } from './DegreePad';
import { skyFlash } from './sky';
import { settings } from '../settings';
import { audio, playEvents, stopAll, wallClock, setVolume } from '../audio/engine';
import { buildQuestion, noPresentation, notePlayback, type Question, type Reference } from '../session/question';
import { BlockSchedule, WeaknessModel, withHints } from '../adaptive/model';
import { addFollowup, addTrial, allTrials, db, endSession, startSession, type Exercise, type TrialRec } from '../data/db';
import { DEGREE_LABELS, pc, resolutionPath } from '../music/theory';
import type { NoteEvent, ContextPhrase } from '../music/context';

// 'context': the question is playing but its target has not sounded yet (context, drone lead)
type Phase = 'loading' | 'ready' | 'context' | 'listening' | 'answer' | 'feedback';

// same epoch clock as the session records; the performance clock stops while the phone sleeps
const wall = () => Date.now();

function questionEvents(q: Question): { events: NoteEvent[]; first: number; last: number } {
  if (q.exercise === 'single') {
    const lead = q.drone ? 0.7 : 0;
    const events: NoteEvent[] = [{ semi: q.target[0], t: lead, dur: q.noteDur, vel: 0.75 }];
    if (q.drone) {
      // tonic + fifth; anything lower than about 60 Hz vanishes on a phone speaker
      events.push({ semi: -12, t: 0, dur: lead + q.noteDur + 1.6, vel: 0.35, sustain: true });
      events.push({ semi: -5, t: 0, dur: lead + q.noteDur + 1.6, vel: 0.22, sustain: true });
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
    asking: false, // a question is out and not answered yet
    tPresented: 0,
    pres: noPresentation(),
    tInputs: [] as number[],
    replays: 0,
    contextReplays: 0,
    // listening after the answer, saved later as a followup of the trial
    probes: 0,
    postReplays: 0,
    postContextReplays: 0,
    lastSubmit: null as number | null,
    answered: null as { trialId: Promise<number>; sessionId: number } | null, // followup not written yet
    timers: [] as number[],
  });

  const later = (ms: number, fn: () => void) => r.current.timers.push(window.setTimeout(fn, ms));
  const clearTimers = () => {
    r.current.timers.forEach(clearTimeout);
    r.current.timers = [];
  };

  /** On leaving the feedback of a trial: log what was listened to after answering, at most once. */
  function writeFollowup() {
    const st = r.current;
    const a = st.answered;
    if (!a) return;
    st.answered = null;
    if (!st.probes && !st.postReplays && !st.postContextReplays) return;
    const f = {
      sessionId: a.sessionId,
      probes: st.probes,
      postReplays: st.postReplays,
      postContextReplays: st.postContextReplays,
      tLeave: wall(),
    };
    a.trialId.then((trialId) => addFollowup({ trialId, ...f })).catch((e) => console.error('followup not saved', e));
  }

  const closeSession = () => void r.current.sessionId?.then((id) => endSession(id)).catch(() => {});

  useEffect(() => {
    setVolume(settings.value.volume);
    r.current.sessionId = startSession(exercise, settings.value);
    Promise.all([allTrials(), db.sessions.toArray().catch(() => [])])
      .then(([ts, ss]) => {
        r.current.model = new WeaknessModel(withHints(ts, ss).filter((t) => t.exercise === exercise));
      })
      .catch(() => {})
      .finally(() => setPhase('ready'));
    // The back gesture, swiping Chrome away or a tab discard leave without unmounting,
    // and a hidden page may never come back, so wrap up on hide too (endSession just moves endedAt).
    const onHide = () => {
      writeFollowup();
      closeSession();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    document.addEventListener('visibilitychange', onVisibility);
    addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('pagehide', onHide);
      clearTimers();
      stopAll();
      onHide();
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
    const now = wall();
    const start = wallClock(res.start + first);
    const end = wallClock(res.start + last);
    // replays are logged in tPlays; tAudioStart/End stay on the first presentation
    st.pres = notePlayback(st.pres, now, start, end);
    const heard = st.pres.tPlays.length > 1; // the target already sounded in an earlier playback
    setPhase(heard ? 'listening' : 'context');
    if (!heard) later(Math.max(0, start - now), () => setPhase((p) => (p === 'context' ? 'listening' : p)));
    later(Math.max(0, end - now), () => setPhase((p) => (p === 'listening' ? 'answer' : p)));
  }

  function next() {
    const st = r.current;
    if (st.asking) return; // the auto-advance timer, 다음 and Enter can all fire for one trial
    writeFollowup();
    const question = buildQuestion({
      exercise,
      s: settings.value,
      slot: st.schedule.next(),
      model: st.model,
      index: st.index,
      prevRef: st.prevRef,
      prevTargetPc: st.prevTargetPc,
    });
    st.asking = true;
    st.contextPlayed = !!question.context;
    if (question.context) st.lastContext = question.context;
    st.prevRef = question;
    st.pres = noPresentation();
    st.tInputs = [];
    st.replays = 0;
    st.contextReplays = 0;
    st.probes = 0;
    st.postReplays = 0;
    st.postContextReplays = 0;
    st.tPresented = wall();
    setQ(question);
    setInput([]);
    setMarks({});
    setResult(null);
    play(question, !!question.context);
  }

  async function submit(question: Question, answer: number[]) {
    const st = r.current;
    if (!st.asking) return;
    st.asking = false;
    const tSubmit = wall();
    const correct = question.target.map((t, i) => pc(t) === answer[i]);
    const allCorrect = correct.every(Boolean);
    const sessionId = (await st.sessionId)!;
    const rec: TrialRec = {
      sessionId,
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
      // the first-note hint shows slot 0's answer, so that note had no real choice
      hinted: exercise === 'dictation' && settings.value.dictation.firstHint ? [0] : [],
      tPresented: st.tPresented,
      tAudioStart: st.pres.tAudioStart,
      tAudioEnd: st.pres.tAudioEnd,
      tPlays: st.pres.tPlays.filter((t) => t <= tSubmit), // a replay cut off by the answer never sounded
      tInputs: [...st.tInputs],
      tSubmit,
      rtMs: tSubmit - st.pres.tAudioEnd,
      sincePrevMs: st.lastSubmit === null ? null : tSubmit - st.lastSubmit,
      replays: st.replays,
      contextReplays: st.contextReplays,
      probes: 0, // listening after the answer goes into a followup record
      melodyKeyRank: question.melodyKeyRank,
      melodyAttempts: question.melodyAttempts,
    };
    // save right away: from here the page can be closed at any moment
    const trialId = addTrial(rec);
    trialId.catch((e) => console.error('trial not saved', e));
    st.answered = { trialId, sessionId };
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
        if (settings.value.autoNext) later((res.end - audio().currentTime) * 1000 + 250, next);
      }
    } else {
      if (allCorrect) {
        skyFlash();
        // a short tonic "landing" then move on
        playEvents([{ semi: 0, t: 0, dur: 0.8, vel: 0.5 }], question.tonicHz, question.timbre, { delay: 0.1 });
        if (settings.value.autoNext) later(1300, next);
      }
    }
  }

  function pick(p: number) {
    const st = r.current;
    if (!q) return;
    if (phase === 'feedback') {
      // audition any degree in the current key after answering (and stop the auto-advance)
      clearTimers();
      st.probes++;
      const oct = q.exercise === 'single' ? q.registerOctave : 0;
      playEvents([{ semi: p + 12 * oct, t: 0, dur: 0.8, vel: 0.7 }], q.tonicHz, q.timbre, { delay: 0.01 });
      return;
    }
    if (phase !== 'listening' && phase !== 'answer') return; // nothing to answer before the target sounds
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
    const st = r.current;
    if (!q) return;
    if (phase === 'feedback') {
      // after answering, replays are for listening again; don't touch the timing record,
      // count them for the followup and stop the auto-advance
      clearTimers();
      if (withContext) st.postContextReplays++;
      else st.postReplays++;
      const { events } = questionEvents(q);
      let delay = 0.1;
      const c = withContext ? (q.context ?? st.lastContext) : null;
      if (c) {
        playEvents(c.events, q.tonicHz, q.contextTimbre, { delay, sustainTimbre: 'pad' });
        delay += c.length + 0.3;
      }
      playEvents(events, q.tonicHz, q.timbre, { delay, keep: !!c, sustainTimbre: 'pad' });
      return;
    }
    if (withContext) st.contextReplays++;
    else st.replays++;
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
      if (phase === 'ready' || phase === 'feedback') next();
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
  const hearing = phase === 'context' || phase === 'listening';

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
            <button class="primary" disabled={phase === 'loading'} onClick={() => next()}>
              {phase === 'loading' ? '기록 불러오는 중…' : '첫 문제 듣기'}
            </button>
          </>
        ) : exercise === 'single' ? (
          <>
            <div class={`orb ${hearing ? 'listening' : ''} ${result ? (result[0] ? 'good' : 'bad') : ''}`}>
              {result && q ? DEGREE_LABELS[pc(q.target[0])] : hearing ? '♪' : '?'}
            </div>
            <div class="feedback">
              {result
                ? result[0]
                  ? '정답'
                  : `${DEGREE_LABELS[pc(q!.target[0])]}도였어요. 버튼을 눌러 비교해 보세요`
                : hearing
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
                    onClick={() => {
                      if (!result) return;
                      clearTimers(); // listening again: no auto-advance
                      playEvents([{ semi: t, t: 0, dur: 0.8, vel: 0.7 }], q!.tonicHz, q!.timbre, { delay: 0.01 });
                    }}
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
                : hearing
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
              <button class="primary" onClick={() => next()}>
                다음
              </button>
            )}
          </div>
          <DegreePad choices={q.choiceSet} onPick={pick} marks={marks} disabled={phase === 'context'} />
        </>
      )}
    </div>
  );
}

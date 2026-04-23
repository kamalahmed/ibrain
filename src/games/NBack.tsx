import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { LevelProgress } from "@/components/LevelProgress";
import { LevelComplete } from "@/components/LevelComplete";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

type Level = {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  n: 1 | 2 | 3;
  total: number;
  intervalMs: number;
  /** Minimum hits required to clear the level. */
  hitsToClear: number;
};

const SESSION_SECONDS = 300;
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const POINTS_HIT = 15;
const POINTS_CORRECT_REJECT = 3;
const POINTS_FALSE_ALARM = -5;
const LEVEL_CLEAR_BONUS = 75;

const LEVELS: Level[] = [
  { id: 1, name: "1-back", n: 1, total: 15, intervalMs: 2400, hitsToClear: 3 },
  { id: 2, name: "2-back", n: 2, total: 18, intervalMs: 2200, hitsToClear: 3 },
  { id: 3, name: "2-back fast", n: 2, total: 22, intervalMs: 2000, hitsToClear: 4 },
  { id: 4, name: "3-back", n: 3, total: 22, intervalMs: 1900, hitsToClear: 3 },
  { id: 5, name: "3-back fast", n: 3, total: 24, intervalMs: 1700, hitsToClear: 4 },
];

function genSequence(total: number, n: number): string[] {
  const seq: string[] = [];
  for (let i = 0; i < total; i++) {
    if (i >= n && Math.random() < 0.35) {
      seq.push(seq[i - n]);
    } else {
      let choice = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      // ensure non-target is actually different from n-back position
      if (i >= n && choice === seq[i - n]) {
        choice = LETTERS[(LETTERS.indexOf(choice) + 1) % LETTERS.length];
      }
      seq.push(choice);
    }
  }
  return seq;
}

export default function NBack() {
  const game = getGame("nback");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [seq, setSeq] = useState<string[]>([]);
  const [stepIdx, setStepIdx] = useState(-1);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [falseAlarms, setFalseAlarms] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<"hit" | "miss" | "fa" | "cr" | null>(null);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);

  const scoreRef = useRef(0);
  const clearedRef = useRef(0);
  const levelPointsRef = useRef(0);
  const levelHitsRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const stepTimerRef = useRef<number | null>(null);
  const seqRef = useRef<string[]>([]);
  const stepIdxRef = useRef(-1);
  const levelIdxRef = useRef(0);
  const respondedRef = useRef<boolean[]>([]);
  const endedRef = useRef(false);

  const currentLevel = LEVELS[levelIdx];

  const clearTimers = () => {
    if (stepTimerRef.current !== null) {
      window.clearTimeout(stepTimerRef.current);
      stepTimerRef.current = null;
    }
  };
  const stopSessionTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  useEffect(
    () => () => {
      clearTimers();
      stopSessionTick();
    },
    []
  );

  const end = useCallback(
    (clearedAll: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearTimers();
      stopSessionTick();
      let final = scoreRef.current;
      if (clearedAll) {
        const remaining = Math.max(
          0,
          Math.floor((deadlineRef.current - Date.now()) / 1000)
        );
        final += remaining;
      }
      scoreRef.current = final;
      setScore(final);
      const { isBest: best } = recordPlay("nback", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  /** Evaluate the step that just ended. Updates score + counters. */
  const evaluateStep = (i: number) => {
    const lvl = LEVELS[levelIdxRef.current];
    if (i < lvl.n) return; // not evaluable
    const s = seqRef.current;
    const isTarget = s[i] === s[i - lvl.n];
    const responded = respondedRef.current[i] === true;
    if (isTarget && responded) {
      scoreRef.current += POINTS_HIT;
      levelPointsRef.current += POINTS_HIT;
      levelHitsRef.current += 1;
      setHits((n) => n + 1);
      setLastFeedback("hit");
    } else if (isTarget && !responded) {
      setMisses((n) => n + 1);
      setLastFeedback("miss");
    } else if (!isTarget && responded) {
      scoreRef.current += POINTS_FALSE_ALARM;
      levelPointsRef.current += POINTS_FALSE_ALARM;
      setFalseAlarms((n) => n + 1);
      setLastFeedback("fa");
    } else {
      scoreRef.current += POINTS_CORRECT_REJECT;
      levelPointsRef.current += POINTS_CORRECT_REJECT;
      setLastFeedback("cr");
    }
    setScore(Math.max(0, scoreRef.current));
    scoreRef.current = Math.max(0, scoreRef.current);
    window.setTimeout(() => setLastFeedback(null), 350);
  };

  const advance = useCallback(() => {
    // Evaluate the previous step, if any
    if (stepIdxRef.current >= 0) {
      evaluateStep(stepIdxRef.current);
    }
    const lvl = LEVELS[levelIdxRef.current];
    const next = stepIdxRef.current + 1;
    if (next >= lvl.total) {
      // level done — evaluate pass/fail
      clearTimers();
      if (levelHitsRef.current >= lvl.hitsToClear) {
        scoreRef.current += LEVEL_CLEAR_BONUS;
        levelPointsRef.current += LEVEL_CLEAR_BONUS;
        setScore(scoreRef.current);
        clearedRef.current += 1;
        setLastCleared(lvl.id);
        setLastLevelScore(levelPointsRef.current);
        const nextIdx = levelIdxRef.current + 1;
        if (nextIdx >= LEVELS.length) {
          setPhase("levelDone");
          window.setTimeout(() => end(true), 1100);
        } else {
          setPhase("levelDone");
          window.setTimeout(() => startLevel(nextIdx), 1100);
        }
      } else {
        // failed — end session
        end(false);
      }
      return;
    }
    stepIdxRef.current = next;
    setStepIdx(next);
    stepTimerRef.current = window.setTimeout(advance, lvl.intervalMs);
  }, [end]);

  const startLevel = useCallback(
    (idx: number) => {
      const lvl = LEVELS[idx];
      const s = genSequence(lvl.total, lvl.n);
      setLevelIdx(idx);
      levelIdxRef.current = idx;
      setSeq(s);
      seqRef.current = s;
      respondedRef.current = new Array(lvl.total).fill(false);
      levelPointsRef.current = 0;
      levelHitsRef.current = 0;
      stepIdxRef.current = 0;
      setStepIdx(0);
      setPhase("playing");
      clearTimers();
      stepTimerRef.current = window.setTimeout(advance, lvl.intervalMs);
    },
    [advance]
  );

  const begin = () => {
    setScore(0);
    scoreRef.current = 0;
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    levelHitsRef.current = 0;
    setHits(0);
    setMisses(0);
    setFalseAlarms(0);
    setLevelIdx(0);
    levelIdxRef.current = 0;
    setStepIdx(-1);
    stepIdxRef.current = -1;
    setTimeLeft(SESSION_SECONDS);
    endedRef.current = false;
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  const startSession = () => {
    deadlineRef.current = Date.now() + SESSION_SECONDS * 1000;
    setTimeLeft(SESSION_SECONDS);
    stopSessionTick();
    sessionTickRef.current = window.setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000)
      );
      setTimeLeft(left);
      if (left <= 0) end(false);
    }, 250);
    startLevel(0);
  };

  const onMatch = useCallback(() => {
    if (phase !== "playing") return;
    const i = stepIdxRef.current;
    const lvl = LEVELS[levelIdxRef.current];
    if (i < lvl.n) return;
    if (respondedRef.current[i]) return;
    respondedRef.current[i] = true;
    setLastFeedback("hit"); // optimistic visual; evaluation happens on advance
    window.setTimeout(() => setLastFeedback(null), 200);
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "m" || e.key === "M") {
        e.preventDefault();
        onMatch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onMatch]);

  const current = stepIdx >= 0 && stepIdx < currentLevel.total ? seq[stepIdx] : null;
  const progress = useMemo(
    () => Math.max(0, Math.min(1, (stepIdx + 1) / currentLevel.total)),
    [stepIdx, currentLevel.total]
  );

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Level 1 is 1-back: match if the current letter equals the previous one.",
      stage: <NBackDemo letters={["K", "K"]} arrow="1" matched />,
    },
    {
      caption: "Levels 2–3 are 2-back: compare with the letter two steps ago.",
      stage: <NBackDemo letters={["K", "R", "K"]} arrow="2" matched />,
    },
    {
      caption: "Levels 4–5 are 3-back — and faster.",
      stage: <NBackDemo letters={["K", "R", "T", "K"]} arrow="3" matched />,
    },
    {
      caption: "Tap Match (or Space) only when it's a match. Wrong taps cost points.",
      stage: (
        <div className="grid min-h-[22vh] place-items-center rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <LevelProgress total={5} current={1} cleared={0} />
        </div>
      ),
    },
  ];

  const feedbackColor =
    lastFeedback === "hit"
      ? "ring-emerald-300"
      : lastFeedback === "fa"
      ? "ring-rose-300"
      : lastFeedback === "miss"
      ? "ring-amber-300"
      : "ring-slate-200 dark:ring-slate-800";

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Five n-back levels in one 5-minute session. Level 1 is 1-back;
          by level 5 you're on 3-back, faster. Tap Match (or press space)
          whenever the current letter matches the one N steps ago.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startSession} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LevelProgress
              total={LEVELS.length}
              current={levelIdx + 1}
              cleared={clearedRef.current}
              label="Level"
            />
            <div className="flex items-center gap-2">
              <span className="chip" data-testid="score">
                {score} pts
              </span>
              <span
                className={
                  "chip " +
                  (timeLeft <= 15
                    ? "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800"
                    : "")
                }
                data-testid="timer"
              >
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {currentLevel.name} · match {currentLevel.n} back
            </span>
            <span data-testid="progress">
              step {Math.min(stepIdx + 1, currentLevel.total)} / {currentLevel.total} · {hits} hits
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <motion.div
              className="h-full bg-gradient-to-r from-brand-500 to-accent-teal"
              animate={{ width: `${progress * 100}%` }}
              transition={{ ease: "linear", duration: 0.2 }}
            />
          </div>

          {phase === "levelDone" ? (
            <LevelComplete
              levelJustCleared={lastCleared}
              totalLevels={LEVELS.length}
              levelScore={lastLevelScore}
              nextLabel={LEVELS[lastCleared]?.name}
            />
          ) : (
            <>
              <div
                className={
                  "grid min-h-[36vh] place-items-center rounded-3xl bg-white/80 ring-1 transition-colors dark:bg-slate-900/70 " +
                  feedbackColor
                }
                data-testid="stage"
                data-current={current ?? ""}
                data-n={currentLevel.n}
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={stepIdx + "-" + levelIdx}
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.1 }}
                    transition={{ duration: 0.18 }}
                    className="bg-gradient-to-br from-brand-600 to-accent-teal bg-clip-text text-[8rem] font-black leading-none text-transparent sm:text-[11rem]"
                    aria-live="polite"
                  >
                    {current ?? "•"}
                  </motion.div>
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={onMatch}
                data-testid="match-btn"
                className="btn-primary w-full min-h-[56px] text-lg disabled:opacity-50"
                aria-label={`Press if current letter matches ${currentLevel.n} back`}
                disabled={stepIdx < currentLevel.n}
              >
                Match (space)
              </button>
              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                First {currentLevel.n} letter{currentLevel.n === 1 ? "" : "s"} can't match — just watch. Need {currentLevel.hitsToClear} hits to clear.
              </p>
            </>
          )}
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${hits} hits · ${misses} missed · ${falseAlarms} false alarms`}
        />
      )}
    </GameShell>
  );
}

function NBackDemo({
  letters,
  arrow,
  matched,
}: {
  letters: string[];
  arrow: string;
  matched?: boolean;
}) {
  return (
    <div className="mx-auto max-w-sm">
      <div className="flex items-center justify-center gap-2">
        {letters.map((l, i) => {
          const active = i === 0 || i === letters.length - 1;
          return (
            <div
              key={i}
              className={
                "grid h-16 w-16 place-items-center rounded-2xl text-3xl font-black transition-all " +
                (active
                  ? "bg-gradient-to-br from-brand-500 to-accent-teal text-white shadow-soft"
                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500")
              }
            >
              {l}
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          ← compare {arrow} back
        </span>
      </div>
      {matched && (
        <p className="mt-3 text-center text-sm font-bold text-emerald-600 dark:text-emerald-400">
          Same letter → press Match
        </p>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

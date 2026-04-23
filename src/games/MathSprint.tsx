import { useCallback, useEffect, useRef, useState } from "react";
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

type Op = "+" | "-" | "×" | "÷";

type Problem = {
  a: number;
  b: number;
  op: Op;
  answer: number;
  text: string;
  choices: number[]; // only populated for choice-mode levels
};

type InputMode = "choice" | "typed";

type Level = {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  requiredCorrect: number;
  inputMode: InputMode;
  make: () => Omit<Problem, "choices">;
};

const SESSION_SECONDS = 300; // 5 minutes total
const WRONG_PENALTY_S = 3;
const POINTS_PER_CORRECT = 10;
const LEVEL_CLEAR_BONUS = 25;

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function reversedDigits(n: number): number {
  const s = String(Math.abs(n));
  const r = s.split("").reverse().join("");
  // drop leading zeros
  return parseInt(r, 10);
}

/** Build 4 unique choices (correct + 3 close distractors). */
function buildChoices(correct: number): number[] {
  const pool = new Set<number>();
  pool.add(correct);

  // Swapped-digits: meaningful when answer has 2+ digits and reverse differs
  if (correct >= 10) {
    const swapped = reversedDigits(correct);
    if (swapped !== correct && swapped >= 0) pool.add(swapped);
  }

  const offsets = [1, -1, 2, -2, 10, -10, 3, -3, 11, -11, 20, -20];
  for (const o of offsets) {
    if (pool.size >= 4) break;
    const v = correct + o;
    if (v < 0) continue;
    pool.add(v);
  }

  // fallback in pathological cases
  while (pool.size < 4) {
    pool.add(correct + pool.size + 3);
  }

  const arr = Array.from(pool).slice(0, 4);
  // shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* --------------- level problem generators --------------- */

function makeAddSub(max: number): Omit<Problem, "choices"> {
  const op: Op = Math.random() < 0.5 ? "+" : "-";
  let a: number, b: number, answer: number;
  if (op === "+") {
    a = randInt(1, max);
    b = randInt(1, max);
    answer = a + b;
  } else {
    a = randInt(Math.floor(max / 2), max);
    b = randInt(1, a);
    answer = a - b;
  }
  return { a, b, op, answer, text: `${a} ${op} ${b}` };
}

function makeMul(max: number): Omit<Problem, "choices"> {
  const a = randInt(2, max);
  const b = randInt(2, max);
  return { a, b, op: "×", answer: a * b, text: `${a} × ${b}` };
}

function makeMixed(): Omit<Problem, "choices"> {
  const r = Math.random();
  if (r < 0.35) return makeAddSub(50);
  if (r < 0.7) return makeMul(12);
  // small division
  const b = randInt(2, 12);
  const q = randInt(2, 12);
  const a = b * q;
  return { a, b, op: "÷", answer: q, text: `${a} ÷ ${b}` };
}

function makeHard(): Omit<Problem, "choices"> {
  const r = Math.random();
  if (r < 0.4) {
    // 2-digit × 1-digit
    const a = randInt(12, 29);
    const b = randInt(3, 9);
    return { a, b, op: "×", answer: a * b, text: `${a} × ${b}` };
  }
  if (r < 0.7) {
    // larger add/sub
    const a = randInt(50, 300);
    const b = randInt(20, 200);
    const op: Op = a >= b && Math.random() < 0.5 ? "-" : "+";
    const answer = op === "+" ? a + b : a - b;
    return { a, b, op, answer, text: `${a} ${op} ${b}` };
  }
  // division
  const b = randInt(3, 12);
  const q = randInt(4, 20);
  const a = b * q;
  return { a, b, op: "÷", answer: q, text: `${a} ÷ ${b}` };
}

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Warm-up",
    requiredCorrect: 5,
    inputMode: "choice",
    make: () => makeAddSub(20),
  },
  {
    id: 2,
    name: "Bigger sums",
    requiredCorrect: 5,
    inputMode: "choice",
    make: () => makeAddSub(99),
  },
  {
    id: 3,
    name: "Times tables",
    requiredCorrect: 5,
    inputMode: "choice",
    make: () => makeMul(12),
  },
  {
    id: 4,
    name: "All mixed",
    requiredCorrect: 6,
    inputMode: "choice",
    make: makeMixed,
  },
  {
    id: 5,
    name: "Type it",
    requiredCorrect: 6,
    inputMode: "typed",
    make: makeHard,
  },
];

function makeProblemForLevel(lvl: Level): Problem {
  const base = lvl.make();
  const choices =
    lvl.inputMode === "choice" ? buildChoices(base.answer) : [];
  return { ...base, choices };
}

export default function MathSprint() {
  const game = getGame("math");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0); // 0..4
  const [problem, setProblem] = useState<Problem>(() =>
    makeProblemForLevel(LEVELS[0])
  );
  const [input, setInput] = useState("");
  const [levelCorrect, setLevelCorrect] = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [score, setScore] = useState(0);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [finalScore, setFinalScore] = useState(0);

  const deadlineRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scoreRef = useRef(0);
  const levelPointsRef = useRef(0);
  const clearedRef = useRef(0);

  const currentLevel = LEVELS[levelIdx];

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  const stopTick = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  useEffect(() => () => stopTick(), []);

  const computeTimeLeft = () => {
    const ms = deadlineRef.current - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  };

  const end = useCallback(
    (clearedAllLevels: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopTick();
      let final = scoreRef.current;
      if (clearedAllLevels) {
        // end-of-session time bonus
        const remaining = Math.max(
          0,
          Math.floor((deadlineRef.current - Date.now()) / 1000)
        );
        final += remaining;
      }
      scoreRef.current = final;
      setScore(final);
      const { isBest: best } = recordPlay("math", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  const startLevel = useCallback((idx: number) => {
    const lvl = LEVELS[idx];
    setLevelIdx(idx);
    setLevelCorrect(0);
    levelPointsRef.current = 0;
    setProblem(makeProblemForLevel(lvl));
    setInput("");
    setPhase("playing");
    if (lvl.inputMode === "typed") {
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, []);

  const begin = () => {
    setLevelIdx(0);
    setLevelCorrect(0);
    setTotalCorrect(0);
    setWrong(0);
    setScore(0);
    scoreRef.current = 0;
    levelPointsRef.current = 0;
    clearedRef.current = 0;
    setInput("");
    setTimeLeft(SESSION_SECONDS);
    endedRef.current = false;
    setLastCleared(0);
    setLastLevelScore(0);
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  const startSession = () => {
    deadlineRef.current = Date.now() + SESSION_SECONDS * 1000;
    setTimeLeft(SESSION_SECONDS);
    stopTick();
    tickRef.current = window.setInterval(() => {
      const left = computeTimeLeft();
      setTimeLeft(left);
      if (left <= 0) end(false);
    }, 200);
    startLevel(0);
  };

  const answerCorrect = () => {
    const lvl = LEVELS[levelIdx];
    const newLevelCorrect = levelCorrect + 1;
    setLevelCorrect(newLevelCorrect);
    setTotalCorrect((n) => n + 1);
    scoreRef.current += POINTS_PER_CORRECT;
    levelPointsRef.current += POINTS_PER_CORRECT;
    setScore(scoreRef.current);
    setFlash("ok");
    window.setTimeout(() => setFlash(null), 220);

    if (newLevelCorrect >= lvl.requiredCorrect) {
      // level cleared
      scoreRef.current += LEVEL_CLEAR_BONUS;
      levelPointsRef.current += LEVEL_CLEAR_BONUS;
      setScore(scoreRef.current);
      clearedRef.current += 1;
      const nextIdx = levelIdx + 1;
      setLastCleared(lvl.id);
      setLastLevelScore(levelPointsRef.current);
      if (nextIdx >= LEVELS.length) {
        setPhase("levelDone");
        window.setTimeout(() => end(true), 1100);
      } else {
        setPhase("levelDone");
        window.setTimeout(() => startLevel(nextIdx), 1100);
      }
    } else {
      // next problem, same level
      setProblem(makeProblemForLevel(lvl));
      setInput("");
      if (lvl.inputMode === "typed") {
        window.setTimeout(() => inputRef.current?.focus(), 30);
      }
    }
  };

  const answerWrong = () => {
    setWrong((w) => w + 1);
    setFlash("bad");
    window.setTimeout(() => setFlash(null), 260);
    deadlineRef.current -= WRONG_PENALTY_S * 1000;
    const left = computeTimeLeft();
    setTimeLeft(left);
    if (left <= 0) {
      end(false);
      return;
    }
    // new problem for the same level
    const lvl = LEVELS[levelIdx];
    setProblem(makeProblemForLevel(lvl));
    setInput("");
    if (lvl.inputMode === "typed") {
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const onChoice = (n: number) => {
    if (phase !== "playing") return;
    if (n === problem.answer) answerCorrect();
    else answerWrong();
  };

  const onTypedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phase !== "playing") return;
    const v = input.trim();
    if (v === "") return;
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) return;
    if (parsed === problem.answer) answerCorrect();
    else answerWrong();
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "5 levels in 5 minutes. Clear each level to unlock the next.",
      stage: (
        <div className="grid min-h-[22vh] place-items-center rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <LevelProgress total={5} current={1} cleared={0} />
        </div>
      ),
    },
    {
      caption: "Levels 1–4: tap the right answer from four choices.",
      stage: (
        <div className="mx-auto max-w-sm space-y-2">
          <div className="grid place-items-center rounded-2xl bg-white/80 p-4 text-4xl font-black text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:text-white dark:ring-slate-800">
            13 + 9 = ?
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[22, 21, 23, 18].map((n, i) => (
              <div
                key={n}
                className={
                  "grid min-h-[48px] place-items-center rounded-2xl text-xl font-bold " +
                  (i === 0
                    ? "bg-emerald-500 text-white"
                    : "bg-white text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700")
                }
              >
                {n}
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      caption:
        "Watch for swapped digits — 42 and 24 both look right at a glance.",
      stage: (
        <div className="mx-auto max-w-sm">
          <div className="grid place-items-center rounded-2xl bg-white/80 p-4 text-4xl font-black text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:text-white dark:ring-slate-800">
            6 × 7 = ?
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[42, 24, 43, 40].map((n, i) => (
              <div
                key={n}
                className={
                  "grid min-h-[48px] place-items-center rounded-2xl text-xl font-bold " +
                  (i === 0
                    ? "bg-emerald-500 text-white"
                    : i === 1
                    ? "bg-rose-500/90 text-white"
                    : "bg-white text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700")
                }
              >
                {n}
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      caption:
        "Level 5: no choices — type the answer. Wrong answers cost 3 seconds.",
      stage: (
        <div className="mx-auto max-w-sm space-y-2">
          <div className="grid place-items-center rounded-2xl bg-white/80 p-4 text-4xl font-black text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:text-white dark:ring-slate-800">
            23 × 7 = ?
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-2xl bg-white px-4 py-3 text-2xl font-bold text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700">
              161
            </div>
            <div className="rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white">
              Enter
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Five levels, one 5-minute timer. Clear each level by answering
          enough problems correctly — tap the answer from four choices on
          levels 1–4, then type it on level 5. Wrong answers cost{" "}
          {WRONG_PENALTY_S}s.
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
              {currentLevel.name} · {currentLevel.inputMode === "typed" ? "type the answer" : "tap the answer"}
            </span>
            <span data-testid="progress">
              {levelCorrect} / {currentLevel.requiredCorrect} correct
            </span>
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
                  "relative grid min-h-[22vh] place-items-center rounded-3xl p-4 ring-1 transition-colors " +
                  (flash === "ok"
                    ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-900/40 dark:ring-emerald-800"
                    : flash === "bad"
                    ? "bg-rose-50 ring-rose-200 dark:bg-rose-900/40 dark:ring-rose-800"
                    : "bg-white/80 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800")
                }
              >
                <AnimatePresence mode="wait">
                  <motion.p
                    key={problem.text + levelIdx + levelCorrect}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="text-5xl font-black text-slate-900 dark:text-white sm:text-6xl"
                    aria-live="polite"
                    data-testid="problem"
                  >
                    {problem.text} = ?
                  </motion.p>
                </AnimatePresence>
              </div>

              {currentLevel.inputMode === "choice" ? (
                <div className="grid grid-cols-2 gap-3">
                  {problem.choices.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onChoice(n)}
                      data-testid="choice"
                      data-value={n}
                      className="min-h-[64px] rounded-2xl bg-white text-2xl font-black text-slate-900 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:ring-brand-300 active:scale-[0.98] dark:bg-slate-900 dark:text-white dark:ring-slate-700 dark:hover:bg-slate-800 sm:text-3xl"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <form onSubmit={onTypedSubmit} className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9-]*"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Your answer"
                    aria-label="Your answer"
                    data-testid="typed-input"
                    className="min-h-[56px] flex-1 rounded-2xl bg-white px-4 text-2xl font-bold text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-slate-900 dark:text-white dark:ring-slate-700"
                    autoFocus
                  />
                  <button type="submit" className="btn-primary min-h-[56px]">
                    Enter
                  </button>
                </form>
              )}
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
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${totalCorrect} correct · ${wrong} wrong`}
        />
      )}
    </GameShell>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

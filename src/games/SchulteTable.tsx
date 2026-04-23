import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
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
  size: 5 | 6 | 7;
  colored: boolean;
  /** Target time in seconds for full speed bonus. */
  targetSeconds: number;
};

const SESSION_SECONDS = 300;
const POINTS_PER_TAP = 3;
const LEVEL_CLEAR_BASE = 100;

const LEVELS: Level[] = [
  { id: 1, name: "5×5", size: 5, colored: false, targetSeconds: 35 },
  { id: 2, name: "5×5 coloured", size: 5, colored: true, targetSeconds: 45 },
  { id: 3, name: "6×6", size: 6, colored: false, targetSeconds: 65 },
  { id: 4, name: "6×6 coloured", size: 6, colored: true, targetSeconds: 80 },
  { id: 5, name: "7×7", size: 7, colored: false, targetSeconds: 110 },
];

function shuffled(total: number): number[] {
  const arr = Array.from({ length: total }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const CELL_PALETTE = [
  "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
];

function randomColors(total: number): string[] {
  return Array.from({ length: total }, () =>
    CELL_PALETTE[Math.floor(Math.random() * CELL_PALETTE.length)]
  );
}

export default function SchulteTable() {
  const game = getGame("schulte");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [grid, setGrid] = useState<number[]>(() => shuffled(25));
  const [colors, setColors] = useState<string[]>([]);
  const [next, setNext] = useState(1);
  const [shake, setShake] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [levelElapsed, setLevelElapsed] = useState(0);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);

  const scoreRef = useRef(0);
  const clearedRef = useRef(0);
  const levelPointsRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const levelStartedAtRef = useRef(0);

  const currentLevel = LEVELS[levelIdx];

  const stopTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  useEffect(() => () => stopTick(), []);

  const end = useCallback(
    (clearedAll: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopTick();
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
      const { isBest: best } = recordPlay("schulte", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  const startLevel = useCallback((idx: number) => {
    const lvl = LEVELS[idx];
    const total = lvl.size * lvl.size;
    setLevelIdx(idx);
    setGrid(shuffled(total));
    setColors(lvl.colored ? randomColors(total) : []);
    setNext(1);
    levelPointsRef.current = 0;
    levelStartedAtRef.current = Date.now();
    setLevelElapsed(0);
    setPhase("playing");
  }, []);

  const begin = () => {
    setScore(0);
    scoreRef.current = 0;
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    setLevelIdx(0);
    setNext(1);
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
    stopTick();
    sessionTickRef.current = window.setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000)
      );
      setTimeLeft(left);
      const elapsed = (Date.now() - levelStartedAtRef.current) / 1000;
      setLevelElapsed(elapsed);
      if (left <= 0) end(false);
    }, 200);
    startLevel(0);
  };

  const onTap = (n: number) => {
    if (phase !== "playing") return;
    if (n !== next) {
      setShake((s) => s + 1);
      return;
    }
    // correct tap
    scoreRef.current += POINTS_PER_TAP;
    levelPointsRef.current += POINTS_PER_TAP;
    setScore(scoreRef.current);
    const lvl = LEVELS[levelIdx];
    const total = lvl.size * lvl.size;
    if (n === total) {
      // level cleared
      const elapsed = (Date.now() - levelStartedAtRef.current) / 1000;
      const speedBonus = Math.max(
        0,
        Math.round((lvl.targetSeconds - elapsed) * 3)
      );
      const clearPts = LEVEL_CLEAR_BASE + speedBonus;
      scoreRef.current += clearPts;
      levelPointsRef.current += clearPts;
      setScore(scoreRef.current);
      clearedRef.current += 1;
      setLastCleared(lvl.id);
      setLastLevelScore(levelPointsRef.current);
      const nextIdx = levelIdx + 1;
      if (nextIdx >= LEVELS.length) {
        setPhase("levelDone");
        window.setTimeout(() => end(true), 1100);
      } else {
        setPhase("levelDone");
        window.setTimeout(() => startLevel(nextIdx), 1100);
      }
      return;
    }
    setNext(n + 1);
  };

  const cells = useMemo(() => grid, [grid]);

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Tap the numbers in order — 1, then 2, then 3…",
      stage: <SchulteDemo size={5} colored={false} next={1} />,
    },
    {
      caption: "Fixate in the middle. Let peripheral vision find the next number.",
      stage: <SchulteDemo size={5} colored={false} next={4} highlightCenter />,
    },
    {
      caption: "Levels 2 & 4 add coloured cells — ignore the colours.",
      stage: <SchulteDemo size={5} colored next={1} />,
    },
    {
      caption: "Clear all five grids (5×5 → 7×7) inside 5 minutes.",
      stage: (
        <div className="grid min-h-[22vh] place-items-center rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <LevelProgress total={5} current={1} cleared={0} />
        </div>
      ),
    },
  ];

  const gridColsClass =
    currentLevel.size === 5
      ? "grid-cols-5"
      : currentLevel.size === 6
      ? "grid-cols-6"
      : "grid-cols-7";

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Five Schulte grids in one 5-minute session — 5×5 → 6×6 → 7×7, with
          colour-distraction variants on levels 2 and 4. Clear each grid to
          unlock the next. Wrong taps don't hurt; just shake the grid.
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
              {currentLevel.name} · next{" "}
              <span className="font-bold text-slate-900 dark:text-white">
                {next}
              </span>
            </span>
            <span data-testid="progress">
              level {levelElapsed.toFixed(1)}s · target {currentLevel.targetSeconds}s
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
            <motion.div
              role="grid"
              aria-label={`Schulte table level ${currentLevel.id}, tap ${next} next`}
              data-testid="schulte-grid"
              data-size={currentLevel.size}
              className={
                "mx-auto grid aspect-square w-full max-w-md gap-1.5 sm:gap-2 " +
                gridColsClass
              }
              animate={shake > 0 ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
              transition={{ duration: 0.25 }}
              key={`grid-${levelIdx}-${shake}`}
            >
              {cells.map((n, i) => {
                const done = n < next;
                const colorClass = colors[i] ?? "";
                return (
                  <button
                    key={`${n}-${i}`}
                    type="button"
                    role="gridcell"
                    aria-label={`Number ${n}`}
                    data-testid="cell"
                    data-value={n}
                    onClick={() => onTap(n)}
                    className={
                      "relative aspect-square min-h-[36px] rounded-xl font-bold transition-colors " +
                      (currentLevel.size === 7
                        ? "text-sm sm:text-base"
                        : currentLevel.size === 6
                        ? "text-base sm:text-xl"
                        : "text-xl sm:text-2xl") +
                      " " +
                      (done
                        ? "bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600"
                        : colorClass
                        ? colorClass + " ring-1 ring-slate-200 hover:brightness-110 dark:ring-slate-700"
                        : "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-brand-50 active:bg-brand-100 dark:bg-slate-900 dark:text-white dark:ring-slate-700 dark:hover:bg-slate-800")
                    }
                  >
                    {n}
                  </button>
                );
              })}
            </motion.div>
          )}
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Wrong tap? Just a shake — no penalty.
          </p>
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} levels`}
        />
      )}
    </GameShell>
  );
}

function SchulteDemo({
  size,
  colored,
  next,
  highlightCenter,
}: {
  size: 5 | 6 | 7;
  colored: boolean;
  next: number;
  highlightCenter?: boolean;
}) {
  const total = size * size;
  const grid = useMemo(() => shuffled(total), [total]);
  const cols =
    size === 5 ? "grid-cols-5" : size === 6 ? "grid-cols-6" : "grid-cols-7";
  const palette = useMemo(
    () => (colored ? randomColors(total) : []),
    [colored, total]
  );
  const centerIdx = Math.floor(total / 2);
  return (
    <div
      className={
        "mx-auto grid aspect-square w-full max-w-xs gap-1 rounded-2xl bg-slate-100 p-2 dark:bg-slate-800 " +
        cols
      }
    >
      {grid.map((n, i) => {
        const done = n < next;
        const isCenter = highlightCenter && i === centerIdx;
        return (
          <div
            key={i}
            className={
              "grid aspect-square place-items-center rounded-md text-xs font-bold sm:text-sm " +
              (done
                ? "bg-slate-300 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
                : isCenter
                ? "bg-brand-600 text-white ring-2 ring-brand-300"
                : colored && palette[i]
                ? palette[i]
                : "bg-white text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700")
            }
          >
            {n}
          </div>
        );
      })}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

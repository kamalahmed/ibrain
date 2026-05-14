import { useCallback, useEffect, useRef, useState } from "react";
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

type Card = {
  id: number;
  symbol: string;
  matched: boolean;
  flipped: boolean;
};

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  cols: number;
  rows: number;
  targetSeconds: number;
};

const SESSION_SECONDS = 180; // 3-minute session
const POINTS_PER_MATCH = 30;
const LEVEL_CLEAR_BASE = 150;
const MISMATCH_HIDE_MS = 700;

const SYMBOLS = [
  "🍎", "🚀", "🌈", "🐙", "🎲", "🎵", "⚓️", "🌸",
  "🍉", "🐝", "⭐️", "🍀", "🌙", "🔥", "💎", "🎯",
  "🎁", "🌊", "❄️", "🍋", "🏔️", "🦊",
];

const LEVELS: Level[] = [
  { id: 1, name: "4×4", cols: 4, rows: 4, targetSeconds: 25 },
  { id: 2, name: "4×5", cols: 4, rows: 5, targetSeconds: 35 },
  { id: 3, name: "4×6", cols: 4, rows: 6, targetSeconds: 48 },
  { id: 4, name: "5×6", cols: 5, rows: 6, targetSeconds: 65 },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck(cols: number, rows: number): Card[] {
  const pairCount = (cols * rows) / 2;
  const pairs = shuffle(SYMBOLS).slice(0, pairCount);
  const doubled = shuffle([...pairs, ...pairs]);
  return doubled.map((symbol, i) => ({
    id: i,
    symbol,
    matched: false,
    flipped: false,
  }));
}

export default function MemoryMatch() {
  const game = getGame("memory");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [deck, setDeck] = useState<Card[]>([]);
  const [moves, setMoves] = useState(0);
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
  const levelStartedAtRef = useRef(0);
  const busyRef = useRef(false);
  const endedRef = useRef(false);
  const totalMatchesRef = useRef(0);

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
      const { isBest: best } = recordPlay("memory", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  const startLevel = useCallback((idx: number) => {
    const lvl = LEVELS[idx];
    setLevelIdx(idx);
    setDeck(makeDeck(lvl.cols, lvl.rows));
    setMoves(0);
    levelPointsRef.current = 0;
    busyRef.current = false;
    levelStartedAtRef.current = Date.now();
    setLevelElapsed(0);
    setPhase("playing");
  }, []);

  const begin = () => {
    setScore(0);
    scoreRef.current = 0;
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    totalMatchesRef.current = 0;
    setLevelIdx(0);
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

  const advanceAfterClear = (lvl: Level) => {
    const elapsed = (Date.now() - levelStartedAtRef.current) / 1000;
    const speedBonus = Math.max(
      0,
      Math.round((lvl.targetSeconds - elapsed) * 2)
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
  };

  const onFlip = (id: number) => {
    if (phase !== "playing") return;
    if (busyRef.current) return;
    setDeck((prev) => {
      const card = prev.find((c) => c.id === id);
      if (!card || card.matched || card.flipped) return prev;

      const alreadyFlipped = prev.filter((c) => c.flipped && !c.matched);
      if (alreadyFlipped.length >= 2) return prev;

      const next = prev.map((c) => (c.id === id ? { ...c, flipped: true } : c));
      const newlyFlipped = next.filter((c) => c.flipped && !c.matched);

      if (newlyFlipped.length === 2) {
        const [a, b] = newlyFlipped;
        setMoves((m) => m + 1);
        if (a.symbol === b.symbol) {
          // match
          const matched = next.map((c) =>
            c.id === a.id || c.id === b.id
              ? { ...c, matched: true, flipped: false }
              : c
          );
          scoreRef.current += POINTS_PER_MATCH;
          levelPointsRef.current += POINTS_PER_MATCH;
          totalMatchesRef.current += 1;
          setScore(scoreRef.current);
          // level cleared?
          if (matched.every((c) => c.matched)) {
            const lvl = LEVELS[levelIdx];
            window.setTimeout(() => advanceAfterClear(lvl), 180);
          }
          return matched;
        } else {
          busyRef.current = true;
          window.setTimeout(() => {
            setDeck((cur) =>
              cur.map((c) =>
                c.id === a.id || c.id === b.id ? { ...c, flipped: false } : c
              )
            );
            busyRef.current = false;
          }, MISMATCH_HIDE_MS);
        }
      }
      return next;
    });
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Tap a card to flip it — you can have two flipped at once.",
      stage: <FlipDemo />,
    },
    {
      caption: "Matching symbols stay face-up. A mismatch flips back down.",
      stage: <MatchDemo />,
    },
    {
      caption:
        "Four grids, each bigger than the last — 4×4 up to 5×6. Clear one to unlock the next.",
      stage: <GridSizesDemo />,
    },
    {
      caption: "Clear grids fast for a bigger bonus. Three minutes for all four.",
      stage: <SpeedDemo />,
    },
  ];

  const colsClass =
    currentLevel.cols === 4
      ? "grid-cols-4"
      : currentLevel.cols === 5
      ? "grid-cols-5"
      : "grid-cols-6";

  const faceTextSize =
    currentLevel.cols <= 4
      ? "text-3xl"
      : currentLevel.cols === 5
      ? "text-2xl"
      : "text-xl";

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four memory grids in one 3-minute session — 4×4, 4×5, 4×6, and
          finally 5×6. Flip two cards at a time; matching pairs stay
          face-up. Clear each grid to unlock the next.
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
              {currentLevel.name} · {moves} moves
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
            <div
              role="grid"
              aria-label="Memory cards"
              data-testid="memory-grid"
              data-cols={currentLevel.cols}
              data-rows={currentLevel.rows}
              className={"grid gap-1.5 sm:gap-2 " + colsClass}
            >
              {deck.map((card) => (
                <MemoryCard
                  key={`${levelIdx}-${card.id}`}
                  card={card}
                  faceTextSize={faceTextSize}
                  onFlip={() => onFlip(card.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${totalMatchesRef.current} pairs`}
        />
      )}
    </GameShell>
  );
}

function MemoryCard({
  card,
  faceTextSize,
  onFlip,
}: {
  card: Card;
  faceTextSize: string;
  onFlip: () => void;
}) {
  const showFace = card.flipped || card.matched;
  return (
    <motion.button
      type="button"
      role="gridcell"
      aria-label={showFace ? `Card showing ${card.symbol}` : "Hidden card"}
      aria-pressed={showFace}
      data-testid="card"
      data-symbol={card.symbol}
      data-matched={card.matched ? "1" : "0"}
      data-flipped={card.flipped ? "1" : "0"}
      onClick={onFlip}
      whileTap={{ scale: 0.96 }}
      className="relative aspect-square w-full rounded-xl"
    >
      <motion.span
        animate={{ rotateY: showFace ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 480, damping: 26, mass: 0.7 }}
        className="absolute inset-0 grid place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-teal text-xl text-white shadow-soft"
        style={{ backfaceVisibility: "hidden" }}
        aria-hidden
      >
        ?
      </motion.span>
      <motion.span
        initial={false}
        animate={{ rotateY: showFace ? 0 : -180 }}
        transition={{ type: "spring", stiffness: 480, damping: 26, mass: 0.7 }}
        className={
          "absolute inset-0 grid place-items-center rounded-xl " +
          faceTextSize +
          " " +
          (card.matched
            ? "bg-emerald-100 ring-2 ring-emerald-300 dark:bg-emerald-900/50 dark:ring-emerald-700"
            : "bg-white ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700")
        }
        style={{ backfaceVisibility: "hidden" }}
        aria-hidden
      >
        {card.symbol}
      </motion.span>
    </motion.button>
  );
}

/* ---------------- Animated tutorial demos ---------------- */

/** Cycles through a list of phase durations, looping forever. */
function useLoopPhase(durations: number[]): number {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(
      () => setPhase((p) => (p + 1) % durations.length),
      durations[phase] ?? 1000
    );
    return () => window.clearTimeout(t);
  }, [phase, durations]);
  return phase;
}

type DemoCardState = "down" | "up" | "matched" | "miss";

/** A single tutorial card that flips with the same 3D motion as the real game. */
function DemoCard({
  symbol,
  state,
}: {
  symbol: string;
  state: DemoCardState;
}) {
  const showFace = state !== "down";
  const faceClass =
    state === "matched"
      ? "bg-emerald-100 ring-2 ring-emerald-300 dark:bg-emerald-900/50 dark:ring-emerald-600"
      : state === "miss"
      ? "bg-rose-50 ring-2 ring-rose-300 dark:bg-rose-900/40 dark:ring-rose-700"
      : "bg-white ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700";
  return (
    <div className="relative aspect-square w-full" aria-hidden>
      <motion.span
        animate={{ rotateY: showFace ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 480, damping: 26, mass: 0.7 }}
        className="absolute inset-0 grid place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-teal text-lg text-white shadow-soft"
        style={{ backfaceVisibility: "hidden" }}
      >
        ?
      </motion.span>
      <motion.span
        initial={false}
        animate={{ rotateY: showFace ? 0 : -180 }}
        transition={{ type: "spring", stiffness: 480, damping: 26, mass: 0.7 }}
        className={
          "absolute inset-0 grid place-items-center rounded-xl text-2xl sm:text-3xl " +
          faceClass
        }
        style={{ backfaceVisibility: "hidden" }}
      >
        {symbol}
      </motion.span>
    </div>
  );
}

const FLIP_PHASES = [1100, 1700];
const FLIP_SYMBOLS = ["🍎", "🚀", "🌈", "🎵"];

/** Step 1: two cards flip up and back down, on a loop. */
function FlipDemo() {
  const phase = useLoopPhase(FLIP_PHASES);
  const up = phase === 1;
  return (
    <div className="grid min-h-[22vh] place-items-center">
      <div className="grid w-full max-w-[17rem] grid-cols-4 gap-2.5">
        {FLIP_SYMBOLS.map((s, i) => (
          <DemoCard
            key={i}
            symbol={s}
            state={up && (i === 1 || i === 2) ? "up" : "down"}
          />
        ))}
      </div>
    </div>
  );
}

const MATCH_PHASES = [900, 650, 950, 800, 600, 650, 950, 1500, 800];
const MATCH_SYMBOLS = ["🍎", "🚀", "🌈", "🌈"];

/** Step 2: a mismatch flips back, then a real match stays and turns green. */
function MatchDemo() {
  const p = useLoopPhase(MATCH_PHASES);
  // 0 down · 1 c0 up · 2 c1 up · 3 mismatch · 4 c0/c1 down ·
  // 5 c2 up · 6 c3 up · 7 matched · 8 hold
  const c0: DemoCardState =
    p === 1 || p === 2 ? "up" : p === 3 ? "miss" : "down";
  const c1: DemoCardState = p === 2 ? "up" : p === 3 ? "miss" : "down";
  const c2: DemoCardState =
    p === 5 || p === 6 ? "up" : p === 7 || p === 8 ? "matched" : "down";
  const c3: DemoCardState =
    p === 6 ? "up" : p === 7 || p === 8 ? "matched" : "down";
  const states = [c0, c1, c2, c3];
  return (
    <div className="grid min-h-[22vh] place-items-center">
      <div className="grid w-full max-w-[17rem] grid-cols-4 gap-2.5">
        {MATCH_SYMBOLS.map((s, i) => (
          <DemoCard key={i} symbol={s} state={states[i]} />
        ))}
      </div>
    </div>
  );
}

const GRID_SIZES: Array<[number, number]> = [
  [4, 4],
  [4, 5],
  [4, 6],
  [5, 6],
];
const GRID_PHASES = [1300, 1300, 1300, 1300];

function MiniGrid({
  cols,
  rows,
  active,
}: {
  cols: number;
  rows: number;
  active: boolean;
}) {
  return (
    <motion.div
      animate={{ scale: active ? 1.12 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={
        "grid gap-[2px] rounded-lg p-1.5 ring-1 " +
        (active
          ? "bg-brand-50 ring-brand-300 dark:bg-brand-900/40 dark:ring-brand-600"
          : "bg-white/70 ring-slate-200 dark:bg-slate-800/70 dark:ring-slate-700")
      }
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      aria-hidden
    >
      {Array.from({ length: cols * rows }).map((_, i) => (
        <span
          key={i}
          className={
            "h-1.5 w-1.5 rounded-[2px] " +
            (active
              ? "bg-brand-500 dark:bg-brand-400"
              : "bg-slate-300 dark:bg-slate-600")
          }
        />
      ))}
    </motion.div>
  );
}

/** Step 3: the four grids, the active one highlighted on a loop. */
function GridSizesDemo() {
  const active = useLoopPhase(GRID_PHASES);
  return (
    <div className="grid min-h-[22vh] place-items-center">
      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
        {GRID_SIZES.map(([c, r], i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <MiniGrid cols={c} rows={r} active={i === active} />
            <span
              className={
                "text-xs font-bold " +
                (i === active
                  ? "text-brand-700 dark:text-brand-300"
                  : "text-slate-400 dark:text-slate-500")
              }
            >
              {c}×{r}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SPEED_SYMBOLS = ["🍉", "🍉", "⭐️", "⭐️"];

/** Step 4: a cleared grid with a speed bonus floating up, on a loop. */
function SpeedDemo() {
  return (
    <div className="grid min-h-[22vh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="grid w-36 grid-cols-2 gap-2">
            {SPEED_SYMBOLS.map((s, i) => (
              <DemoCard key={i} symbol={s} state="matched" />
            ))}
          </div>
          <motion.div
            className="absolute -right-3 -top-2 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-black text-amber-950 shadow-soft"
            animate={{ y: [4, -12, 4], opacity: [0, 1, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
            aria-hidden
          >
            +150 ⚡
          </motion.div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="chip">⏱ 5:00 total</span>
          <span className="chip bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800">
            faster clear = bigger bonus
          </span>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

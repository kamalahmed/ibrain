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
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  cols: number;
  rows: number;
  targetSeconds: number;
};

const SESSION_SECONDS = 300;
const POINTS_PER_MATCH = 30;
const LEVEL_CLEAR_BASE = 150;
const MISMATCH_HIDE_MS = 700;

const SYMBOLS = [
  "🍎", "🚀", "🌈", "🐙", "🎲", "🎵", "⚓️", "🌸",
  "🍉", "🐝", "⭐️", "🍀", "🌙", "🔥", "💎", "🎯",
  "🎁", "🌊", "❄️", "🍋", "🏔️", "🦊",
];

const LEVELS: Level[] = [
  { id: 1, name: "4×4", cols: 4, rows: 4, targetSeconds: 30 },
  { id: 2, name: "4×5", cols: 4, rows: 5, targetSeconds: 45 },
  { id: 3, name: "4×6", cols: 4, rows: 6, targetSeconds: 60 },
  { id: 4, name: "5×6", cols: 5, rows: 6, targetSeconds: 80 },
  { id: 5, name: "6×6", cols: 6, rows: 6, targetSeconds: 100 },
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
      caption: "Flip two cards at a time.",
      stage: <MemoryDemo stage="mismatch" />,
    },
    {
      caption: "Same symbols stay revealed. Different symbols flip back.",
      stage: <MemoryDemo stage="match" />,
    },
    {
      caption:
        "Five grids: 4×4 → 4×5 → 4×6 → 5×6 → 6×6. Clear each to unlock the next.",
      stage: (
        <div className="grid min-h-[22vh] place-items-center rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <LevelProgress total={5} current={1} cleared={0} />
        </div>
      ),
    },
    {
      caption: "Faster clears = more points. You have 5 minutes total.",
      stage: <MemoryDemo stage="hidden" />,
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
          Five memory grids in one 5-minute session — 4×4, 4×5, 4×6, 5×6,
          and finally 6×6. Flip two cards at a time; matching pairs stay
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

function MemoryDemo({
  stage,
}: {
  stage: "hidden" | "mismatch" | "match";
}) {
  const tiles: Array<{ face: string | null; matched?: boolean }> = [
    { face: stage === "hidden" ? null : "🍎", matched: stage === "match" },
    { face: stage === "hidden" ? null : null },
    { face: stage === "hidden" ? null : null },
    {
      face: stage === "hidden" ? null : stage === "match" ? "🍎" : "🚀",
      matched: stage === "match",
    },
  ];
  return (
    <div className="mx-auto grid max-w-[16rem] grid-cols-2 gap-3">
      {tiles.map((t, i) => (
        <div
          key={i}
          className={
            "grid aspect-square place-items-center rounded-2xl text-3xl shadow-soft " +
            (t.matched
              ? "bg-emerald-100 ring-2 ring-emerald-300"
              : t.face
              ? "bg-white ring-1 ring-slate-200"
              : "bg-gradient-to-br from-brand-500 to-accent-teal text-white")
          }
        >
          {t.face ?? "?"}
        </div>
      ))}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

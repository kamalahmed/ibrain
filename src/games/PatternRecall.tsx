import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Transition } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { LevelComplete } from "@/components/LevelComplete";
import { GameHUD } from "@/components/GameHUD";
import { getGame } from "@/lib/games";
import { haptic } from "@/lib/haptics";
import { useStore } from "@/store/useStore";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

/** Where the round is inside a level: fireflies swirl in → stones glow for the
 *  look-time → fireflies lift off (stones dim) → the player recalls → the
 *  round ends in a celebration or a gentle reveal of the missed stones. */
type Stage = "swirl" | "glow" | "lift" | "recall" | "celebrate" | "reveal";

type StoneState = "idle" | "lit" | "found" | "wrong" | "missed";

type Level = {
  id: 1 | 2 | 3 | 4;
  /** Short name in the HUD row. */
  name: string;
  /** Named twist announced on the LevelComplete card. */
  twist: string;
  size: 3 | 4 | 5;
  /** Stones lit in rounds 1, 2, 3 of this level. */
  stones: [number, number, number];
  /** How long the fireflies hold the pattern lit. */
  lookMs: number;
  /** Wrong taps cost points on this level (L3+ only). */
  penalty: boolean;
};

const SESSION_SECONDS = 180; // 3-minute session
const ROUNDS_PER_LEVEL = 3;
const POINTS_PER_STONE = 10;
const PERFECT_BONUS = 20;
const LEVEL_CLEAR_BONUS = 25;
const WRONG_PENALTY = 5;
const MAX_WRONG = 3; // wrong taps before the round ends gently

const SWIRL_MS = 850; // fireflies fly in and land
const LIFT_MS = 480; // fireflies lift off, stones dim
const CELEBRATE_MS = 950;
const REVEAL_MS = 1500; // missed stones shown softly after a failed round
const WRONG_FLASH_MS = 420;
const PING_LIFE_MS = 900;
const LEVEL_DONE_MS = 1150;

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Warm up",
    twist: "Warm up — 3×3, three stones",
    size: 3,
    stones: [3, 3, 3],
    lookMs: 1400,
    penalty: false,
  },
  {
    id: 2,
    name: "Bigger garden",
    twist: "Bigger garden — 4×4, longer patterns",
    size: 4,
    stones: [4, 4, 5],
    lookMs: 1200,
    penalty: false,
  },
  {
    id: 3,
    name: "Quicker glimpse",
    twist: "Quicker glimpse — a 0.9s look, slips cost 5",
    size: 4,
    stones: [5, 5, 6],
    lookMs: 900,
    penalty: true,
  },
  {
    id: 4,
    name: "Master garden",
    twist: "Master garden — 5×5, up to 7 stones",
    size: 5,
    stones: [6, 6, 7],
    lookMs: 800,
    penalty: true,
  },
];

/** Night-garden backdrop: deep indigo sky fading into teal foliage. Used as a
 *  CSS fallback behind the SVG scene (the SVG paints the same gradient). */
const NIGHT_BG =
  "linear-gradient(172deg, #2b2a6a 0%, #1d2a5e 42%, #0b4441 100%)";

const GRID_COLS: Record<number, string> = {
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

/* ---------------- Pebble art (deterministic, SSR-safe) ---------------- */

/** Slightly irregular pebble outlines in 40×40 local space, centred at 20,20.
 *  Four variants so neighbouring stones never look stamped from one mould. */
const PEBBLES = [
  "M20.5 4.6 C28.8 4.1 35.6 9.8 36.1 18 C36.6 26.6 30.6 34.8 21.4 35.4 C12.4 36 4.6 29.8 4.2 20.9 C3.8 12.2 11.9 5.1 20.5 4.6 Z",
  "M19.2 5.2 C27.4 3.6 35.9 8.9 36.4 17.6 C36.9 25.9 31.5 34.5 22.5 35.6 C13.8 36.7 5.1 31.1 4.1 22.3 C3.1 13.8 10.8 6.8 19.2 5.2 Z",
  "M21.3 4.3 C30 5 36.6 11.4 35.9 20.1 C35.2 28.6 28.6 35.9 19.8 35.7 C11.2 35.5 4.3 28.8 4.4 20 C4.5 11.3 12.4 3.6 21.3 4.3 Z",
  "M20 5 C28.4 4.2 34.9 10.8 35.7 18.8 C36.5 27 31 34.3 22.3 35.5 C13.5 36.7 5.5 30.6 4.5 21.8 C3.6 13.4 11.4 5.8 20 5 Z",
];

/** Tiny moss speckles per pebble variant (local 40×40 coords). */
const SPECKLES: [number, number][][] = [
  [
    [14, 17],
    [24, 24],
    [18, 27],
  ],
  [
    [15, 24],
    [23, 15],
    [27, 25],
  ],
  [
    [13, 20],
    [21, 28],
    [26, 14],
  ],
  [
    [16, 14],
    [12, 26],
    [25, 21],
  ],
];

const stoneVariant = (i: number) => (i * 7 + 3) % PEBBLES.length;
const stoneRotation = (i: number) => ((i * 37) % 5) * 72;

/** Centre of grid cell `i` as a percentage of the (square) board box. */
function cellCenter(i: number, size: number): { x: number; y: number } {
  return {
    x: (((i % size) + 0.5) / size) * 100,
    y: ((Math.floor(i / size) + 0.5) / size) * 100,
  };
}

function pickDistinct(k: number, total: number): number[] {
  const all = Array.from({ length: total }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, k);
}

/* ---------------- Fireflies ---------------- */

type Fly = {
  /** Random entry point around the garden edge. */
  sx: number;
  sy: number;
  /** Curved waypoint so the flight reads as a swirl, not a beeline. */
  cx: number;
  cy: number;
  /** Landing spot — the centre of the stone this firefly lights. */
  tx: number;
  ty: number;
  delay: number;
};

function makeFly(stoneIdx: number, order: number, size: number): Fly {
  const { x: tx, y: ty } = cellCenter(stoneIdx, size);
  const edge = Math.random();
  let sx: number;
  let sy: number;
  if (edge < 0.33) {
    sx = -8 - Math.random() * 6;
    sy = 10 + Math.random() * 60;
  } else if (edge < 0.66) {
    sx = 108 + Math.random() * 6;
    sy = 10 + Math.random() * 60;
  } else {
    sx = Math.random() * 100;
    sy = -10 - Math.random() * 6;
  }
  return {
    sx,
    sy,
    cx: (sx + tx) / 2 + (Math.random() - 0.5) * 26,
    cy: (sy + ty) / 2 - (6 + Math.random() * 10),
    tx,
    ty,
    delay: order * 0.06,
  };
}

type Ping = {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: "ok" | "bad";
  born: number;
};

/* =============================================================== */

export default function PatternRecall() {
  const game = getGame("pattern");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [stage, setStage] = useState<Stage>("swirl");
  const [levelIdx, setLevelIdx] = useState(0);
  const [round, setRound] = useState(0);
  const [pattern, setPattern] = useState<number[]>([]);
  const [found, setFound] = useState<Set<number>>(() => new Set());
  const [flies, setFlies] = useState<Fly[]>([]);
  const [wrong, setWrong] = useState<{ idx: number; key: number } | null>(null);
  const [roundResult, setRoundResult] = useState<"perfect" | "clear" | "missed">(
    "clear"
  );
  const [pings, setPings] = useState<Ping[]>([]);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);

  const scoreRef = useRef(0);
  const levelPointsRef = useRef(0);
  const clearedRef = useRef(0);
  const perfectRoundsRef = useRef(0);
  const patternRef = useRef<number[]>([]);
  const foundRef = useRef<Set<number>>(new Set());
  const wrongsRef = useRef(0);
  const wrongKeyRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const timeoutsRef = useRef<number[]>([]);
  const pingIdRef = useRef(0);

  const level = LEVELS[levelIdx];
  const patternSet = useMemo(() => new Set(pattern), [pattern]);

  const stopTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  const clearTimers = () => {
    timeoutsRef.current.forEach((t) => window.clearTimeout(t));
    timeoutsRef.current = [];
  };

  /** Schedule a step of the round flow; silently dropped once the session has
   *  ended so stray timers can never resurrect a finished game. */
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      if (!endedRef.current) fn();
    }, ms);
    timeoutsRef.current.push(id);
  };

  useEffect(
    () => () => {
      stopTick();
      timeoutsRef.current.forEach((t) => window.clearTimeout(t));
    },
    []
  );

  const finishGame = (clearedAll: boolean) => {
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
    const { isBest: best } = recordPlay("pattern", final);
    setFinalScore(final);
    setIsBest(best);
    setPhase("done");
  };

  const addPing = (x: number, y: number, text: string, tone: "ok" | "bad") => {
    const ping: Ping = {
      id: ++pingIdRef.current,
      x,
      y,
      text,
      tone,
      born: Date.now(),
    };
    setPings((prev) => [...prev, ping]);
  };

  const startRound = (li: number, ri: number) => {
    const lvl = LEVELS[li];
    const total = lvl.size * lvl.size;
    const k = lvl.stones[ri];
    const idxs = pickDistinct(k, total);
    patternRef.current = idxs;
    foundRef.current = new Set();
    wrongsRef.current = 0;
    setPattern(idxs);
    setFound(new Set());
    setWrong(null);
    setRound(ri);
    setFlies(idxs.map((idx, j) => makeFly(idx, j, lvl.size)));
    setStage("swirl");
    later(() => setStage("glow"), SWIRL_MS);
    later(() => setStage("lift"), SWIRL_MS + lvl.lookMs);
    later(() => setStage("recall"), SWIRL_MS + lvl.lookMs + LIFT_MS);
  };

  const startLevel = (li: number) => {
    setLevelIdx(li);
    levelPointsRef.current = 0;
    setPings([]);
    setPhase("playing");
    startRound(li, 0);
  };

  const nextRound = (li: number, ri: number) => {
    if (ri + 1 < ROUNDS_PER_LEVEL) {
      startRound(li, ri + 1);
      return;
    }
    // level cleared
    scoreRef.current += LEVEL_CLEAR_BONUS;
    levelPointsRef.current += LEVEL_CLEAR_BONUS;
    setScore(scoreRef.current);
    clearedRef.current += 1;
    setLastCleared(LEVELS[li].id);
    setLastLevelScore(levelPointsRef.current);
    setPhase("levelDone");
    later(() => {
      if (li + 1 >= LEVELS.length) finishGame(true);
      else startLevel(li + 1);
    }, LEVEL_DONE_MS);
  };

  const onTapStone = (i: number) => {
    if (phase !== "playing" || stage !== "recall" || endedRef.current) return;
    if (foundRef.current.has(i)) return; // already found — harmless
    const lvl = LEVELS[levelIdx];
    const { x, y } = cellCenter(i, lvl.size);

    if (patternRef.current.includes(i)) {
      haptic.success();
      const nf = new Set(foundRef.current);
      nf.add(i);
      foundRef.current = nf;
      setFound(nf);
      scoreRef.current += POINTS_PER_STONE;
      levelPointsRef.current += POINTS_PER_STONE;
      setScore(scoreRef.current);
      addPing(x, y, `+${POINTS_PER_STONE}`, "ok");
      if (nf.size === patternRef.current.length) {
        const perfect = wrongsRef.current === 0;
        if (perfect) {
          perfectRoundsRef.current += 1;
          scoreRef.current += PERFECT_BONUS;
          levelPointsRef.current += PERFECT_BONUS;
          setScore(scoreRef.current);
          addPing(50, 38, `Perfect +${PERFECT_BONUS}`, "ok");
        }
        setRoundResult(perfect ? "perfect" : "clear");
        setStage("celebrate");
        const li = levelIdx;
        const ri = round;
        later(() => nextRound(li, ri), CELEBRATE_MS);
      }
      return;
    }

    // wrong stone: red flash + gentle shake; costs points only on L3+
    haptic.error();
    wrongsRef.current += 1;
    const key = ++wrongKeyRef.current;
    setWrong({ idx: i, key });
    later(
      () => setWrong((w) => (w && w.key === key ? null : w)),
      WRONG_FLASH_MS
    );
    if (lvl.penalty) {
      scoreRef.current = Math.max(0, scoreRef.current - WRONG_PENALTY);
      levelPointsRef.current -= WRONG_PENALTY;
      setScore(scoreRef.current);
      addPing(x, y, `-${WRONG_PENALTY}`, "bad");
    }
    if (wrongsRef.current >= MAX_WRONG) {
      // round ends gently — briefly show the stones that were missed
      setRoundResult("missed");
      setStage("reveal");
      const li = levelIdx;
      const ri = round;
      later(() => nextRound(li, ri), REVEAL_MS);
    }
  };

  const begin = () => {
    clearTimers();
    stopTick();
    scoreRef.current = 0;
    levelPointsRef.current = 0;
    clearedRef.current = 0;
    perfectRoundsRef.current = 0;
    endedRef.current = false;
    setScore(0);
    setPings([]);
    setLevelIdx(0);
    setRound(0);
    setTimeLeft(SESSION_SECONDS);
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
      // prune expired score pings
      setPings((prev) => {
        const nowMs = Date.now();
        const keep = prev.filter((p) => nowMs - p.born < PING_LIFE_MS + 150);
        return keep.length === prev.length ? prev : keep;
      });
      if (left <= 0) finishGame(false);
    }, 200);
    startLevel(0);
  };

  const stoneState = (i: number): StoneState => {
    if (wrong && wrong.idx === i) return "wrong";
    if (found.has(i)) return "found";
    if (stage === "glow" && patternSet.has(i)) return "lit";
    if (stage === "reveal" && patternSet.has(i)) return "missed";
    return "idle";
  };

  const cue =
    stage === "swirl" || stage === "glow"
      ? "Watch the fireflies…"
      : stage === "lift"
      ? "Remember the glow…"
      : stage === "recall"
      ? `Your turn — find ${pattern.length - found.size}`
      : stage === "celebrate"
      ? roundResult === "perfect"
        ? "Perfect!"
        : "Round clear!"
      : "These were the ones";

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Fireflies land and light up a few stones — watch where they glow.",
      stage: <DemoGarden mode="watch" prefix="pgA" />,
      auto: 4200,
    },
    {
      caption: "When they fly away, tap the glowing stones from memory — any order.",
      stage: <DemoGarden mode="recall" prefix="pgB" />,
      auto: 4000,
    },
    {
      caption: "Wrong stone? It just blinks — no harm early on. Gardens grow to 5×5.",
      stage: <DemoGarden mode="forgive" prefix="pgC" />,
    },
  ];

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four gardens in one 3-minute session. Each round, fireflies land and
          light a few stones — then lift off. Tap the stones that were lit, in
          any order. Three rounds per garden; grids grow from 3×3 to 5×5 and
          the glimpse gets shorter. Slips are free on the first two gardens.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startSession} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-3">
          <GameHUD
            levelTotal={LEVELS.length}
            levelCurrent={levelIdx + 1}
            levelsCleared={clearedRef.current}
            score={score}
            timeLeft={timeLeft}
            sessionSeconds={SESSION_SECONDS}
          />

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {level.name} · {level.size}×{level.size}
            </span>
            <span data-testid="progress">
              Round {Math.min(round + 1, ROUNDS_PER_LEVEL)} / {ROUNDS_PER_LEVEL}
            </span>
          </div>

          {phase === "levelDone" ? (
            <LevelComplete
              levelJustCleared={lastCleared}
              totalLevels={LEVELS.length}
              levelScore={lastLevelScore}
              nextLabel={LEVELS[lastCleared]?.twist}
            />
          ) : (
            <>
              <div
                className="relative mx-auto w-full max-w-md overflow-hidden rounded-3xl shadow-soft ring-1 ring-indigo-300/50 dark:ring-indigo-500/30"
                style={{ background: NIGHT_BG }}
              >
                <NightGarden prefix="pg" />

                {/* status cue — tells first-timers exactly what to do */}
                <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={cue}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className="rounded-full bg-slate-950/60 px-3 py-1 text-xs font-bold text-amber-100 ring-1 ring-amber-200/30 backdrop-blur"
                    >
                      {cue}
                    </motion.span>
                  </AnimatePresence>
                </div>

                <div className="relative z-10 px-3 pb-4 pt-10 sm:px-5 sm:pb-5">
                  <div className="rounded-2xl bg-slate-950/25 p-1.5 ring-1 ring-white/10 sm:p-2">
                    <div className="relative">
                      <div
                        data-testid="pattern-grid"
                        data-size={level.size}
                        aria-label={`Garden of ${level.size} by ${level.size} stones`}
                        className={`grid ${GRID_COLS[level.size]} gap-1.5 sm:gap-2`}
                      >
                        {Array.from(
                          { length: level.size * level.size },
                          (_, i) => (
                            <StoneTile
                              key={`${levelIdx}-${i}`}
                              i={i}
                              state={stoneState(i)}
                              onTap={onTapStone}
                              prefix="pg"
                            />
                          )
                        )}
                      </div>

                      {/* fireflies swirling in, hovering, lifting off */}
                      {(stage === "swirl" ||
                        stage === "glow" ||
                        stage === "lift") && (
                        <svg
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
                          aria-hidden
                        >
                          {flies.map((f, i) => (
                            <FireflyGlyph
                              key={`${levelIdx}-${round}-${i}`}
                              fly={f}
                              stage={stage}
                              i={i}
                              prefix="pg"
                            />
                          ))}
                        </svg>
                      )}

                      {/* perfect-round sparkle burst */}
                      {stage === "celebrate" && roundResult === "perfect" && (
                        <SparkleBurst />
                      )}

                      {/* floating score pings */}
                      <div className="pointer-events-none absolute inset-0 z-30">
                        {pings.map((p) => (
                          <div
                            key={p.id}
                            className="absolute"
                            style={{
                              left: `${p.x}%`,
                              top: `${p.y}%`,
                              transform: "translate(-50%, -50%)",
                            }}
                          >
                            <motion.div
                              initial={{ opacity: 0, y: 2, scale: 0.6 }}
                              animate={{
                                opacity: [0, 1, 1, 0],
                                y: -22,
                                scale: [0.6, 1.12, 1, 1],
                              }}
                              transition={{
                                duration: PING_LIFE_MS / 1000,
                                times: [0, 0.18, 0.7, 1],
                              }}
                            >
                              <span
                                className={
                                  "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-black shadow-soft ring-1 " +
                                  (p.tone === "ok"
                                    ? "bg-amber-300 text-indigo-950 ring-amber-200"
                                    : "bg-rose-500 text-white ring-rose-300")
                                }
                              >
                                {p.text}
                              </span>
                            </motion.div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                {level.penalty
                  ? `Careful — wrong stones cost ${WRONG_PENALTY} points here.`
                  : "Wrong stones just blink — no penalty on this garden."}
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
          detail={`${clearedRef.current} / ${LEVELS.length} gardens · ${
            perfectRoundsRef.current
          } perfect round${perfectRoundsRef.current === 1 ? "" : "s"}`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Shared SVG defs ---------------- */

function GardenDefs({ prefix }: { prefix: string }) {
  return (
    <defs>
      <radialGradient id={`${prefix}StoneIdle`} cx="0.35" cy="0.3" r="0.95">
        <stop offset="0%" stopColor="#9aa3c7" />
        <stop offset="55%" stopColor="#59618c" />
        <stop offset="100%" stopColor="#383e66" />
      </radialGradient>
      <radialGradient id={`${prefix}StoneLit`} cx="0.35" cy="0.3" r="0.95">
        <stop offset="0%" stopColor="#fff7d6" />
        <stop offset="55%" stopColor="#ffd166" />
        <stop offset="100%" stopColor="#ef9f2e" />
      </radialGradient>
      <radialGradient id={`${prefix}StoneWrong`} cx="0.35" cy="0.3" r="0.95">
        <stop offset="0%" stopColor="#fecdd3" />
        <stop offset="55%" stopColor="#fb7185" />
        <stop offset="100%" stopColor="#e11d48" />
      </radialGradient>
      <radialGradient id={`${prefix}StoneMiss`} cx="0.35" cy="0.3" r="0.95">
        <stop offset="0%" stopColor="#cffafe" />
        <stop offset="55%" stopColor="#67e8f9" />
        <stop offset="100%" stopColor="#0891b2" />
      </radialGradient>
      <radialGradient id={`${prefix}GlowWarm`}>
        <stop offset="0%" stopColor="#ffd166" stopOpacity="0.55" />
        <stop offset="100%" stopColor="#ffd166" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${prefix}GlowRed`}>
        <stop offset="0%" stopColor="#fb7185" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${prefix}GlowCyan`}>
        <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#67e8f9" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${prefix}FireGlow`}>
        <stop offset="0%" stopColor="#ffe9a3" stopOpacity="0.9" />
        <stop offset="55%" stopColor="#ffe9a3" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#ffe9a3" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

/* ---------------- Stone ---------------- */

/** The pebble itself, drawn in 40×40 local space. Shared by the game tiles
 *  and the tutorial demos so they are pixel-identical. */
function StoneGlyph({
  state,
  variant,
  rot,
  prefix,
}: {
  state: StoneState;
  variant: number;
  rot: number;
  prefix: string;
}) {
  const warm = state === "lit" || state === "found";
  const grad = warm
    ? "StoneLit"
    : state === "wrong"
    ? "StoneWrong"
    : state === "missed"
    ? "StoneMiss"
    : "StoneIdle";
  const glow = warm
    ? "GlowWarm"
    : state === "wrong"
    ? "GlowRed"
    : state === "missed"
    ? "GlowCyan"
    : null;
  const edge = warm
    ? "#b45309"
    : state === "wrong"
    ? "#9f1239"
    : state === "missed"
    ? "#0e7490"
    : "#20264a";
  return (
    <g>
      {glow && <circle cx="20" cy="20" r="19.5" fill={`url(#${prefix}${glow})`} />}
      <g transform={`rotate(${rot} 20 20)`}>
        {/* soft ground shadow under the pebble */}
        <ellipse cx="20.6" cy="23" rx="15.4" ry="13.6" fill="#050b16" opacity="0.35" />
        <path
          d={PEBBLES[variant]}
          fill={`url(#${prefix}${grad})`}
          stroke={edge}
          strokeWidth="0.9"
        />
        {/* emboss: top-left highlight + bottom shade */}
        <path
          d="M11.5 12 Q 17 7.5 25.5 9.3"
          stroke="#ffffff"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity={state === "idle" ? 0.22 : 0.5}
        />
        <path
          d="M10.5 28.5 Q 20 34.5 29.5 28"
          stroke="#0b1020"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.22"
        />
        {SPECKLES[variant].map(([sx, sy], k) => (
          <circle key={k} cx={sx} cy={sy} r="0.8" fill="#0b1020" opacity="0.2" />
        ))}
      </g>
    </g>
  );
}

function StoneTile({
  i,
  state,
  onTap,
  prefix,
}: {
  i: number;
  state: StoneState;
  onTap: (i: number) => void;
  prefix: string;
}) {
  return (
    <button
      type="button"
      data-testid="tile"
      data-state={state}
      aria-label={`Garden stone ${i + 1}`}
      onClick={() => onTap(i)}
      className="relative aspect-square min-h-[44px] touch-manipulation select-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80"
    >
      <motion.div
        className="h-full w-full"
        animate={
          state === "wrong"
            ? { x: [0, -3, 3, -2, 2, 0], scale: 1 }
            : state === "found"
            ? { x: 0, scale: [1.16, 1] }
            : state === "lit"
            ? { x: 0, scale: [1.08, 1] }
            : state === "missed"
            ? { x: 0, scale: [1, 1.06, 1] }
            : { x: 0, scale: 1 }
        }
        transition={{ duration: state === "wrong" ? 0.32 : 0.28 }}
      >
        <svg viewBox="0 0 40 40" className="h-full w-full overflow-visible" aria-hidden>
          <StoneGlyph
            state={state}
            variant={stoneVariant(i)}
            rot={stoneRotation(i)}
            prefix={prefix}
          />
        </svg>
      </motion.div>
    </button>
  );
}

/* ---------------- Firefly actor ---------------- */

/** Body + glow of one firefly, in local units (~4 wide). */
function FireflyBody({ prefix, flickerDur }: { prefix: string; flickerDur: number }) {
  return (
    <g>
      <motion.circle
        r="3.8"
        fill={`url(#${prefix}FireGlow)`}
        animate={{ opacity: [0.45, 1, 0.45] }}
        transition={{ duration: flickerDur, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* wings */}
      <motion.g
        animate={{ scaleY: [1, 0.55, 1] }}
        transition={{ duration: 0.24, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
      >
        <ellipse cx="-1" cy="-1.1" rx="1.15" ry="0.55" fill="#dbeafe" opacity="0.75" transform="rotate(-20)" />
        <ellipse cx="0.4" cy="-1.2" rx="1.15" ry="0.55" fill="#dbeafe" opacity="0.75" transform="rotate(14)" />
      </motion.g>
      {/* head + thorax */}
      <ellipse cx="-0.9" cy="0" rx="1.05" ry="0.75" fill="#3a3527" />
      {/* glowing abdomen */}
      <circle cx="0.75" cy="0.1" r="0.9" fill="#ffe89b" />
    </g>
  );
}

function FireflyGlyph({
  fly,
  stage,
  i,
  prefix,
}: {
  fly: Fly;
  stage: Stage;
  i: number;
  prefix: string;
}) {
  let anim: Record<string, number | number[]>;
  let trans: Transition;
  if (stage === "swirl") {
    anim = {
      x: [fly.sx, fly.cx, fly.tx],
      y: [fly.sy, fly.cy, fly.ty],
      opacity: [0, 1, 1],
    };
    trans = { duration: 0.75, delay: fly.delay, ease: "easeOut" };
  } else if (stage === "glow") {
    anim = { x: fly.tx, y: [fly.ty, fly.ty - 1.6, fly.ty], opacity: 1 };
    trans = { duration: 1.4, repeat: Infinity, ease: "easeInOut" };
  } else {
    anim = {
      x: fly.tx + (i % 2 === 0 ? -12 : 12),
      y: -16,
      opacity: 0,
    };
    trans = { duration: 0.55, ease: "easeIn" };
  }
  return (
    <motion.g
      initial={{ x: fly.sx, y: fly.sy, opacity: 0 }}
      animate={anim}
      transition={trans}
    >
      <FireflyBody prefix={prefix} flickerDur={0.9 + (i % 3) * 0.3} />
    </motion.g>
  );
}

/* ---------------- Perfect-round sparkle burst ---------------- */

function SparkleBurst() {
  const dirs = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
      aria-hidden
    >
      {dirs.map((a) => {
        const rad = (a * Math.PI) / 180;
        return (
          <motion.circle
            key={a}
            cx={50}
            cy={50}
            r={1.4}
            fill="#ffe89b"
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(rad) * 28,
              y: Math.sin(rad) * 28,
              opacity: 0,
              scale: 0.35,
            }}
            transition={{ duration: 0.75, ease: "easeOut" }}
          />
        );
      })}
    </svg>
  );
}

/* ---------------- Night-garden backdrop ---------------- */

type BgStar = {
  x: number;
  y: number;
  r: number;
  base: number;
  dur: number;
  delay: number;
  twinkle: boolean;
};

/** Indigo-to-teal night sky, silhouetted foliage along the bottom, a soft
 *  moon haze and a few ambient fireflies drifting through. Also hosts the
 *  shared gradient defs every stone and firefly references. */
function NightGarden({ prefix }: { prefix: string }) {
  const [stars] = useState<BgStar[]>(() =>
    Array.from({ length: 26 }, (_, i) => ({
      x: Math.random() * 100,
      y: Math.random() * 52,
      r: 0.2 + Math.random() * 0.45,
      base: 0.25 + Math.random() * 0.4,
      dur: 2.5 + Math.random() * 3,
      delay: Math.random() * 3,
      twinkle: i % 3 !== 0,
    }))
  );
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      aria-hidden
    >
      <GardenDefs prefix={prefix} />
      <defs>
        <linearGradient id={`${prefix}Sky`} x1="0" y1="0" x2="0.12" y2="1">
          <stop offset="0%" stopColor="#2f2c74" />
          <stop offset="45%" stopColor="#1d2a5e" />
          <stop offset="100%" stopColor="#0b4441" />
        </linearGradient>
        <radialGradient id={`${prefix}MoonHaze`}>
          <stop offset="0%" stopColor="#fdf3c8" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#fdf3c8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${prefix}Bush`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0d3340" />
          <stop offset="100%" stopColor="#061e26" />
        </linearGradient>
      </defs>

      <rect width="100" height="100" fill={`url(#${prefix}Sky)`} />
      <circle cx="17" cy="9" r="15" fill={`url(#${prefix}MoonHaze)`} />

      {/* stars */}
      {stars.map((s, i) =>
        s.twinkle ? (
          <motion.circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="#e0e7ff"
            animate={{ opacity: [s.base, 0.9, s.base] }}
            transition={{
              duration: s.dur,
              delay: s.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ) : (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#e0e7ff" opacity={s.base} />
        )
      )}

      {/* back bushes */}
      <path
        d="M0 90 Q 10 80 22 88 Q 34 80 48 89 Q 62 80 76 88 Q 88 82 100 90 L 100 100 L 0 100 Z"
        fill={`url(#${prefix}Bush)`}
        opacity="0.95"
      />
      {/* front grass silhouette */}
      <path
        d="M0 96 Q 14 90 26 95 Q 40 89 54 95 Q 68 90 82 95 Q 92 91 100 96 L 100 100 L 0 100 Z"
        fill="#051820"
      />
      {/* swaying grass blades along the bottom edge */}
      <GrassBlades />

      {/* ambient fireflies drifting through the garden */}
      <AmbientFirefly
        prefix={prefix}
        xs={[8, 26, 40, 8]}
        ys={[70, 58, 74, 70]}
        dur={16}
        delay={0}
      />
      <AmbientFirefly
        prefix={prefix}
        xs={[88, 68, 80, 88]}
        ys={[62, 74, 55, 62]}
        dur={19}
        delay={2}
      />
      <AmbientFirefly
        prefix={prefix}
        xs={[52, 66, 44, 52]}
        ys={[86, 78, 82, 86]}
        dur={14}
        delay={5}
      />
    </svg>
  );
}

function GrassBlades() {
  const blades = [];
  for (let i = 0; i < 12; i++) {
    const x = 3 + i * 8.6 + (i % 3);
    const len = 7 + ((i * 37) % 8);
    const lean = ((i * 53) % 10) - 5;
    const dur = 3.6 + ((i * 29) % 25) / 10;
    blades.push({ x, len, lean, dur, delay: (i % 4) * 0.4 });
  }
  return (
    <g opacity="0.85">
      {blades.map((b, i) => (
        <motion.path
          key={i}
          d={`M ${b.x} 100 Q ${b.x + b.lean / 2} ${100 - b.len / 2} ${
            b.x + b.lean
          } ${100 - b.len}`}
          stroke="#0a2b31"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
          style={{ transformOrigin: `${b.x}px 100px` }}
          animate={{ rotate: [-3, 3, -3] }}
          transition={{
            duration: b.dur,
            repeat: Infinity,
            ease: "easeInOut",
            delay: b.delay,
          }}
        />
      ))}
    </g>
  );
}

function AmbientFirefly({
  prefix,
  xs,
  ys,
  dur,
  delay,
}: {
  prefix: string;
  xs: number[];
  ys: number[];
  dur: number;
  delay: number;
}) {
  return (
    <motion.g
      initial={{ x: xs[0], y: ys[0] }}
      animate={{ x: xs, y: ys }}
      transition={{ duration: dur, repeat: Infinity, ease: "easeInOut", delay }}
    >
      <circle r="2.4" fill={`url(#${prefix}FireGlow)`} />
      <motion.circle
        r="0.8"
        fill="#ffe89b"
        animate={{ opacity: [0.25, 1, 0.25] }}
        transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.g>
  );
}

/* ---------------- Tutorial demo garden ---------------- */

/** 3×3 demo stones laid out in a 100×66 mini scene. */
const DEMO_STONES: { x: number; y: number }[] = [
  { x: 33, y: 15 },
  { x: 50, y: 15 },
  { x: 67, y: 15 },
  { x: 33, y: 32 },
  { x: 50, y: 32 },
  { x: 67, y: 32 },
  { x: 33, y: 49 },
  { x: 50, y: 49 },
  { x: 67, y: 49 },
];
const DEMO_PATTERN = [0, 4, 5];
const DEMO_WRONG = 6;
const DEMO_FLY_STARTS = [
  { x: -8, y: 8 },
  { x: 108, y: 20 },
  { x: 50, y: -10 },
];

/** Auto-playing mini demos built from the same stone + firefly art:
 *  watch  — fireflies land, stones glow, fireflies leave, stones dim
 *  recall — a ghost finger taps the pattern back, +10 pings fire
 *  forgive — a wrong tap blinks red harmlessly, then grids grow 3×3→5×5 */
function DemoGarden({
  mode,
  prefix,
}: {
  mode: "watch" | "recall" | "forgive";
  prefix: string;
}) {
  const steps = mode === "watch" ? 4 : 5;
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((v) => v + 1), 1050);
    return () => window.clearInterval(id);
  }, []);
  const step = t % steps;
  const cycle = Math.floor(t / steps);

  const stateFor = (i: number): StoneState => {
    if (mode === "watch") {
      return step === 2 && DEMO_PATTERN.includes(i) ? "lit" : "idle";
    }
    if (mode === "recall") {
      const tapped = DEMO_PATTERN.slice(0, Math.min(Math.max(step, 0), 3));
      return tapped.includes(i) ? "found" : "idle";
    }
    // forgive
    if (i === DEMO_WRONG && step === 2) return "wrong";
    if (i === DEMO_PATTERN[0] && step >= 3) return "found";
    return "idle";
  };

  // ghost finger target for the tap demos
  const fingerAt =
    mode === "recall" && step >= 1 && step <= 3
      ? DEMO_STONES[DEMO_PATTERN[Math.min(step - 1, 2)]]
      : mode === "forgive" && (step === 1 || step === 2)
      ? DEMO_STONES[DEMO_WRONG]
      : mode === "forgive" && step === 3
      ? DEMO_STONES[DEMO_PATTERN[0]]
      : null;

  return (
    <div
      className="relative mx-auto aspect-[3/2] w-full max-w-sm overflow-hidden rounded-3xl shadow-soft ring-1 ring-indigo-300/50 dark:ring-indigo-500/30"
      style={{ background: NIGHT_BG }}
    >
      <svg
        viewBox="0 0 100 66"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        <GardenDefs prefix={prefix} />
        <defs>
          <linearGradient id={`${prefix}DSky`} x1="0" y1="0" x2="0.12" y2="1">
            <stop offset="0%" stopColor="#2f2c74" />
            <stop offset="48%" stopColor="#1d2a5e" />
            <stop offset="100%" stopColor="#0b4441" />
          </linearGradient>
        </defs>
        <rect width="100" height="66" fill={`url(#${prefix}DSky)`} />
        {/* a few static stars */}
        {[
          [12, 6],
          [30, 10],
          [58, 5],
          [82, 9],
          [92, 22],
          [8, 26],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="0.4" fill="#e0e7ff" opacity="0.55" />
        ))}
        {/* foliage silhouette */}
        <path
          d="M0 60 Q 12 54 26 59 Q 42 53 58 59 Q 74 54 88 59 Q 94 56 100 60 L 100 66 L 0 66 Z"
          fill="#051820"
        />

        {/* stones */}
        {DEMO_STONES.map((p, i) => (
          <g key={i} transform={`translate(${p.x - 8} ${p.y - 8}) scale(0.4)`}>
            <StoneGlyph
              state={stateFor(i)}
              variant={stoneVariant(i)}
              rot={stoneRotation(i)}
              prefix={prefix}
            />
          </g>
        ))}

        {/* fireflies (watch mode) */}
        {mode === "watch" &&
          step >= 1 &&
          DEMO_PATTERN.map((stoneIdx, i) => {
            const to = DEMO_STONES[stoneIdx];
            const from = DEMO_FLY_STARTS[i];
            const anim =
              step === 1
                ? { x: to.x, y: to.y, opacity: 1 }
                : step === 2
                ? { x: to.x, y: [to.y, to.y - 1.5, to.y], opacity: 1 }
                : { x: to.x + (i % 2 === 0 ? -10 : 10), y: -10, opacity: 0 };
            const trans: Transition =
              step === 1
                ? { duration: 0.8, delay: i * 0.12, ease: "easeOut" }
                : step === 2
                ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.5, ease: "easeIn" };
            return (
              <motion.g
                key={`${cycle}-${i}`}
                initial={{ x: from.x, y: from.y, opacity: 0 }}
                animate={anim}
                transition={trans}
              >
                <FireflyBody prefix={prefix} flickerDur={1 + i * 0.25} />
              </motion.g>
            );
          })}

        {/* ghost finger */}
        {fingerAt && (
          <motion.g
            initial={false}
            animate={{ x: fingerAt.x, y: fingerAt.y }}
            transition={{ type: "spring", stiffness: 120, damping: 16 }}
          >
            <circle
              r="6"
              fill="rgba(255,255,255,0.16)"
              stroke="rgba(255,255,255,0.65)"
              strokeWidth="0.5"
            />
            <circle r="1.6" fill="rgba(255,255,255,0.85)" />
          </motion.g>
        )}

        {/* +10 ping on each recall tap */}
        {mode === "recall" && step >= 1 && step <= 3 && (
          <DemoChip
            key={`ping-${t}`}
            x={DEMO_STONES[DEMO_PATTERN[Math.min(step - 1, 2)]].x}
            y={DEMO_STONES[DEMO_PATTERN[Math.min(step - 1, 2)]].y - 9}
            text="+10"
            tone="ok"
          />
        )}
        {mode === "recall" && step === 4 && (
          <DemoChip key={`perfect-${cycle}`} x={50} y={8} text="Perfect +20" tone="ok" />
        )}
        {mode === "forgive" && step === 2 && (
          <DemoChip key={`oops-${cycle}`} x={DEMO_STONES[DEMO_WRONG].x} y={DEMO_STONES[DEMO_WRONG].y - 9} text="no harm" tone="soft" />
        )}
        {mode === "forgive" && step === 3 && (
          <DemoChip key={`plus-${cycle}`} x={DEMO_STONES[DEMO_PATTERN[0]].x} y={DEMO_STONES[DEMO_PATTERN[0]].y - 9} text="+10" tone="ok" />
        )}

        {/* grid-growth preview */}
        {mode === "forgive" && step === 4 && (
          <motion.g
            key={`grow-${cycle}`}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            {[3, 4, 5].map((n, k) => {
              const bx = 24 + k * 20;
              const cell = 13 / n;
              return (
                <g key={n} transform={`translate(${bx} 4)`}>
                  <rect
                    width="13"
                    height="13"
                    rx="2.5"
                    fill="rgba(2,6,23,0.45)"
                    stroke="rgba(255,231,163,0.5)"
                    strokeWidth="0.4"
                  />
                  {Array.from({ length: n * n }, (_, d) => (
                    <circle
                      key={d}
                      cx={((d % n) + 0.5) * cell}
                      cy={(Math.floor(d / n) + 0.5) * cell}
                      r={cell * 0.22}
                      fill="#cbd5e1"
                      opacity="0.8"
                    />
                  ))}
                  <text
                    x="6.5"
                    y="17.5"
                    textAnchor="middle"
                    fontSize="3.4"
                    fontWeight="700"
                    fill="#e0e7ff"
                  >
                    {n}×{n}
                  </text>
                </g>
              );
            })}
          </motion.g>
        )}
      </svg>
    </div>
  );
}

/** A small floating label chip used inside the demo SVGs. */
function DemoChip({
  x,
  y,
  text,
  tone,
}: {
  x: number;
  y: number;
  text: string;
  tone: "ok" | "soft";
}) {
  const w = 6 + text.length * 2.6;
  return (
    <motion.g
      initial={{ opacity: 0, y: y + 3 }}
      animate={{ opacity: [0, 1, 1, 0], y: y - 4 }}
      transition={{ duration: 1.4, times: [0, 0.2, 0.75, 1] }}
    >
      <rect
        x={x - w / 2}
        y={-4}
        width={w}
        height={8}
        rx={4}
        fill={tone === "ok" ? "#fcd34d" : "rgba(226,232,240,0.9)"}
      />
      <text
        x={x}
        y={0.2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="4"
        fontWeight="900"
        fill="#1e1b4b"
      >
        {text}
      </text>
    </motion.g>
  );
}

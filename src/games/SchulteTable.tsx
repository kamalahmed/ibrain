import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { motion, useAnimationControls } from "framer-motion";
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

type Level = {
  id: 1 | 2 | 3 | 4;
  /** Short name shown in the HUD row. */
  name: string;
  /** Named twist announced on the LevelComplete card. */
  twist: string;
  size: 5 | 6;
  colored: boolean;
  /** Target time in seconds for full speed bonus. */
  targetSeconds: number;
};

const SESSION_SECONDS = 180; // 3-minute session
const POINTS_PER_TAP = 3;
const LEVEL_CLEAR_BASE = 100;
const PING_LIFE_MS = 900;
const FLOURISH_MS = 750; // constellation-complete glow before LevelComplete
const LEVEL_DONE_MS = 1100;

const LEVELS: Level[] = [
  {
    id: 1,
    name: "5×5 sky",
    twist: "5×5 sky — your first constellation",
    size: 5,
    colored: false,
    targetSeconds: 30,
  },
  {
    id: 2,
    name: "5×5 nebula",
    twist: "5×5 nebula — colours appear",
    size: 5,
    colored: true,
    targetSeconds: 40,
  },
  {
    id: 3,
    name: "6×6 sky",
    twist: "6×6 sky — the sky grows",
    size: 6,
    colored: false,
    targetSeconds: 55,
  },
  {
    id: 4,
    name: "6×6 nebula",
    twist: "6×6 nebula — colours + size",
    size: 6,
    colored: true,
    targetSeconds: 70,
  },
];

/** The night-sky backdrop shared by the game scene and the tutorial demos.
 *  Deliberately dark in light mode too — it's a night sky. */
const SKY_BG =
  "linear-gradient(168deg, #312e81 0%, #1e1b4b 44%, #0c0830 100%)";

function shuffled(total: number): number[] {
  const arr = Array.from({ length: total }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------------- Nebula tints (colour-distraction levels) ---------------- */

type Tint = { glow: string; edge: string; core: string };

const NEBULA_TINTS: Tint[] = [
  // rose
  {
    glow: "rgba(251,113,133,0.42)",
    edge: "rgba(253,164,175,0.55)",
    core: "rgba(251,113,133,0.24)",
  },
  // amber
  {
    glow: "rgba(252,211,77,0.40)",
    edge: "rgba(253,230,138,0.55)",
    core: "rgba(252,211,77,0.20)",
  },
  // emerald
  {
    glow: "rgba(52,211,153,0.42)",
    edge: "rgba(110,231,183,0.55)",
    core: "rgba(52,211,153,0.20)",
  },
  // sky
  {
    glow: "rgba(56,189,248,0.42)",
    edge: "rgba(125,211,252,0.55)",
    core: "rgba(56,189,248,0.20)",
  },
  // fuchsia
  {
    glow: "rgba(232,121,249,0.42)",
    edge: "rgba(240,171,252,0.55)",
    core: "rgba(232,121,249,0.20)",
  },
];

function randomTintIndexes(total: number): number[] {
  return Array.from({ length: total }, () =>
    Math.floor(Math.random() * NEBULA_TINTS.length)
  );
}

/** Inline styles for a star node in each of its states. Inline (not classes)
 *  because the nebula tints and layered glows need precise rgba control. */
function starVisual(
  lit: boolean,
  wrong: boolean,
  tint: Tint | null
): CSSProperties {
  if (wrong) {
    return {
      background:
        "radial-gradient(circle at 35% 30%, #ffe4e6, #fb7185 55%, #e11d48 92%)",
      boxShadow: "0 0 16px 4px rgba(244,63,94,0.60)",
      border: "1px solid rgba(254,205,211,0.85)",
      color: "#ffffff",
    };
  }
  if (lit) {
    return {
      background:
        "radial-gradient(circle at 35% 30%, #fffbe8, #fcd34d 58%, #f59e0b 96%)",
      boxShadow: "0 0 16px 4px rgba(252,211,77,0.55)",
      border: "1px solid rgba(254,243,199,0.9)",
      color: "#312e81",
    };
  }
  if (tint) {
    return {
      background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.30), ${tint.core} 55%, rgba(0,0,0,0) 74%)`,
      boxShadow: `0 0 14px 3px ${tint.glow}`,
      border: `1px solid ${tint.edge}`,
      color: "#eef2ff",
    };
  }
  return {
    background:
      "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.30), rgba(129,140,248,0.14) 55%, rgba(0,0,0,0) 74%)",
    boxShadow: "0 0 12px 2px rgba(165,180,252,0.30)",
    border: "1px solid rgba(199,210,254,0.35)",
    color: "#eef2ff",
  };
}

type Ping = { id: number; x: number; y: number; text: string; born: number };

export default function SchulteTable() {
  const game = getGame("schulte");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [grid, setGrid] = useState<number[]>(() => shuffled(25));
  const [tints, setTints] = useState<number[]>([]);
  const [next, setNext] = useState(1);
  const [wrongN, setWrongN] = useState<number | null>(null);
  const [flourish, setFlourish] = useState(false);
  const [pings, setPings] = useState<Ping[]>([]);
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
  const clearingRef = useRef(false); // between final tap and level transition
  const levelStartedAtRef = useRef(0);
  const timeoutsRef = useRef<number[]>([]);
  const wrongTimerRef = useRef<number | null>(null);
  const pingIdRef = useRef(0);

  const shakeControls = useAnimationControls();

  const currentLevel = LEVELS[levelIdx];
  const totalCells = currentLevel.size * currentLevel.size;

  const stopTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
  }, []);

  useEffect(
    () => () => {
      stopTick();
      timeoutsRef.current.forEach((t) => window.clearTimeout(t));
      if (wrongTimerRef.current !== null)
        window.clearTimeout(wrongTimerRef.current);
    },
    []
  );

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
    setTints(lvl.colored ? randomTintIndexes(total) : []);
    setNext(1);
    setWrongN(null);
    setFlourish(false);
    setPings([]);
    clearingRef.current = false;
    levelPointsRef.current = 0;
    levelStartedAtRef.current = Date.now();
    setLevelElapsed(0);
    setPhase("playing");
  }, []);

  const begin = () => {
    timeoutsRef.current.forEach((t) => window.clearTimeout(t));
    timeoutsRef.current = [];
    setScore(0);
    scoreRef.current = 0;
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    clearingRef.current = false;
    setLevelIdx(0);
    setNext(1);
    setFlourish(false);
    setPings([]);
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
      // prune expired score pings
      setPings((prev) => {
        const nowMs = Date.now();
        const keep = prev.filter((p) => nowMs - p.born < PING_LIFE_MS + 150);
        return keep.length === prev.length ? prev : keep;
      });
      if (left <= 0) end(false);
    }, 200);
    startLevel(0);
  };

  /** Centre of each star (percent of the grid box), keyed by its number. */
  const starPoints = useMemo(() => {
    const size = currentLevel.size;
    const pts = new Map<number, { x: number; y: number }>();
    grid.forEach((n, i) => {
      pts.set(n, {
        x: (((i % size) + 0.5) / size) * 100,
        y: ((Math.floor(i / size) + 0.5) / size) * 100,
      });
    });
    return pts;
  }, [grid, currentLevel.size]);

  /** Ordered points of the stars tapped so far — the constellation path. */
  const litPath = useMemo(() => {
    const litCount = Math.min(next - 1, totalCells);
    const out: { x: number; y: number }[] = [];
    for (let k = 1; k <= litCount; k++) {
      const p = starPoints.get(k);
      if (p) out.push(p);
    }
    return out;
  }, [next, starPoints, totalCells]);

  const addPing = (x: number, y: number, text: string) => {
    const ping: Ping = { id: ++pingIdRef.current, x, y, text, born: Date.now() };
    setPings((prev) => [...prev, ping]);
  };

  const onTap = (n: number) => {
    if (phase !== "playing" || clearingRef.current) return;
    if (n !== next) {
      // wrong star: red flash + gentle nudge, no penalty
      haptic.error();
      if (wrongTimerRef.current !== null)
        window.clearTimeout(wrongTimerRef.current);
      setWrongN(n);
      wrongTimerRef.current = window.setTimeout(() => setWrongN(null), 340);
      void shakeControls.start({
        x: [0, -5, 5, -3, 3, 0],
        transition: { duration: 0.3 },
      });
      return;
    }
    // correct tap
    haptic.success();
    scoreRef.current += POINTS_PER_TAP;
    levelPointsRef.current += POINTS_PER_TAP;
    setScore(scoreRef.current);
    const p = starPoints.get(n);
    const lvl = LEVELS[levelIdx];
    const total = lvl.size * lvl.size;
    if (n === total) {
      // constellation complete
      clearingRef.current = true;
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
      setNext(total + 1); // light the final star + full path
      setFlourish(true);
      if (p) addPing(p.x, p.y, `+${clearPts}`);
      const nextIdx = levelIdx + 1;
      later(() => {
        if (endedRef.current) return;
        setPhase("levelDone");
        later(() => {
          if (endedRef.current) return;
          if (nextIdx >= LEVELS.length) end(true);
          else startLevel(nextIdx);
        }, LEVEL_DONE_MS);
      }, FLOURISH_MS);
      return;
    }
    if (p) addPing(p.x, p.y, `+${POINTS_PER_TAP}`);
    setNext(n + 1);
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Tap the stars in number order — 1, 2, 3 — to draw the constellation.",
      stage: <DemoSky idPrefix="demoA" />,
      auto: 3800,
    },
    {
      caption: "Link every star to finish the constellation and bank a speed bonus.",
      stage: <DemoSky idPrefix="demoB" bonus />,
      auto: 3800,
    },
    {
      caption: "Later skies add nebula colours — ignore them and follow the numbers.",
      stage: <DemoSky idPrefix="demoC" tinted />,
      auto: 3600,
    },
    {
      caption: "Clear all four skies — 5×5 to 6×6 — inside 3 minutes.",
      stage: (
        <div
          className="relative mx-auto grid aspect-[3/2] w-full max-w-sm place-items-center overflow-hidden rounded-3xl ring-1 ring-indigo-300/60 shadow-soft dark:ring-indigo-500/30"
          style={{ background: SKY_BG }}
        >
          <NightSky idPrefix="demoD" />
          <div className="relative z-10 flex max-w-[16rem] flex-wrap items-center justify-center gap-2 px-4">
            {LEVELS.map((l) => (
              <span
                key={l.id}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-indigo-100 ring-1 ring-white/25 backdrop-blur"
              >
                {l.id} · {l.name}
              </span>
            ))}
          </div>
        </div>
      ),
    },
  ];

  const gridColsClass =
    currentLevel.size === 5 ? "grid-cols-5" : "grid-cols-6";
  const gridRowsClass =
    currentLevel.size === 5 ? "grid-rows-5" : "grid-rows-6";
  const numberSizeClass =
    currentLevel.size === 5 ? "text-lg sm:text-2xl" : "text-sm sm:text-lg";

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four night skies in one 3-minute session — 5×5 → 6×6, with
          nebula-colour distractions on skies 2 and 4. Tap the stars in number
          order to draw each constellation; complete it to unlock the next sky.
          Wrong taps never cost points — the star just flashes.
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

          {/* "next number" hint chip + level progress readout */}
          <div className="flex items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-950/90 px-3 py-1.5 text-sm font-bold shadow-soft ring-1 ring-indigo-400/40"
              data-testid="next-hint"
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                Next
              </span>
              <span aria-hidden className="text-amber-300">
                ✦
              </span>
              <span className="min-w-[1.5ch] text-center tabular-nums text-white">
                {next > totalCells ? "✓" : next}
              </span>
            </span>
            <span
              className="text-xs text-slate-500 dark:text-slate-400"
              data-testid="progress"
            >
              {currentLevel.name} · {levelElapsed.toFixed(1)}s · target{" "}
              {currentLevel.targetSeconds}s
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
            <div
              className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-3xl p-2 shadow-soft ring-1 ring-indigo-300/60 dark:ring-indigo-500/30 sm:p-3"
              style={{ background: SKY_BG }}
            >
              <NightSky idPrefix="sky" />

              {/* shaken on wrong taps; holds grid + line overlay + pings */}
              <motion.div
                animate={shakeControls}
                className="relative z-10 h-full w-full"
              >
                <div
                  role="grid"
                  aria-label={`Constellation grid level ${currentLevel.id}, tap ${Math.min(next, totalCells)} next`}
                  data-testid="schulte-grid"
                  data-size={currentLevel.size}
                  className={`grid h-full w-full ${gridColsClass} ${gridRowsClass}`}
                >
                  {grid.map((n, i) => {
                    const lit = n < next;
                    const wrong = wrongN === n;
                    const tint =
                      currentLevel.colored && !lit && !wrong
                        ? NEBULA_TINTS[tints[i] ?? 0]
                        : null;
                    return (
                      <motion.button
                        key={`${n}-${i}`}
                        type="button"
                        role="gridcell"
                        aria-label={`Star ${n}`}
                        data-testid="cell"
                        data-value={n}
                        onClick={() => onTap(n)}
                        className="relative min-h-[44px] select-none rounded-2xl outline-none touch-manipulation focus-visible:ring-2 focus-visible:ring-amber-300/80"
                        initial={{ opacity: 0, scale: 0.4 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.012, duration: 0.25 }}
                      >
                        <motion.span
                          className={`absolute inset-[7%] grid place-items-center rounded-full font-bold ${numberSizeClass}`}
                          style={starVisual(lit, wrong, tint)}
                          animate={
                            lit
                              ? flourish
                                ? { scale: [1, 1.16, 1] }
                                : { scale: [1.3, 1] }
                              : wrong
                              ? { scale: [0.85, 1] }
                              : { scale: 1 }
                          }
                          transition={
                            flourish
                              ? { duration: 0.55, delay: n * 0.015 }
                              : { duration: 0.25 }
                          }
                        >
                          {n}
                        </motion.span>
                      </motion.button>
                    );
                  })}
                </div>

                {/* constellation line overlay */}
                <svg
                  className="pointer-events-none absolute inset-0 z-20 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  {litPath.slice(1).map((p, j) => {
                    const a = litPath[j];
                    return (
                      <g key={j}>
                        <motion.line
                          x1={a.x}
                          y1={a.y}
                          x2={p.x}
                          y2={p.y}
                          stroke="#f59e0b"
                          strokeWidth={2.3}
                          strokeLinecap="round"
                          opacity={0.35}
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.22, ease: "easeOut" }}
                        />
                        <motion.line
                          x1={a.x}
                          y1={a.y}
                          x2={p.x}
                          y2={p.y}
                          stroke="#fde68a"
                          strokeWidth={0.7}
                          strokeLinecap="round"
                          opacity={0.95}
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.22, ease: "easeOut" }}
                        />
                      </g>
                    );
                  })}
                  {flourish && litPath.length >= 2 && (
                    <>
                      {/* bright pulse sweeping the whole constellation */}
                      <motion.polyline
                        points={litPath.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill="none"
                        stroke="#fffbeb"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0, opacity: 0.95 }}
                        animate={{ pathLength: 1, opacity: [0.95, 0.95, 0] }}
                        transition={{ duration: 0.7, ease: "easeOut" }}
                      />
                      <motion.circle
                        cx={litPath[litPath.length - 1].x}
                        cy={litPath[litPath.length - 1].y}
                        fill="none"
                        stroke="#fde68a"
                        strokeWidth={0.8}
                        initial={{ r: 2, opacity: 0.9 }}
                        animate={{ r: 14, opacity: 0 }}
                        transition={{ duration: 0.6, ease: "easeOut" }}
                      />
                    </>
                  )}
                </svg>

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
                          y: -24,
                          scale: [0.6, 1.12, 1, 1],
                        }}
                        transition={{
                          duration: PING_LIFE_MS / 1000,
                          times: [0, 0.18, 0.7, 1],
                        }}
                      >
                        <span className="whitespace-nowrap rounded-full bg-amber-300 px-2 py-0.5 text-xs font-black text-indigo-950 shadow-soft ring-1 ring-amber-200">
                          {p.text}
                        </span>
                      </motion.div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          )}

          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Wrong star? It just flashes — no penalty.
          </p>
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} constellations`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Night sky backdrop ---------------- */

type BgStar = {
  x: number;
  y: number;
  r: number;
  base: number;
  dur: number;
  delay: number;
  twinkle: boolean;
};

/** Twinkling background stars, two soft nebulae, a crescent moon and the
 *  occasional shooting star. Purely decorative — pointer-events none. */
function NightSky({ idPrefix }: { idPrefix: string }) {
  const [stars] = useState<BgStar[]>(() =>
    Array.from({ length: 42 }, (_, i) => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      r: 0.2 + Math.random() * 0.5,
      base: 0.2 + Math.random() * 0.45,
      dur: 2 + Math.random() * 3.5,
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
      <defs>
        <radialGradient id={`${idPrefix}NebA`}>
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${idPrefix}NebB`}>
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${idPrefix}MoonGlow`}>
          <stop offset="0%" stopColor="#fdf3c8" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#fdf3c8" stopOpacity="0" />
        </radialGradient>
        <mask id={`${idPrefix}MoonMask`}>
          <rect x="78" y="1" width="20" height="20" fill="white" />
          <circle cx="90" cy="9.6" r="3.6" fill="black" />
        </mask>
      </defs>

      {/* nebulae */}
      <ellipse cx="24" cy="26" rx="34" ry="22" fill={`url(#${idPrefix}NebA)`} />
      <ellipse cx="80" cy="76" rx="36" ry="26" fill={`url(#${idPrefix}NebB)`} />

      {/* background stars */}
      {stars.map((s, i) =>
        s.twinkle ? (
          <motion.circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="#e0e7ff"
            animate={{ opacity: [s.base, 0.95, s.base] }}
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

      {/* crescent moon */}
      <circle cx="88" cy="11" r="9" fill={`url(#${idPrefix}MoonGlow)`} />
      <circle
        cx="88"
        cy="11"
        r="4.2"
        fill="#f8edcd"
        mask={`url(#${idPrefix}MoonMask)`}
      />

      {/* occasional shooting star */}
      <motion.line
        x1="-10"
        y1="8"
        x2="-2"
        y2="12"
        stroke="#f5f3ff"
        strokeWidth="0.4"
        strokeLinecap="round"
        animate={{ x: [0, 115], y: [0, 46], opacity: [0, 0.9, 0] }}
        transition={{
          duration: 1.3,
          repeat: Infinity,
          repeatDelay: 6.5,
          ease: "easeOut",
          delay: 2,
        }}
      />
    </svg>
  );
}

/* ---------------- Tutorial demo sky ---------------- */

const DEMO_STARS = [
  { n: 1, x: 15, y: 52 },
  { n: 2, x: 33, y: 26 },
  { n: 3, x: 54, y: 40 },
  { n: 4, x: 73, y: 18 },
  { n: 5, x: 88, y: 46 },
];
const DEMO_TINTS = [0, 3, 2, 4, 1];

/** Auto-playing mini constellation: a ghost finger taps 1→5, lines draw in,
 *  the finished path pulses, then the loop restarts. */
function DemoSky({
  idPrefix,
  tinted = false,
  bonus = false,
}: {
  idPrefix: string;
  tinted?: boolean;
  bonus?: boolean;
}) {
  // step 0: sky idle · steps 1–5: stars light in order · step 6: flourish
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setStep((s) => (s >= 6 ? 0 : s + 1)),
      950
    );
    return () => window.clearInterval(id);
  }, []);

  const litCount = Math.min(step, 5);
  const target = DEMO_STARS[Math.min(litCount, 4)];
  const flourish = step >= 6;
  const pts = DEMO_STARS.slice(0, litCount);

  return (
    <div
      className="relative mx-auto aspect-[3/2] w-full max-w-sm overflow-hidden rounded-3xl shadow-soft ring-1 ring-indigo-300/60 dark:ring-indigo-500/30"
      style={{ background: SKY_BG }}
    >
      <NightSky idPrefix={idPrefix} />
      <svg
        viewBox="0 0 100 66"
        preserveAspectRatio="none"
        className="absolute inset-0 z-10 h-full w-full"
        aria-hidden
      >
        <defs>
          <radialGradient id={`${idPrefix}Lit`} cx="0.35" cy="0.3" r="0.9">
            <stop offset="0%" stopColor="#fffbe8" />
            <stop offset="55%" stopColor="#fcd34d" />
            <stop offset="100%" stopColor="#f59e0b" />
          </radialGradient>
        </defs>

        {/* constellation lines */}
        {pts.slice(1).map((p, j) => {
          const a = DEMO_STARS[j];
          return (
            <g key={j}>
              <motion.line
                x1={a.x}
                y1={a.y}
                x2={p.x}
                y2={p.y}
                stroke="#f59e0b"
                strokeWidth={2.6}
                strokeLinecap="round"
                opacity={0.35}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
              <motion.line
                x1={a.x}
                y1={a.y}
                x2={p.x}
                y2={p.y}
                stroke="#fde68a"
                strokeWidth={0.8}
                strokeLinecap="round"
                opacity={0.95}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </g>
          );
        })}

        {flourish && (
          <motion.polyline
            points={DEMO_STARS.map((s) => `${s.x},${s.y}`).join(" ")}
            fill="none"
            stroke="#fffbeb"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0.95 }}
            animate={{ pathLength: 1, opacity: [0.95, 0.95, 0] }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        )}

        {/* star nodes */}
        {DEMO_STARS.map((s, i) => {
          const lit = s.n <= litCount;
          const tint = tinted && !lit ? NEBULA_TINTS[DEMO_TINTS[i]] : null;
          return (
            <DemoStar
              key={s.n}
              x={s.x}
              y={s.y}
              n={s.n}
              lit={lit}
              tint={tint}
              pulse={flourish}
              litFill={`url(#${idPrefix}Lit)`}
            />
          );
        })}

        {/* ghost finger drifting to the next star */}
        {!flourish && litCount < 5 && (
          <motion.g
            initial={false}
            animate={{ x: target.x, y: target.y }}
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

        {/* clear bonus chip on the flourish beat */}
        {bonus && flourish && (
          <motion.g
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: [0, 1, 1, 0], y: -6 }}
            transition={{ duration: 1.6, times: [0, 0.2, 0.75, 1] }}
          >
            <rect x="37" y="4" width="26" height="10" rx="5" fill="#fcd34d" />
            <text
              x="50"
              y="9.4"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="5"
              fontWeight="900"
              fill="#312e81"
            >
              +100
            </text>
          </motion.g>
        )}
      </svg>
    </div>
  );
}

function DemoStar({
  x,
  y,
  n,
  lit,
  tint,
  pulse,
  litFill,
}: {
  x: number;
  y: number;
  n: number;
  lit: boolean;
  tint: Tint | null;
  pulse: boolean;
  litFill: string;
}) {
  const halo = lit
    ? "rgba(252,211,77,0.40)"
    : tint
    ? tint.glow
    : "rgba(165,180,252,0.35)";
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="7.5" fill={halo} opacity="0.35" />
      <motion.g
        animate={
          lit
            ? pulse
              ? { scale: [1, 1.2, 1] }
              : { scale: [1.35, 1] }
            : { scale: 1 }
        }
        transition={{ duration: 0.4, delay: pulse ? n * 0.05 : 0 }}
        style={
          { transformBox: "fill-box", transformOrigin: "center" } as CSSProperties
        }
      >
        <circle
          r="4.6"
          fill={lit ? litFill : "rgba(255,255,255,0.12)"}
          stroke={lit ? "#fde68a" : tint ? tint.edge : "rgba(199,210,254,0.5)"}
          strokeWidth="0.45"
        />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="4.6"
          fontWeight="800"
          fill={lit ? "#312e81" : "#eef2ff"}
        >
          {n}
        </text>
      </motion.g>
    </g>
  );
}

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
import { haptic } from "@/lib/haptics";
import { useStore } from "@/store/useStore";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

const BOUNDS = { w: 100, h: 100 };
const BUCKET_REFILL_MS = 2000;
const PING_LIFE_MS = 850;
const GRAIN_LIFE_MS = 460;
const SESSION_SECONDS = 180; // 3-minute session
const LEVEL_CLEAR_BONUS = 50;

/** Body palette per level — the fish change colour as the ponds get harder. */
const LEVEL_FISH: { light: string; mid: string; dark: string }[] = [
  { light: "#ffe2c0", mid: "#ff9d4d", dark: "#e8621a" }, // coral
  { light: "#ffd0e8", mid: "#ff6fb0", dark: "#d83a86" }, // pink
  { light: "#ddc8ff", mid: "#a87dff", dark: "#6a34f5" }, // violet
  { light: "#fff0b0", mid: "#ffcb3d", dark: "#e09b00" }, // amber
  { light: "#ffc0c0", mid: "#ff6b6b", dark: "#dd2222" }, // red
];

const clampLevel = (i: number) => Math.max(0, Math.min(LEVEL_FISH.length - 1, i));

type Fish = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number; // facing angle in radians
  fed: boolean;
};

type LilyPad = {
  id: number;
  cx: number;
  cy: number;
  r: number;
  rotate: number; // baseline rotation in degrees
  flower: boolean;
};

type ReedBlade = {
  offset: number; // x offset of the blade base within the clump
  len: number;
  lean: number; // overall lean in degrees
  curve: number; // sideways curve of the tip
  w: number; // stroke width
  cattail: boolean;
};

type Reed = {
  id: number;
  x: number; // clump base x
  y: number; // clump base y (blades grow upward from here)
  blades: ReedBlade[];
  sway: number; // sway amplitude in degrees
  dur: number; // sway duration in seconds
};

type Ping = {
  id: number;
  x: number;
  y: number;
  text: string;
  color: "ok" | "bad";
  born: number;
};

/** A pellet of food arcing from the bucket up to a tapped fish. */
type Grain = {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  born: number;
};

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  count: number;
  /** Soft target for the speed bonus — NOT a deadline; the only clock is the
   *  3-minute session timer. */
  targetSeconds: number;
};

const LEVELS: Level[] = [
  { id: 1, name: "3 fish", count: 3, targetSeconds: 26 },
  { id: 2, name: "4 fish", count: 4, targetSeconds: 32 },
  { id: 3, name: "5 fish", count: 5, targetSeconds: 38 },
  { id: 4, name: "6 fish", count: 6, targetSeconds: 44 },
];

/** Fish shrink as later levels add more of them, so a crowded pond still fits. */
function fishSizeForLevel(levelIdx: number): number {
  return Math.max(5, 7.6 - levelIdx * 0.6);
}

function spawnFish(count: number, size: number): Fish[] {
  const fish: Fish[] = [];
  const margin = 12;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 4;
    fish.push({
      id: i,
      x: margin + Math.random() * (BOUNDS.w - margin * 2),
      y: margin + Math.random() * (BOUNDS.h - margin * 2),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      rot: angle,
      fed: false,
    });
  }
  return fish;
}

function spawnLilies(count: number, fishSize: number): LilyPad[] {
  const pads: LilyPad[] = [];
  const margin = 14;
  let attempts = 0;
  while (pads.length < count && attempts < 120) {
    attempts++;
    // Sized relative to the fish so one pad covers at most ~1.5 fish — never
    // two whole fish at once (fish shrink per level, so pads must too).
    const r = fishSize * (1.2 + Math.random() * 0.5);
    const cx = margin + Math.random() * (BOUNDS.w - margin * 2);
    const cy = margin + Math.random() * (BOUNDS.h - margin * 2);
    // avoid overlap with existing pads
    const tooClose = pads.some((p) => {
      const dx = p.cx - cx;
      const dy = p.cy - cy;
      return Math.hypot(dx, dy) < p.r + r + 4;
    });
    if (tooClose) continue;
    pads.push({
      id: pads.length,
      cx,
      cy,
      r,
      rotate: Math.random() * 360,
      flower: Math.random() < 0.45,
    });
  }
  return pads;
}

/**
 * Reed clumps line the shore (and creep inward on later levels). They are
 * purely visual cover — fish drift behind them and vanish from sight, so you
 * have to keep tracking the ones you can't see.
 */
function spawnReeds(levelIdx: number): Reed[] {
  const reeds: Reed[] = [];
  const count = 3 + levelIdx; // 3 → 7
  for (let i = 0; i < count; i++) {
    const edge = Math.random();
    let x: number;
    let y: number;
    if (edge < 0.55) {
      // bottom shore
      x = 6 + Math.random() * 88;
      y = 99 + Math.random() * 4;
    } else if (edge < 0.78) {
      // left shore
      x = -2 + Math.random() * 7;
      y = 28 + Math.random() * 68;
    } else {
      // right shore
      x = 95 + Math.random() * 7;
      y = 28 + Math.random() * 68;
    }
    const bladeCount = 3 + Math.floor(Math.random() * 4);
    const blades: ReedBlade[] = [];
    for (let b = 0; b < bladeCount; b++) {
      blades.push({
        offset: (b - (bladeCount - 1) / 2) * 1.7,
        len: 15 + Math.random() * 17,
        lean: (Math.random() - 0.5) * 16,
        curve: (Math.random() - 0.5) * 9,
        w: 1 + Math.random() * 1,
        cattail: Math.random() < 0.22,
      });
    }
    reeds.push({
      id: i,
      x,
      y,
      blades,
      sway: 2 + Math.random() * 2.5,
      dur: 3.5 + Math.random() * 2.5,
    });
  }
  return reeds;
}

export default function AttentionPond() {
  const game = getGame("pond");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [fish, setFish] = useState<Fish[]>([]);
  const [lilies, setLilies] = useState<LilyPad[]>([]);
  const [reeds, setReeds] = useState<Reed[]>([]);
  const [sessionTimeLeft, setSessionTimeLeft] = useState(SESSION_SECONDS);
  const [score, setScore] = useState(0);
  const [doubles, setDoubles] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [pings, setPings] = useState<Ping[]>([]);
  const [grains, setGrains] = useState<Grain[]>([]);
  const [bucketReady, setBucketReady] = useState(true);
  const [bucketProgress, setBucketProgress] = useState(1); // 0 refilling → 1 full
  const [bucketShake, setBucketShake] = useState(0);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);

  const fishRef = useRef<Fish[]>([]);
  const scoreRef = useRef(0);
  const levelPointsRef = useRef(0);
  const clearedRef = useRef(0);
  const bucketReadyRef = useRef(true);
  const bucketDeadlineRef = useRef(0);
  const pingsRef = useRef<Ping[]>([]);
  const pingIdRef = useRef(0);
  const grainsRef = useRef<Grain[]>([]);
  const grainIdRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const levelStartedAtRef = useRef(0); // performance.now() at level start
  const sessionDeadlineRef = useRef(0); // session deadline (Date.now base)
  const sessionTickRef = useRef<number | null>(null);
  const endedRef = useRef(false);

  const stopLoop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stopSessionTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  const finishGame = useCallback(
    (clearedAll: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopLoop();
      stopSessionTick();
      let final = scoreRef.current;
      if (clearedAll) {
        const remaining = Math.max(
          0,
          Math.floor((sessionDeadlineRef.current - Date.now()) / 1000)
        );
        final += remaining;
      }
      scoreRef.current = final;
      setScore(final);
      const { isBest: best } = recordPlay("pond", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  // Called only when every fish in the level has been fed — the level never
  // advances on its own. The 3-minute session timer is the only clock.
  const advanceLevel = useCallback(
    () => {
      stopLoop();
      const lvl = LEVELS[levelIdx];
      // speed bonus: clearing well under the level's soft target pays off
      const elapsedS =
        (performance.now() - levelStartedAtRef.current) / 1000;
      const speedBonus = Math.max(
        0,
        Math.round((lvl.targetSeconds - elapsedS) * 10)
      );
      const clearPts = LEVEL_CLEAR_BONUS + speedBonus;
      scoreRef.current += clearPts;
      levelPointsRef.current += clearPts;
      setScore(scoreRef.current);
      clearedRef.current += 1;
      setLastCleared(lvl.id);
      setLastLevelScore(levelPointsRef.current);
      const nextIdx = levelIdx + 1;
      setPhase("levelDone");
      if (nextIdx >= LEVELS.length) {
        window.setTimeout(() => finishGame(true), 1100);
      } else {
        window.setTimeout(() => startLevel(nextIdx), 1100);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finishGame, levelIdx]
  );

  const startLevel = useCallback((idx: number) => {
    const lvl = LEVELS[idx];
    const f = spawnFish(lvl.count, fishSizeForLevel(idx));
    const pads = spawnLilies(idx, fishSizeForLevel(idx)); // 0..4 pads per level
    const rds = spawnReeds(idx); // 3, 4, 5, 6, 7 per level
    setFish(f);
    setLilies(pads);
    setReeds(rds);
    fishRef.current = f;
    levelPointsRef.current = 0;
    levelStartedAtRef.current = performance.now();
    lastTickRef.current = performance.now();
    bucketReadyRef.current = true;
    setBucketReady(true);
    setBucketProgress(1);
    pingsRef.current = [];
    setPings([]);
    grainsRef.current = [];
    setGrains([]);
    setLevelIdx(idx);
    setPhase("playing");
  }, []);

  // Main game loop
  useEffect(() => {
    if (phase !== "playing") return;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      // --- fish movement (all fish move, fed or not) ---
      const next = fishRef.current.map((fi) => {
        let { x, y, vx, vy } = fi;
        x += vx * dt;
        y += vy * dt;

        const margin = fi.size * 0.6;
        if (x < margin) {
          x = margin;
          vx = Math.abs(vx);
        } else if (x > BOUNDS.w - margin) {
          x = BOUNDS.w - margin;
          vx = -Math.abs(vx);
        }
        if (y < margin) {
          y = margin;
          vy = Math.abs(vy);
        } else if (y > BOUNDS.h - margin) {
          y = BOUNDS.h - margin;
          vy = -Math.abs(vy);
        }

        if (Math.random() < 0.02) {
          const turn = (Math.random() - 0.5) * 0.9;
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          const nvx = vx * cos - vy * sin;
          const nvy = vx * sin + vy * cos;
          vx = nvx;
          vy = nvy;
        }

        const rot = Math.atan2(vy, vx);
        return { ...fi, x, y, vx, vy, rot };
      });
      fishRef.current = next;
      setFish(next);

      // --- bucket refill ---
      if (!bucketReadyRef.current) {
        const remaining = bucketDeadlineRef.current - now;
        if (remaining <= 0) {
          bucketReadyRef.current = true;
          setBucketReady(true);
          setBucketProgress(1);
        } else {
          setBucketProgress(1 - remaining / BUCKET_REFILL_MS);
        }
      }

      // --- ping cleanup ---
      const trimmed = pingsRef.current.filter((p) => now - p.born < PING_LIFE_MS);
      if (trimmed.length !== pingsRef.current.length) {
        pingsRef.current = trimmed;
        setPings(trimmed);
      }

      // --- grain cleanup ---
      const grainsLeft = grainsRef.current.filter(
        (g) => now - g.born < GRAIN_LIFE_MS
      );
      if (grainsLeft.length !== grainsRef.current.length) {
        grainsRef.current = grainsLeft;
        setGrains(grainsLeft);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => stopLoop();
  }, [phase]);

  const addPing = (x: number, y: number, text: string, color: "ok" | "bad") => {
    const ping: Ping = {
      id: ++pingIdRef.current,
      x,
      y,
      text,
      color,
      born: performance.now(),
    };
    pingsRef.current = [...pingsRef.current, ping];
    setPings(pingsRef.current);
  };

  const addGrain = (toX: number, toY: number) => {
    const grain: Grain = {
      id: ++grainIdRef.current,
      fromX: 50,
      fromY: 101, // just below the pond — reads as a toss from the bucket
      toX,
      toY,
      born: performance.now(),
    };
    grainsRef.current = [...grainsRef.current, grain];
    setGrains(grainsRef.current);
  };

  const tapFish = (id: number, e: React.PointerEvent) => {
    e.stopPropagation();
    if (phase !== "playing") return;
    if (!bucketReadyRef.current) {
      // no food — brief bucket shake
      haptic.tap();
      setBucketShake((n) => n + 1);
      return;
    }
    const hit = fishRef.current.find((f) => f.id === id);
    if (!hit) return;

    // consume food
    bucketReadyRef.current = false;
    setBucketReady(false);
    setBucketProgress(0);
    bucketDeadlineRef.current = performance.now() + BUCKET_REFILL_MS;

    if (hit.fed) {
      haptic.error();
      setDoubles((d) => d + 1);
      scoreRef.current = Math.max(0, scoreRef.current - 50);
      levelPointsRef.current -= 50;
      setScore(scoreRef.current);
      addPing(hit.x, hit.y, "-50", "bad");
      return;
    }

    haptic.success();
    scoreRef.current += 100;
    levelPointsRef.current += 100;
    setScore(scoreRef.current);
    addPing(hit.x, hit.y, "+100", "ok");
    addGrain(hit.x, hit.y);

    const next = fishRef.current.map((f) =>
      f.id === id ? { ...f, fed: true } : f
    );
    fishRef.current = next;
    setFish(next);
    if (next.every((f) => f.fed)) {
      advanceLevel();
    }
  };

  const begin = () => {
    scoreRef.current = 0;
    setScore(0);
    setDoubles(0);
    setLevelIdx(0);
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    endedRef.current = false;
    setSessionTimeLeft(SESSION_SECONDS);
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };
  const afterCountdown = () => {
    // kick off session timer
    sessionDeadlineRef.current = Date.now() + SESSION_SECONDS * 1000;
    setSessionTimeLeft(SESSION_SECONDS);
    stopSessionTick();
    sessionTickRef.current = window.setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((sessionDeadlineRef.current - Date.now()) / 1000)
      );
      setSessionTimeLeft(left);
      if (left <= 0) finishGame(false);
    }, 250);
    startLevel(0);
  };

  useEffect(() => () => stopSessionTick(), []);

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Fish drift around the pond. Tap each one to feed it.",
      stage: <DemoPond mode="intro" />,
    },
    {
      caption: "You have one feeding bucket — it refills every 2 seconds.",
      stage: <DemoPond mode="bucket" />,
    },
    {
      caption:
        "Fish all look the same, even after feeding. Remember which ones you've tapped!",
      stage: <DemoPond mode="identical" />,
    },
    {
      caption:
        "Fish slip under lily pads and behind the reeds — keep tracking the ones you can't see.",
      stage: <DemoPond mode="lily" />,
    },
  ];

  const fedCount = fish.filter((f) => f.fed).length;

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four ponds in one 3-minute session. Level 1 has 3 fish; by level 4
          there are 6 fish hiding among lily pads and reeds. Tap each fish
          exactly once — fed fish still look identical, so you have to
          remember. Clear each pond (all fish fed) to unlock the next.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={afterCountdown} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-3">
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
                  (sessionTimeLeft <= 15
                    ? "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800"
                    : "")
                }
                data-testid="timer"
              >
                {formatSessionTime(sessionTimeLeft)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>{LEVELS[levelIdx].name}</span>
            <span data-testid="fed-progress">
              fed {fedCount} / {fish.length}
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
              <Pond
                fish={fish}
                lilies={lilies}
                reeds={reeds}
                pings={pings}
                grains={grains}
                levelIdx={levelIdx}
                onTapFish={tapFish}
                showOverlay={false}
              />
              <Bucket
                ready={bucketReady}
                progress={bucketProgress}
                shakeKey={bucketShake}
              />
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
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${doubles} double-tap${doubles === 1 ? "" : "s"}`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Shared SVG defs ---------------- */

function PondDefs({ idPrefix }: { idPrefix: string }) {
  return (
    <defs>
      <radialGradient id={`${idPrefix}Water`} cx="0.34" cy="0.12" r="1.15">
        <stop offset="0%" stopColor="#aef0df" />
        <stop offset="38%" stopColor="#48c2a4" />
        <stop offset="72%" stopColor="#1c8e76" />
        <stop offset="100%" stopColor="#0a5644" />
      </radialGradient>
      <linearGradient id={`${idPrefix}Depth`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.12" />
        <stop offset="55%" stopColor="#0a5644" stopOpacity="0" />
        <stop offset="100%" stopColor="#06342a" stopOpacity="0.55" />
      </linearGradient>
      <radialGradient id={`${idPrefix}Vignette`} cx="0.5" cy="0.42" r="0.75">
        <stop offset="60%" stopColor="#06342a" stopOpacity="0" />
        <stop offset="100%" stopColor="#052a22" stopOpacity="0.5" />
      </radialGradient>
      <radialGradient id={`${idPrefix}Caustic`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%" stopColor="#eafff8" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#eafff8" stopOpacity="0" />
      </radialGradient>
      {LEVEL_FISH.map((c, i) => (
        <linearGradient
          key={i}
          id={`${idPrefix}Fish${i}`}
          x1="0"
          y1="-1"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={c.light} />
          <stop offset="55%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.dark} />
        </linearGradient>
      ))}
      <radialGradient id={`${idPrefix}LilyFill`} cx="0.35" cy="0.32" r="0.85">
        <stop offset="0%" stopColor="#7ee0bd" />
        <stop offset="55%" stopColor="#2fb48f" />
        <stop offset="100%" stopColor="#0c6b52" />
      </radialGradient>
      <radialGradient id={`${idPrefix}Flower`} cx="0.5" cy="0.4" r="0.6">
        <stop offset="0%" stopColor="#fff6fb" />
        <stop offset="55%" stopColor="#fbb6d4" />
        <stop offset="100%" stopColor="#ec6fa6" />
      </radialGradient>
      <linearGradient id={`${idPrefix}Reed`} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor="#1f7a52" />
        <stop offset="100%" stopColor="#76d39a" />
      </linearGradient>
      <linearGradient id={`${idPrefix}Grass`} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor="#0a5e44" />
        <stop offset="100%" stopColor="#1f9c70" />
      </linearGradient>
      <filter
        id={`${idPrefix}Blur`}
        x="-50%"
        y="-50%"
        width="200%"
        height="200%"
      >
        <feGaussianBlur stdDeviation="2.4" />
      </filter>
      <filter
        id={`${idPrefix}FishShade`}
        x="-40%"
        y="-40%"
        width="180%"
        height="180%"
      >
        <feGaussianBlur stdDeviation="0.7" />
      </filter>
    </defs>
  );
}

/* ---------------- Pond ---------------- */

function Pond({
  fish,
  lilies,
  reeds,
  pings,
  grains,
  levelIdx,
  onTapFish,
  showOverlay,
}: {
  fish: Fish[];
  lilies: LilyPad[];
  reeds: Reed[];
  pings: Ping[];
  grains: Grain[];
  levelIdx: number;
  onTapFish: (id: number, e: React.PointerEvent) => void;
  showOverlay: boolean;
}) {
  const fishLevel = clampLevel(levelIdx);
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-xl overflow-hidden rounded-3xl ring-1 ring-emerald-900/30 shadow-soft dark:ring-emerald-950"
      style={{ background: "#0a5644" }}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <PondDefs idPrefix="pond" />

        {/* water body + depth shading */}
        <rect width="100" height="100" fill="url(#pondWater)" />
        <rect width="100" height="100" fill="url(#pondDepth)" />

        {/* drifting light caustics */}
        <WaterCaustics idPrefix="pond" />

        {/* gentle surface current lines */}
        <g opacity="0.16" stroke="#eafff8" strokeWidth="0.25" fill="none">
          <path d="M5 30 Q 40 35 95 25" />
          <path d="M5 60 Q 50 70 95 55" />
          <path d="M8 85 Q 40 80 92 88" />
        </g>

        {/* submerged grass — behind the fish, for depth */}
        <UnderwaterGrass idPrefix="pond" />

        {/* fish layer */}
        <g>
          {fish.map((f) => (
            <FishGlyph
              key={f.id}
              fish={f}
              onTap={onTapFish}
              idPrefix="pond"
              level={fishLevel}
            />
          ))}
        </g>

        {/* lily pads — solid leaves the fish slip under */}
        <g>
          {lilies.map((p) => (
            <LilyPadShape key={p.id} pad={p} idPrefix="pond" />
          ))}
        </g>

        {/* reed clumps — shore cover the fish hide behind */}
        <g pointerEvents="none">
          {reeds.map((r) => (
            <ReedClump key={r.id} reed={r} idPrefix="pond" />
          ))}
        </g>

        {/* food pellets flying from the bucket to fed fish */}
        <g pointerEvents="none">
          {grains.map((g) => (
            <GrainGlyph key={g.id} grain={g} />
          ))}
        </g>

        {/* pings / ripples */}
        <g>
          {pings.map((p) => (
            <PingGlyph key={p.id} ping={p} />
          ))}
        </g>

        {/* atmospheric depth at the edges */}
        <rect
          width="100"
          height="100"
          fill="url(#pondVignette)"
          pointerEvents="none"
        />
      </svg>

      {showOverlay && (
        <div className="absolute inset-0 grid place-items-center bg-white/40 backdrop-blur-sm dark:bg-slate-900/40">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="rounded-2xl bg-white px-5 py-3 text-lg font-bold text-slate-900 shadow-soft dark:bg-slate-900 dark:text-white"
          >
            Nice!
          </motion.div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Water caustics ---------------- */

function WaterCaustics({ idPrefix }: { idPrefix: string }) {
  const blobs = [
    { cx: 28, cy: 26, rx: 24, ry: 15, dur: 13, dx: 9, dy: 6 },
    { cx: 72, cy: 58, rx: 27, ry: 17, dur: 17, dx: -11, dy: -7 },
    { cx: 48, cy: 82, rx: 21, ry: 13, dur: 15, dx: 7, dy: -9 },
  ];
  return (
    <g filter={`url(#${idPrefix}Blur)`} pointerEvents="none">
      {blobs.map((b, i) => (
        <motion.ellipse
          key={i}
          cx={b.cx}
          cy={b.cy}
          rx={b.rx}
          ry={b.ry}
          fill={`url(#${idPrefix}Caustic)`}
          animate={{
            x: [0, b.dx, 0],
            y: [0, b.dy, 0],
            opacity: [0.18, 0.42, 0.18],
          }}
          transition={{ duration: b.dur, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </g>
  );
}

/* ---------------- Underwater grass (background depth) ---------------- */

function UnderwaterGrass({ idPrefix }: { idPrefix: string }) {
  // A static row of swaying fronds along the pond floor. Decorative only —
  // it sits behind the fish, so it never blocks a tap.
  const blades = [];
  for (let i = 0; i < 14; i++) {
    const x = 3 + i * 7 + (i % 2) * 2;
    const len = 10 + ((i * 37) % 13);
    const lean = ((i * 53) % 14) - 7;
    const dur = 4 + ((i * 31) % 30) / 10;
    blades.push({ x, len, lean, dur, delay: (i % 5) * 0.3 });
  }
  return (
    <g opacity="0.5" pointerEvents="none">
      {blades.map((b, i) => (
        <motion.path
          key={i}
          d={`M ${b.x} 100 Q ${b.x + b.lean / 2} ${100 - b.len / 2} ${
            b.x + b.lean
          } ${100 - b.len}`}
          stroke={`url(#${idPrefix}Grass)`}
          strokeWidth="2"
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

/* ---------------- Reed clump (foreground cover) ---------------- */

function ReedClump({ reed, idPrefix }: { reed: Reed; idPrefix: string }) {
  const { x, y, blades, sway, dur } = reed;
  return (
    <motion.g
      style={{ transformOrigin: `${x}px ${y}px` }}
      animate={{ rotate: [-sway, sway, -sway] }}
      transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
    >
      {blades.map((b, i) => {
        const bx = x + b.offset;
        const tipX = bx + b.lean;
        const tipY = y - b.len;
        const ctrlX = bx + b.lean / 2 + b.curve;
        const ctrlY = y - b.len * 0.55;
        return (
          <g key={i}>
            <path
              d={`M ${bx} ${y} Q ${ctrlX} ${ctrlY} ${tipX} ${tipY}`}
              stroke={`url(#${idPrefix}Reed)`}
              strokeWidth={b.w}
              strokeLinecap="round"
              fill="none"
            />
            {b.cattail && (
              <ellipse
                cx={tipX}
                cy={tipY + 2.4}
                rx={b.w * 0.9}
                ry={2.6}
                fill="#7c4a23"
              />
            )}
          </g>
        );
      })}
    </motion.g>
  );
}

/* ---------------- Fish ---------------- */

// All paths are drawn in fish-local space: centred at (0,0), nose pointing +x,
// `s` is the fish size. The body and tail share the joint at (-1.12s, 0).
function fishBodyPath(s: number): string {
  return (
    `M ${1.4 * s} 0 ` +
    `C ${1.05 * s} ${-0.58 * s} ${0.2 * s} ${-0.72 * s} ${-0.45 * s} ${-0.55 * s} ` +
    `C ${-0.92 * s} ${-0.42 * s} ${-1.1 * s} ${-0.2 * s} ${-1.12 * s} 0 ` +
    `C ${-1.1 * s} ${0.2 * s} ${-0.92 * s} ${0.42 * s} ${-0.45 * s} ${0.55 * s} ` +
    `C ${0.2 * s} ${0.72 * s} ${1.05 * s} ${0.58 * s} ${1.4 * s} 0 Z`
  );
}
// Forked caudal fin. Its bounding box ends exactly at the joint (right edge,
// vertically centred) so a transform-origin of "100% 50%" pivots it cleanly.
function fishTailPath(s: number): string {
  return (
    `M ${-1.12 * s} 0 ` +
    `C ${-1.42 * s} ${-0.22 * s} ${-1.72 * s} ${-0.5 * s} ${-1.98 * s} ${-0.9 * s} ` +
    `C ${-1.76 * s} ${-0.38 * s} ${-1.6 * s} ${-0.16 * s} ${-1.58 * s} 0 ` +
    `C ${-1.6 * s} ${0.16 * s} ${-1.76 * s} ${0.38 * s} ${-1.98 * s} ${0.9 * s} ` +
    `C ${-1.72 * s} ${0.5 * s} ${-1.42 * s} ${0.22 * s} ${-1.12 * s} 0 Z`
  );
}
function fishDorsalPath(s: number): string {
  return (
    `M ${-0.35 * s} ${-0.5 * s} ` +
    `Q ${-0.05 * s} ${-1.08 * s} ${0.45 * s} ${-0.46 * s} ` +
    `Q ${0.05 * s} ${-0.52 * s} ${-0.35 * s} ${-0.5 * s} Z`
  );
}
// Pectoral fin. Bounding box top-left corner sits at the attach point, so a
// transform-origin of "0% 0%" pivots the flap from where it meets the body.
function fishPectoralPath(s: number): string {
  return (
    `M 0 ${0.28 * s} ` +
    `Q ${0.6 * s} ${0.5 * s} ${0.52 * s} ${0.95 * s} ` +
    `Q ${0.22 * s} ${0.6 * s} 0 ${0.28 * s} Z`
  );
}

const pivot = (origin: string): React.CSSProperties =>
  ({ transformOrigin: origin, transformBox: "fill-box" } as React.CSSProperties);

/** The fish itself — body, fins, eye — with a wagging tail and flapping fin. */
function FishArt({
  size,
  level,
  idPrefix,
  flip,
}: {
  size: number;
  level: number;
  idPrefix: string;
  flip: number;
}) {
  const fin = LEVEL_FISH[level].dark;
  return (
    <g transform={`scale(1 ${flip})`}>
      {/* caudal (tail) fin — wags as it swims. CSS animation rather than
          framer-motion: the parent <g> re-renders every frame from the game
          loop, which would keep restarting a framer keyframe animation. */}
      <path
        d={fishTailPath(size)}
        fill={fin}
        className="animate-fish-tail"
        style={pivot("100% 50%")}
      />
      {/* dorsal fin (tucks into the body) */}
      <path d={fishDorsalPath(size)} fill={fin} opacity="0.92" />
      {/* body */}
      <path d={fishBodyPath(size)} fill={`url(#${idPrefix}Fish${level})`} />
      {/* back highlight */}
      <path
        d={`M ${-0.5 * size} ${-0.34 * size} Q ${0.3 * size} ${-0.62 * size} ${1.05 * size} ${-0.12 * size}`}
        stroke="#ffffff"
        strokeWidth={size * 0.1}
        strokeLinecap="round"
        fill="none"
        opacity="0.45"
      />
      {/* pectoral fin — gentle flap */}
      <path
        d={fishPectoralPath(size)}
        fill={fin}
        opacity="0.85"
        className="animate-fish-fin"
        style={pivot("0% 0%")}
      />
      {/* gill line */}
      <path
        d={`M ${0.42 * size} ${-0.32 * size} Q ${0.3 * size} 0 ${0.42 * size} ${0.32 * size}`}
        stroke={fin}
        strokeWidth={size * 0.07}
        fill="none"
        opacity="0.55"
      />
      {/* eye */}
      <circle cx={size * 0.82} cy={-size * 0.16} r={size * 0.2} fill="#ffffff" />
      <circle cx={size * 0.88} cy={-size * 0.16} r={size * 0.1} fill="#0f172a" />
    </g>
  );
}

/** Fish-shaped (not circular) cast shadow on the water below the fish. */
function FishShadow({
  size,
  idPrefix,
  flip,
}: {
  size: number;
  idPrefix: string;
  flip: number;
}) {
  return (
    <g
      transform={`scale(1.05 ${1.05 * flip})`}
      fill="#06342a"
      opacity="0.26"
      filter={`url(#${idPrefix}FishShade)`}
    >
      <path d={fishTailPath(size)} />
      <path d={fishBodyPath(size)} />
      <path d={fishDorsalPath(size)} />
    </g>
  );
}

function FishGlyph({
  fish,
  onTap,
  idPrefix,
  level,
}: {
  fish: Fish;
  onTap: (id: number, e: React.PointerEvent) => void;
  idPrefix: string;
  level: number;
}) {
  const { x, y, size, rot } = fish;
  const deg = (rot * 180) / Math.PI;
  // Keep the fish upright when it swims leftwards instead of going belly-up.
  const flip = Math.cos(rot) < 0 ? -1 : 1;
  return (
    <g aria-label="Fish">
      {/* fish-shaped cast shadow, offset down-right onto the water */}
      <g
        transform={`translate(${x + 1.7} ${y + 2.4}) rotate(${deg})`}
        pointerEvents="none"
      >
        <FishShadow size={size} idPrefix={idPrefix} flip={flip} />
      </g>
      <g
        data-testid="fish"
        data-fed={fish.fed ? "1" : "0"}
        transform={`translate(${x} ${y}) rotate(${deg})`}
        style={{ cursor: "pointer" }}
        onPointerDown={(e) => onTap(fish.id, e)}
      >
        {/* enlarged invisible hit target */}
        <circle r={size * 1.7} fill="transparent" />
        <FishArt size={size} level={level} idPrefix={idPrefix} flip={flip} />
      </g>
    </g>
  );
}

/* ---------------- Lily pad ---------------- */

function LilyPadShape({ pad, idPrefix }: { pad: LilyPad; idPrefix: string }) {
  const { cx, cy, r, rotate, flower } = pad;
  // classic lily pad: a disc with a V-notch cut out. Notch spans 30°.
  const notchHalf = 15; // degrees
  const a1 = (-notchHalf * Math.PI) / 180;
  const a2 = (notchHalf * Math.PI) / 180;
  const p1x = r * Math.cos(a1);
  const p1y = r * Math.sin(a1);
  const p2x = r * Math.cos(a2);
  const p2y = r * Math.sin(a2);
  const d = `M 0 0 L ${p2x} ${p2y} A ${r} ${r} 0 1 0 ${p1x} ${p1y} Z`;
  return (
    <motion.g
      data-testid="lily"
      initial={false}
      animate={{ rotate: [rotate - 3, rotate + 3, rotate - 3] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      style={
        {
          transformOrigin: `${cx}px ${cy}px`,
          transformBox: "fill-box",
        } as React.CSSProperties
      }
      transform={`translate(${cx} ${cy})`}
    >
      {/* shadow the pad casts on the water */}
      <ellipse
        cx={1.2}
        cy={1.8}
        rx={r}
        ry={r * 0.9}
        fill="#06342a"
        opacity="0.28"
      />
      <path
        d={d}
        fill={`url(#${idPrefix}LilyFill)`}
        stroke="#0d5a47"
        strokeWidth="0.3"
      />
      {/* rim highlight */}
      <path
        d={d}
        fill="none"
        stroke="#bdf3df"
        strokeWidth="0.35"
        opacity="0.45"
        transform="scale(0.82)"
      />
      {/* center veining */}
      <path
        d={`M 0 0 L ${r * 0.75} 0`}
        stroke="#0d5a47"
        strokeWidth="0.25"
        opacity="0.5"
      />
      <path
        d={`M 0 0 L ${r * 0.6 * Math.cos(Math.PI / 3)} ${r * 0.6 * Math.sin(Math.PI / 3)}`}
        stroke="#0d5a47"
        strokeWidth="0.2"
        opacity="0.35"
      />
      <path
        d={`M 0 0 L ${r * 0.6 * Math.cos(-Math.PI / 3)} ${r * 0.6 * Math.sin(-Math.PI / 3)}`}
        stroke="#0d5a47"
        strokeWidth="0.2"
        opacity="0.35"
      />
      {flower && (
        <g transform={`rotate(${-rotate})`}>
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <ellipse
              key={a}
              cx={0}
              cy={-2}
              rx={1.5}
              ry={3}
              fill={`url(#${idPrefix}Flower)`}
              transform={`rotate(${a})`}
            />
          ))}
          <circle r={1.5} fill="#fde68a" />
        </g>
      )}
    </motion.g>
  );
}

/* ---------------- Ping (score popup) ---------------- */

function PingGlyph({ ping }: { ping: Ping }) {
  const t = Math.min(1, (performance.now() - ping.born) / PING_LIFE_MS);
  const isOk = ping.color === "ok";
  const bg = isOk ? "#10b981" : "#f43f5e";
  const bgEdge = isOk ? "#047857" : "#be123c";

  // pop in with a little overshoot, then settle
  let scale: number;
  if (t < 0.18) scale = 0.5 + (1.18 - 0.5) * (t / 0.18);
  else if (t < 0.34) scale = 1.18 - 0.18 * ((t - 0.18) / 0.16);
  else scale = 1;

  const y = ping.y - 4 - t * 11;
  const opacity = t < 0.68 ? 1 : 1 - (t - 0.68) / 0.32;

  // a feeding splash ripple stays at the fish
  const rippleR = 1.5 + t * 9;
  const rippleOpacity = 0.7 * (1 - t);

  const w = 8 + ping.text.length * 3.6;
  const h = 9.5;

  return (
    <g pointerEvents="none">
      <circle
        cx={ping.x}
        cy={ping.y}
        r={rippleR}
        fill="none"
        stroke={bg}
        strokeWidth="0.7"
        opacity={rippleOpacity}
      />
      <g
        transform={`translate(${ping.x} ${y}) scale(${scale})`}
        opacity={opacity}
      >
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={h / 2}
          fill={bg}
          stroke={bgEdge}
          strokeWidth="0.5"
        />
        <text
          x="0"
          y="0"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="5.6"
          fontWeight="900"
          fill="#ffffff"
        >
          {ping.text}
        </text>
      </g>
    </g>
  );
}

/* ---------------- Grain (food pellet) ---------------- */

function GrainGlyph({ grain }: { grain: Grain }) {
  const t = Math.min(1, (performance.now() - grain.born) / GRAIN_LIFE_MS);
  const x = grain.fromX + (grain.toX - grain.fromX) * t;
  // arc upward over the flight, landing on the fish
  const y =
    grain.fromY + (grain.toY - grain.fromY) * t - 14 * Math.sin(t * Math.PI);
  const scale = t < 0.85 ? 1 : Math.max(0, 1 - (t - 0.85) / 0.15);
  const opacity = t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.2);
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${t * 260}) scale(${scale})`}
      opacity={opacity}
    >
      <ellipse
        rx="1.8"
        ry="0.85"
        fill="#f6d896"
        stroke="#c89a4a"
        strokeWidth="0.25"
      />
    </g>
  );
}

/* ---------------- Bucket ---------------- */

function BucketIcon({ pct, ready }: { pct: number; ready: boolean }) {
  // body interior runs roughly y 16 (rim) → 37 (base); the feed level rises
  // from empty to full as the bucket refills.
  const fillTop = 37 - pct * 21;
  const bodyPath = "M 9 14 L 35 14 L 31 36 Q 22 40 13 36 Z";
  return (
    <svg viewBox="0 0 44 44" className="h-12 w-12" aria-hidden>
      <defs>
        <linearGradient id="bucketBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8ab5d" />
          <stop offset="100%" stopColor="#a4682b" />
        </linearGradient>
        <clipPath id="bucketClip">
          <path d={bodyPath} />
        </clipPath>
      </defs>
      {/* handle */}
      <path
        d="M 12 14 Q 22 2.5 32 14"
        fill="none"
        stroke="#7c4f24"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      {/* back rim */}
      <ellipse cx="22" cy="14" rx="13" ry="3.4" fill="#b5793a" />
      {/* wooden body */}
      <path d={bodyPath} fill="url(#bucketBody)" />
      {/* feed inside, clipped to the body */}
      <g clipPath="url(#bucketClip)">
        <rect x="7" y={fillTop} width="30" height="32" fill="#f3d79b" />
        <g fill="#e3bd72">
          <ellipse
            cx="16"
            cy={fillTop + 1.6}
            rx="1.7"
            ry="0.9"
            transform={`rotate(22 16 ${fillTop + 1.6})`}
          />
          <ellipse
            cx="23"
            cy={fillTop + 2.6}
            rx="1.7"
            ry="0.9"
            transform={`rotate(-16 23 ${fillTop + 2.6})`}
          />
          <ellipse
            cx="29"
            cy={fillTop + 1.3}
            rx="1.7"
            ry="0.9"
            transform={`rotate(38 29 ${fillTop + 1.3})`}
          />
        </g>
      </g>
      {/* staves + outline on top of the feed */}
      <path
        d="M 11 22 Q 22 25 33 22"
        fill="none"
        stroke="#7c4f24"
        strokeWidth="0.9"
        opacity="0.55"
      />
      <path
        d="M 12 29 Q 22 32 32 29"
        fill="none"
        stroke="#7c4f24"
        strokeWidth="0.9"
        opacity="0.55"
      />
      <path d={bodyPath} fill="none" stroke="#7c4f24" strokeWidth="1.4" />
      {/* front rim */}
      <ellipse
        cx="22"
        cy="14"
        rx="13"
        ry="3.4"
        fill="none"
        stroke="#7c4f24"
        strokeWidth="1.4"
      />
      {ready && <ellipse cx="22" cy="14" rx="11" ry="2.4" fill="#f3d79b" />}
    </svg>
  );
}

function Bucket({
  ready,
  progress,
  shakeKey,
}: {
  ready: boolean;
  progress: number;
  shakeKey: number;
}) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <div className="flex items-center justify-center">
      <motion.div
        key={shakeKey}
        animate={shakeKey > 0 ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.35, ease: "easeInOut" }}
        className={
          "flex items-center gap-3 rounded-2xl px-4 py-2.5 shadow-soft ring-1 " +
          (ready
            ? "bg-amber-50/90 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800"
            : "bg-white/75 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-700")
        }
        aria-live="polite"
        data-testid="bucket"
        data-ready={ready ? "1" : "0"}
      >
        <motion.div
          animate={ready ? { y: [0, -1.5, 0] } : { y: 0 }}
          transition={
            ready
              ? { duration: 2, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.2 }
          }
        >
          <BucketIcon pct={pct} ready={ready} />
        </motion.div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Feeding bucket
          </span>
          <span
            className={
              "text-sm font-bold " +
              (ready
                ? "text-amber-700 dark:text-amber-300"
                : "text-slate-500 dark:text-slate-400")
            }
          >
            {ready ? "Ready — tap a fish" : `Refilling… ${Math.round(pct * 100)}%`}
          </span>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------------- Demo pond (tutorial) ---------------- */

function DemoPond({
  mode,
}: {
  mode: "intro" | "bucket" | "identical" | "lily";
}) {
  const intro: Fish[] = [
    demoFish(0, 30, 45, 30),
    demoFish(1, 70, 55, -150),
    demoFish(2, 50, 30, 90),
  ];
  const bucketFish: Fish[] = [demoFish(0, 40, 55, 20)];
  const identical: Fish[] = [
    demoFish(0, 28, 40, 20),
    { ...demoFish(1, 65, 55, -150), fed: true },
    demoFish(2, 48, 72, 110),
  ];
  const lily: Fish[] = [demoFish(0, 30, 55, 25), demoFish(1, 70, 45, 200)];
  const demoLilies: LilyPad[] =
    mode === "lily"
      ? [
          { id: 0, cx: 50, cy: 50, r: 11, rotate: 30, flower: true },
          { id: 1, cx: 78, cy: 28, r: 9, rotate: 150, flower: false },
        ]
      : [];
  const demoReeds: Reed[] =
    mode === "lily"
      ? [
          {
            id: 0,
            x: 16,
            y: 100,
            sway: 3,
            dur: 4,
            blades: [
              { offset: -2, len: 26, lean: -6, curve: 4, w: 1.6, cattail: true },
              { offset: 0, len: 32, lean: 2, curve: -3, w: 1.8, cattail: false },
              { offset: 2.4, len: 22, lean: 8, curve: 3, w: 1.4, cattail: false },
            ],
          },
        ]
      : [];

  const fish =
    mode === "intro"
      ? intro
      : mode === "bucket"
      ? bucketFish
      : mode === "identical"
      ? identical
      : lily;
  // One colour per demo step for variety — but "identical" must keep every
  // fish the same colour, since that's the whole point of that step.
  const demoLevel =
    mode === "intro" ? 0 : mode === "bucket" ? 3 : mode === "identical" ? 2 : 4;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative aspect-square w-full max-w-sm overflow-hidden rounded-3xl ring-1 ring-emerald-900/30"
        style={{ background: "#0a5644" }}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
          <PondDefs idPrefix="demo" />
          <rect width="100" height="100" fill="url(#demoWater)" />
          <rect width="100" height="100" fill="url(#demoDepth)" />
          <WaterCaustics idPrefix="demo" />
          <UnderwaterGrass idPrefix="demo" />
          <g>
            {fish.map((f) => (
              <DemoFish key={f.id} fish={f} level={demoLevel} />
            ))}
          </g>
          <g>
            {demoLilies.map((p) => (
              <LilyPadShape key={p.id} pad={p} idPrefix="demo" />
            ))}
          </g>
          <g pointerEvents="none">
            {demoReeds.map((r) => (
              <ReedClump key={r.id} reed={r} idPrefix="demo" />
            ))}
          </g>
          <rect
            width="100"
            height="100"
            fill="url(#demoVignette)"
            pointerEvents="none"
          />
        </svg>
      </div>
      {mode === "bucket" && <Bucket ready progress={1} shakeKey={0} />}
      {mode === "identical" && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Can you tell which fish has already been fed? Neither can anyone else.
        </p>
      )}
    </div>
  );
}

function DemoFish({ fish, level }: { fish: Fish; level: number }) {
  const { x, y, size, rot } = fish;
  const deg = (rot * 180) / Math.PI;
  const flip = Math.cos(rot) < 0 ? -1 : 1;
  return (
    <g>
      <g
        transform={`translate(${x + 1.7} ${y + 2.4}) rotate(${deg})`}
        pointerEvents="none"
      >
        <FishShadow size={size} idPrefix="demo" flip={flip} />
      </g>
      <g transform={`translate(${x} ${y}) rotate(${deg})`}>
        <FishArt size={size} level={level} idPrefix="demo" flip={flip} />
      </g>
    </g>
  );
}

function demoFish(id: number, x: number, y: number, deg: number): Fish {
  const rad = (deg * Math.PI) / 180;
  return {
    id,
    x,
    y,
    vx: 0,
    vy: 0,
    size: 7,
    rot: rad,
    fed: false,
  };
}

function formatSessionTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

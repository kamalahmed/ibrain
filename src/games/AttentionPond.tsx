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
const PING_LIFE_MS = 600;
const SESSION_SECONDS = 300;
const LEVEL_CLEAR_BONUS = 50;

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
};

type Ping = {
  id: number;
  x: number;
  y: number;
  text: string;
  color: "ok" | "bad";
  born: number;
};

type Level = {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  count: number;
  seconds: number;
};

const LEVELS: Level[] = [
  { id: 1, name: "3 fish", count: 3, seconds: 30 },
  { id: 2, name: "4 fish", count: 4, seconds: 35 },
  { id: 3, name: "5 fish", count: 5, seconds: 40 },
  { id: 4, name: "6 fish", count: 6, seconds: 45 },
  { id: 5, name: "7 fish", count: 7, seconds: 50 },
];

function spawnFish(count: number): Fish[] {
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
      size: 7,
      rot: angle,
      fed: false,
    });
  }
  return fish;
}

function spawnLilies(count: number): LilyPad[] {
  const pads: LilyPad[] = [];
  const margin = 14;
  let attempts = 0;
  while (pads.length < count && attempts < 120) {
    attempts++;
    const r = 9 + Math.random() * 4;
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
    });
  }
  return pads;
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
  const [levelTimeLeft, setLevelTimeLeft] = useState(0);
  const [sessionTimeLeft, setSessionTimeLeft] = useState(SESSION_SECONDS);
  const [score, setScore] = useState(0);
  const [doubles, setDoubles] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [pings, setPings] = useState<Ping[]>([]);
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
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const deadlineRef = useRef(0); // per-level deadline (performance.now base)
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

  const advanceLevel = useCallback(
    (cause: "cleared" | "timeout") => {
      stopLoop();
      if (cause === "timeout") {
        // level failed — session ends with accumulated score
        finishGame(false);
        return;
      }
      // level cleared — speed bonus based on remaining level time
      const remainingMs = Math.max(0, deadlineRef.current - performance.now());
      const speedBonus = Math.round((remainingMs / 1000) * 10);
      const clearPts = LEVEL_CLEAR_BONUS + speedBonus;
      scoreRef.current += clearPts;
      levelPointsRef.current += clearPts;
      setScore(scoreRef.current);
      clearedRef.current += 1;
      const lvl = LEVELS[levelIdx];
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
    const f = spawnFish(lvl.count);
    const pads = spawnLilies(idx); // 0, 1, 2, 3, 4 per level
    setFish(f);
    setLilies(pads);
    fishRef.current = f;
    levelPointsRef.current = 0;
    setLevelTimeLeft(lvl.seconds);
    deadlineRef.current = performance.now() + lvl.seconds * 1000;
    lastTickRef.current = performance.now();
    bucketReadyRef.current = true;
    setBucketReady(true);
    setBucketProgress(1);
    pingsRef.current = [];
    setPings([]);
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

      // --- per-level timer ---
      const remainingMs = deadlineRef.current - now;
      setLevelTimeLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0) {
        stopLoop();
        advanceLevel("timeout");
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => stopLoop();
  }, [phase, advanceLevel]);

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

    const next = fishRef.current.map((f) =>
      f.id === id ? { ...f, fed: true } : f
    );
    fishRef.current = next;
    setFish(next);
    if (next.every((f) => f.fed)) {
      advanceLevel("cleared");
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
        "Watch out — fish swim under lily pads. They'll reappear on the other side.",
      stage: <DemoPond mode="lily" />,
    },
  ];

  const fedCount = fish.filter((f) => f.fed).length;

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Five ponds in one 5-minute session. Level 1 has 3 fish; by level 5
          there are 7 fish under 4 lily pads. Tap each fish exactly once —
          fed fish still look identical, so you have to remember. Clear each
          pond (all fish fed) to unlock the next.
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
            <span>
              {LEVELS[levelIdx].name} · fed {fedCount} / {fish.length}
            </span>
            <span
              className={
                levelTimeLeft <= 5
                  ? "font-bold text-rose-600 dark:text-rose-300"
                  : ""
              }
              data-testid="level-timer"
            >
              level {levelTimeLeft}s
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
                pings={pings}
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

/* ---------------- Pond ---------------- */

function Pond({
  fish,
  lilies,
  pings,
  onTapFish,
  showOverlay,
}: {
  fish: Fish[];
  lilies: LilyPad[];
  pings: Ping[];
  onTapFish: (id: number, e: React.PointerEvent) => void;
  showOverlay: boolean;
}) {
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-xl overflow-hidden rounded-3xl ring-1 ring-slate-200 dark:ring-slate-800"
      style={{
        background:
          "radial-gradient(120% 120% at 30% 20%, #c7f0e7 0%, #93d8c9 45%, #5dbba7 100%)",
      }}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="pondFishBody" x1="0" y1="-1" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfa6ff" />
            <stop offset="100%" stopColor="#7e4dff" />
          </linearGradient>
          <radialGradient id="pondLilyFill" cx="0.35" cy="0.35" r="0.8">
            <stop offset="0%" stopColor="#5dd3b0" />
            <stop offset="60%" stopColor="#2fb48f" />
            <stop offset="100%" stopColor="#0f7a5f" />
          </radialGradient>
        </defs>

        {/* current lines */}
        <g opacity="0.15" stroke="#0a4a42" strokeWidth="0.2" fill="none">
          <path d="M5 30 Q 40 35 95 25" />
          <path d="M5 60 Q 50 70 95 55" />
          <path d="M8 85 Q 40 80 92 88" />
        </g>

        {/* fish layer */}
        <g>
          {fish.map((f) => (
            <FishGlyph key={f.id} fish={f} onTap={onTapFish} />
          ))}
        </g>

        {/* lily pad layer (opaque, on top of fish) */}
        <g>
          {lilies.map((p) => (
            <LilyPadShape key={p.id} pad={p} />
          ))}
        </g>

        {/* pings / ripples */}
        <g>
          {pings.map((p) => (
            <PingGlyph key={p.id} ping={p} />
          ))}
        </g>
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

/* ---------------- Fish ---------------- */

function FishGlyph({
  fish,
  onTap,
}: {
  fish: Fish;
  onTap: (id: number, e: React.PointerEvent) => void;
}) {
  const { x, y, size, rot } = fish;
  const deg = (rot * 180) / Math.PI;
  return (
    <g
      data-testid="fish"
      data-fed={fish.fed ? "1" : "0"}
      transform={`translate(${x} ${y}) rotate(${deg})`}
      style={{ cursor: "pointer" }}
      onPointerDown={(e) => onTap(fish.id, e)}
      aria-label="Fish"
    >
      {/* enlarged invisible hit target */}
      <circle r={size * 1.6} fill="transparent" />
      {/* triangular tail */}
      <polygon
        points={`${-size * 1.15},0 ${-size * 1.9},${-size * 0.75} ${-size * 1.9},${size * 0.75}`}
        fill="#7e4dff"
      />
      {/* teardrop body — ellipse pinched toward the tail */}
      <path
        d={`
          M ${size * 1.35} 0
          Q ${size * 0.9} ${-size * 0.75} 0 ${-size * 0.62}
          Q ${-size * 1.0} ${-size * 0.45} ${-size * 1.15} 0
          Q ${-size * 1.0} ${size * 0.45} 0 ${size * 0.62}
          Q ${size * 0.9} ${size * 0.75} ${size * 1.35} 0
          Z
        `}
        fill="url(#pondFishBody)"
      />
      {/* side fin */}
      <path
        d={`M ${-size * 0.1} ${size * 0.3} Q ${-size * 0.35} ${size * 0.75} ${size * 0.25} ${size * 0.55} Z`}
        fill="#5925d6"
        opacity="0.7"
      />
      {/* eye */}
      <circle cx={size * 0.75} cy={-size * 0.22} r={size * 0.22} fill="#ffffff" />
      <circle cx={size * 0.82} cy={-size * 0.22} r={size * 0.11} fill="#0f172a" />
    </g>
  );
}

/* ---------------- Lily pad ---------------- */

function LilyPadShape({ pad }: { pad: LilyPad }) {
  const { cx, cy, r, rotate } = pad;
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
      style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "fill-box" } as React.CSSProperties}
      transform={`translate(${cx} ${cy})`}
    >
      <path d={d} fill="url(#pondLilyFill)" stroke="#0d5a47" strokeWidth="0.3" />
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
    </motion.g>
  );
}

/* ---------------- Ping ---------------- */

function PingGlyph({ ping }: { ping: Ping }) {
  const t = Math.min(1, (performance.now() - ping.born) / PING_LIFE_MS);
  const rippleR = 2 + t * 10;
  const rippleOpacity = 0.8 * (1 - t);
  const textY = ping.y - t * 20;
  const textOpacity = 1 - t;
  const stroke = ping.color === "ok" ? "#10b981" : "#f43f5e";
  const fill = ping.color === "ok" ? "#059669" : "#e11d48";
  return (
    <g pointerEvents="none">
      <circle
        cx={ping.x}
        cy={ping.y}
        r={rippleR}
        fill="none"
        stroke={stroke}
        strokeWidth="0.6"
        opacity={rippleOpacity}
      />
      <text
        x={ping.x}
        y={textY}
        fill={fill}
        opacity={textOpacity}
        fontSize="4.5"
        fontWeight="800"
        textAnchor="middle"
        style={{ paintOrder: "stroke" }}
        stroke="#ffffff"
        strokeWidth="0.4"
      >
        {ping.text}
      </text>
    </g>
  );
}

/* ---------------- Bucket ---------------- */

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
        animate={
          shakeKey > 0 ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }
        }
        transition={{ duration: 0.35, ease: "easeInOut" }}
        className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-2 ring-1 ring-slate-200 shadow-soft dark:bg-slate-900/60 dark:ring-slate-700"
        aria-live="polite"
        data-testid="bucket"
        data-ready={ready ? "1" : "0"}
      >
        <div
          className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800"
          aria-hidden
        >
          {/* progress fill from the bottom */}
          <div
            className="absolute inset-x-0 bottom-0 bg-amber-300/80 dark:bg-amber-500/50 transition-[height] duration-75"
            style={{ height: `${pct * 100}%` }}
          />
          <svg viewBox="0 0 24 24" className="relative h-6 w-6">
            {/* pellet glyph */}
            {ready ? (
              <circle cx="12" cy="12" r="5" fill="#f59e0b" stroke="#b45309" strokeWidth="1" />
            ) : (
              <circle
                cx="12"
                cy="12"
                r="5"
                fill="none"
                stroke="#b45309"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.6"
              />
            )}
          </svg>
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Feeding bucket
          </span>
          <span className={"text-sm font-bold " + (ready ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-slate-400")}>
            {ready ? "Ready" : `Refilling… ${Math.round(pct * 100)}%`}
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
          { id: 0, cx: 50, cy: 50, r: 14, rotate: 30 },
          { id: 1, cx: 78, cy: 28, r: 9, rotate: 150 },
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

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative aspect-square w-full max-w-sm overflow-hidden rounded-3xl ring-1 ring-slate-200 dark:ring-slate-800"
        style={{
          background:
            "radial-gradient(120% 120% at 30% 20%, #c7f0e7 0%, #93d8c9 60%, #5dbba7 100%)",
        }}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="demoFishBody" x1="0" y1="-1" x2="0" y2="1">
              <stop offset="0%" stopColor="#bfa6ff" />
              <stop offset="100%" stopColor="#7e4dff" />
            </linearGradient>
            <radialGradient id="demoLilyFill" cx="0.35" cy="0.35" r="0.8">
              <stop offset="0%" stopColor="#5dd3b0" />
              <stop offset="60%" stopColor="#2fb48f" />
              <stop offset="100%" stopColor="#0f7a5f" />
            </radialGradient>
          </defs>
          <g>
            {fish.map((f) => (
              <DemoFish key={f.id} fish={f} />
            ))}
          </g>
          <g>
            {demoLilies.map((p) => (
              <DemoLily key={p.id} pad={p} />
            ))}
          </g>
        </svg>
      </div>
      {mode === "bucket" && (
        <Bucket ready progress={1} shakeKey={0} />
      )}
      {mode === "identical" && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Can you tell which fish has already been fed? Neither can anyone else.
        </p>
      )}
    </div>
  );
}

function DemoFish({ fish }: { fish: Fish }) {
  const { x, y, size, rot } = fish;
  const deg = (rot * 180) / Math.PI;
  return (
    <g transform={`translate(${x} ${y}) rotate(${deg})`}>
      <polygon
        points={`${-size * 1.15},0 ${-size * 1.9},${-size * 0.75} ${-size * 1.9},${size * 0.75}`}
        fill="#7e4dff"
      />
      <path
        d={`
          M ${size * 1.35} 0
          Q ${size * 0.9} ${-size * 0.75} 0 ${-size * 0.62}
          Q ${-size * 1.0} ${-size * 0.45} ${-size * 1.15} 0
          Q ${-size * 1.0} ${size * 0.45} 0 ${size * 0.62}
          Q ${size * 0.9} ${size * 0.75} ${size * 1.35} 0
          Z
        `}
        fill="url(#demoFishBody)"
      />
      <path
        d={`M ${-size * 0.1} ${size * 0.3} Q ${-size * 0.35} ${size * 0.75} ${size * 0.25} ${size * 0.55} Z`}
        fill="#5925d6"
        opacity="0.7"
      />
      <circle cx={size * 0.75} cy={-size * 0.22} r={size * 0.22} fill="#ffffff" />
      <circle cx={size * 0.82} cy={-size * 0.22} r={size * 0.11} fill="#0f172a" />
    </g>
  );
}

function DemoLily({ pad }: { pad: LilyPad }) {
  const { cx, cy, r, rotate } = pad;
  const notchHalf = 15;
  const a1 = (-notchHalf * Math.PI) / 180;
  const a2 = (notchHalf * Math.PI) / 180;
  const p1x = r * Math.cos(a1);
  const p1y = r * Math.sin(a1);
  const p2x = r * Math.cos(a2);
  const p2y = r * Math.sin(a2);
  const d = `M 0 0 L ${p2x} ${p2y} A ${r} ${r} 0 1 0 ${p1x} ${p1y} Z`;
  return (
    <g transform={`translate(${cx} ${cy}) rotate(${rotate})`}>
      <path d={d} fill="url(#demoLilyFill)" stroke="#0d5a47" strokeWidth="0.3" />
      <path d={`M 0 0 L ${r * 0.75} 0`} stroke="#0d5a47" strokeWidth="0.25" opacity="0.5" />
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

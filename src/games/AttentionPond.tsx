import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { getGame } from "@/lib/games";
import { haptic } from "@/lib/haptics";
import { useStore } from "@/store/useStore";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "roundDone"
  | "done";

// viewBox is 100×100; all coords are percentages
const BOUNDS = { w: 100, h: 100 };

type Fish = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number; // current facing angle in radians
  fed: boolean;
  feedingPulse: number; // 0-1 animation for when tapped
};

const ROUNDS: { count: number; seconds: number }[] = [
  { count: 3, seconds: 30 },
  { count: 4, seconds: 35 },
  { count: 5, seconds: 40 },
  { count: 6, seconds: 45 },
  { count: 7, seconds: 50 },
];

function spawnFish(count: number): Fish[] {
  const fish: Fish[] = [];
  const margin = 12;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 4; // units per second
    fish.push({
      id: i,
      x: margin + Math.random() * (BOUNDS.w - margin * 2),
      y: margin + Math.random() * (BOUNDS.h - margin * 2),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 7,
      rot: angle,
      fed: false,
      feedingPulse: 0,
    });
  }
  return fish;
}

export default function AttentionPond() {
  const game = getGame("pond");
  const recordPlay = useStore((s) => s.recordPlay);

  const [phase, setPhase] = useState<Phase>("intro");
  const [roundIdx, setRoundIdx] = useState(0);
  const [fish, setFish] = useState<Fish[]>([]);
  const fishRef = useRef<Fish[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [doubles, setDoubles] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);

  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const deadlineRef = useRef<number>(0);

  useEffect(() => {
    fishRef.current = fish;
  }, [fish]);
  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  const stopLoop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const finishGame = useCallback(() => {
    stopLoop();
    const { isBest: best } = recordPlay("pond", scoreRef.current);
    setFinalScore(scoreRef.current);
    setIsBest(best);
    setPhase("done");
  }, [recordPlay]);

  const startRound = useCallback((idx: number) => {
    const cfg = ROUNDS[idx];
    const f = spawnFish(cfg.count);
    setFish(f);
    fishRef.current = f;
    setTimeLeft(cfg.seconds);
    deadlineRef.current = performance.now() + cfg.seconds * 1000;
    lastTickRef.current = performance.now();
    setRoundIdx(idx);
    setPhase("playing");
  }, []);

  // Main game loop
  useEffect(() => {
    if (phase !== "playing") return;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      // Update fish positions
      const next = fishRef.current.map((fi) => {
        if (fi.fed) return fi;
        let { x, y, vx, vy } = fi;
        x += vx * dt;
        y += vy * dt;

        // Bounce off walls
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

        // Occasional small curve so paths aren't predictable
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
        const pulse = Math.max(0, fi.feedingPulse - dt * 2.5);
        return { ...fi, x, y, vx, vy, rot, feedingPulse: pulse };
      });
      fishRef.current = next;
      setFish(next);

      // Timer
      const remainingMs = deadlineRef.current - now;
      setTimeLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0) {
        stopLoop();
        advanceRound("timeout");
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => stopLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const advanceRound = useCallback(
    (cause: "cleared" | "timeout") => {
      if (cause === "cleared") {
        // Time bonus
        const ms = deadlineRef.current - performance.now();
        const bonus = Math.max(0, Math.round((ms / 1000) * 10));
        setScore((s) => s + bonus);
      }
      const next = roundIdx + 1;
      if (next >= ROUNDS.length) {
        setPhase("roundDone");
        window.setTimeout(() => finishGame(), 800);
      } else {
        setPhase("roundDone");
        window.setTimeout(() => startRound(next), 900);
      }
    },
    [finishGame, roundIdx, startRound]
  );

  const tapFish = (id: number, e: React.PointerEvent) => {
    e.stopPropagation();
    if (phase !== "playing") return;
    setFish((prev) => {
      const hit = prev.find((f) => f.id === id);
      if (!hit) return prev;
      if (hit.fed) {
        // double-tap penalty
        haptic.error();
        setDoubles((d) => d + 1);
        setScore((s) => Math.max(0, s - 50));
        setFlash("bad");
        window.setTimeout(() => setFlash(null), 200);
        return prev.map((f) =>
          f.id === id ? { ...f, feedingPulse: 1 } : f
        );
      }
      haptic.success();
      setScore((s) => s + 100);
      setFlash("ok");
      window.setTimeout(() => setFlash(null), 160);
      const next = prev.map((f) =>
        f.id === id ? { ...f, fed: true, feedingPulse: 1 } : f
      );
      fishRef.current = next;
      // Check if all fed
      if (next.every((f) => f.fed)) {
        advanceRound("cleared");
      }
      return next;
    });
  };

  const begin = () => {
    setScore(0);
    scoreRef.current = 0;
    setDoubles(0);
    setRoundIdx(0);
    setPhase("tutorial");
  };

  const afterTutorial = () => setPhase("countdown");
  const afterCountdown = () => startRound(0);

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Fish drift around the pond. Tap each fish once to feed it.",
      stage: <DemoPond mode="intro" />,
    },
    {
      caption: "Tap a fish, it turns satisfied and stops moving.",
      stage: <DemoPond mode="feedOne" />,
    },
    {
      caption:
        "You only have enough food for each fish once — don't tap the same fish twice.",
      stage: <DemoPond mode="warning" />,
    },
    {
      caption: `${ROUNDS.length} rounds total. Clear the pond fast for a time bonus.`,
      stage: <DemoPond mode="multi" />,
    },
  ];

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          A divided-attention drill. Fish swim around the pond — tap each one
          exactly once. Double-taps cost points. Clear all {ROUNDS.length}{" "}
          ponds for the best score.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={afterCountdown} />}

      {(phase === "playing" || phase === "roundDone") && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="chip">
              Pond {roundIdx + 1} / {ROUNDS.length}
            </span>
            <span className="chip">Score: {score}</span>
            <span
              className={
                "chip " +
                (timeLeft <= 5
                  ? "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800"
                  : "")
              }
            >
              {timeLeft}s
            </span>
          </div>
          <Pond
            fish={fish}
            onTapFish={tapFish}
            flash={flash}
            showOverlay={phase === "roundDone"}
          />
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            {roundIdx + 1 === ROUNDS.length
              ? "Final pond!"
              : `Fed: ${fish.filter((f) => f.fed).length} / ${fish.length}`}
          </p>
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${doubles} double-tap${doubles === 1 ? "" : "s"}`}
        />
      )}
    </GameShell>
  );
}

/* ---------- Pond renderer ---------- */

function Pond({
  fish,
  onTapFish,
  flash,
  showOverlay,
}: {
  fish: Fish[];
  onTapFish: (id: number, e: React.PointerEvent) => void;
  flash: "ok" | "bad" | null;
  showOverlay: boolean;
}) {
  return (
    <div
      className={
        "relative mx-auto aspect-square w-full max-w-xl overflow-hidden rounded-3xl ring-1 transition-colors " +
        (flash === "ok"
          ? "ring-emerald-300"
          : flash === "bad"
          ? "ring-rose-300"
          : "ring-slate-200 dark:ring-slate-800")
      }
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
        {/* subtle current lines */}
        <g opacity="0.15" stroke="#0a4a42" strokeWidth="0.2" fill="none">
          <path d="M5 30 Q 40 35 95 25" />
          <path d="M5 60 Q 50 70 95 55" />
          <path d="M8 85 Q 40 80 92 88" />
        </g>
        {fish.map((f) => (
          <FishGlyph key={f.id} fish={f} onTap={onTapFish} />
        ))}
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

function FishGlyph({
  fish,
  onTap,
}: {
  fish: Fish;
  onTap: (id: number, e: React.PointerEvent) => void;
}) {
  const { x, y, size, rot, fed, feedingPulse } = fish;
  const deg = (rot * 180) / Math.PI;
  const scale = 1 + feedingPulse * 0.3;
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${deg}) scale(${scale})`}
      style={{
        cursor: "pointer",
        transition: "opacity 400ms ease-out",
        opacity: fed ? 0.25 : 1,
      }}
      onPointerDown={(e) => onTap(fish.id, e)}
      aria-label={fed ? "Fed fish" : "Fish"}
    >
      {/* Larger invisible hit target */}
      <circle r={size * 1.6} fill="transparent" />
      {/* Tail */}
      <polygon
        points={`${-size * 1.2},0 ${-size * 1.9},${-size * 0.7} ${
          -size * 1.9
        },${size * 0.7}`}
        fill={fed ? "#9ca3af" : "#7e4dff"}
        opacity="0.85"
      />
      {/* Body */}
      <ellipse
        cx="0"
        cy="0"
        rx={size * 1.3}
        ry={size * 0.65}
        fill={fed ? "#cbd5e1" : "url(#fishBody)"}
        stroke={fed ? "#94a3b8" : "#5925d6"}
        strokeWidth="0.5"
      />
      {/* Eye */}
      <circle
        cx={size * 0.7}
        cy={-size * 0.25}
        r={size * 0.18}
        fill="#0f172a"
      />
      {/* Satisfied checkmark */}
      {fed && (
        <g transform={`translate(0 ${-size * 1.6}) rotate(${-deg})`}>
          <circle r={size * 0.7} fill="#10b981" />
          <path
            d={`M ${-size * 0.35} 0 L ${-size * 0.05} ${size * 0.3} L ${
              size * 0.4
            } ${-size * 0.3}`}
            stroke="#fff"
            strokeWidth={size * 0.2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      <defs>
        <linearGradient id="fishBody" x1="0" y1="-1" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfa6ff" />
          <stop offset="100%" stopColor="#7e4dff" />
        </linearGradient>
      </defs>
    </g>
  );
}

/* ---------- Demo pond used by the tutorial ---------- */

function DemoPond({ mode }: { mode: "intro" | "feedOne" | "warning" | "multi" }) {
  const presets: Record<string, Fish[]> = {
    intro: [
      demoFish(0, 30, 45, 30),
      demoFish(1, 70, 55, -150),
    ],
    feedOne: [
      { ...demoFish(0, 30, 45, 30), fed: true },
      demoFish(1, 70, 55, -150),
    ],
    warning: [
      { ...demoFish(0, 30, 45, 30), fed: true },
      demoFish(1, 70, 55, -150),
    ],
    multi: [
      demoFish(0, 25, 30, 45),
      demoFish(1, 65, 35, 135),
      demoFish(2, 40, 70, -60),
      demoFish(3, 78, 72, 170),
    ],
  };
  const f = presets[mode];
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl ring-1 ring-slate-200 dark:ring-slate-800"
      style={{
        background:
          "radial-gradient(120% 120% at 30% 20%, #c7f0e7 0%, #93d8c9 60%, #5dbba7 100%)",
      }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        {f.map((fi) => (
          <FishGlyph key={fi.id} fish={fi} onTap={() => {}} />
        ))}
        {mode === "warning" && (
          <g transform="translate(30 45)">
            <circle r="9" fill="none" stroke="#ef4444" strokeWidth="1.2" />
            <line x1="-6" y1="-6" x2="6" y2="6" stroke="#ef4444" strokeWidth="1.5" />
          </g>
        )}
      </svg>
    </div>
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
    feedingPulse: 0,
  };
}

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { haptic } from "@/lib/haptics";
import type { DailyMiniProps } from "./types";

const BOUNDS = { w: 100, h: 100 };
const FISH_COUNT = 4;
const DURATION_S = 25;
const BUCKET_REFILL_MS = 2000;

type Fish = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  fed: boolean;
};

function spawnFish(count: number): Fish[] {
  const fish: Fish[] = [];
  const margin = 12;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 3;
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

export function PondMini({ onComplete }: DailyMiniProps) {
  const [fish, setFish] = useState<Fish[]>(() => spawnFish(FISH_COUNT));
  const [timeLeft, setTimeLeft] = useState(DURATION_S);
  const [score, setScore] = useState(0);
  const [bucketReady, setBucketReady] = useState(true);
  const [bucketProgress, setBucketProgress] = useState(1);

  const fishRef = useRef<Fish[]>([]);
  const scoreRef = useRef(0);
  const doublesRef = useRef(0);
  const bucketReadyRef = useRef(true);
  const bucketDeadlineRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(performance.now());
  const deadlineRef = useRef(0);
  const endedRef = useRef(false);

  useEffect(() => {
    fishRef.current = spawnFish(FISH_COUNT);
    setFish(fishRef.current);
    deadlineRef.current = performance.now() + DURATION_S * 1000;
    lastTickRef.current = performance.now();

    const end = (clearedAll: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const remainingS = Math.max(
        0,
        (deadlineRef.current - performance.now()) / 1000
      );
      let total = scoreRef.current;
      if (clearedAll) total += Math.round(remainingS * 5);
      total = Math.max(0, total);
      window.setTimeout(() => onComplete(total), 120);
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      const next = fishRef.current.map((fi) => {
        let { x, y, vx, vy } = fi;
        x += vx * dt;
        y += vy * dt;
        const margin = fi.size * 0.6;
        if (x < margin) { x = margin; vx = Math.abs(vx); }
        else if (x > BOUNDS.w - margin) { x = BOUNDS.w - margin; vx = -Math.abs(vx); }
        if (y < margin) { y = margin; vy = Math.abs(vy); }
        else if (y > BOUNDS.h - margin) { y = BOUNDS.h - margin; vy = -Math.abs(vy); }
        if (Math.random() < 0.02) {
          const turn = (Math.random() - 0.5) * 0.9;
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          const nvx = vx * cos - vy * sin;
          const nvy = vx * sin + vy * cos;
          vx = nvx;
          vy = nvy;
        }
        return { ...fi, x, y, vx, vy, rot: Math.atan2(vy, vx) };
      });
      fishRef.current = next;
      setFish(next);

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

      const remainingMs = deadlineRef.current - now;
      setTimeLeft(Math.max(0, Math.ceil(remainingMs / 1000)));
      if (remainingMs <= 0) {
        end(false);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tapFish = (id: number) => {
    if (endedRef.current) return;
    if (!bucketReadyRef.current) {
      haptic.tap();
      return;
    }
    const hit = fishRef.current.find((f) => f.id === id);
    if (!hit) return;
    bucketReadyRef.current = false;
    setBucketReady(false);
    setBucketProgress(0);
    bucketDeadlineRef.current = performance.now() + BUCKET_REFILL_MS;

    if (hit.fed) {
      haptic.error();
      doublesRef.current += 1;
      scoreRef.current = Math.max(0, scoreRef.current - 50);
      setScore(scoreRef.current);
      return;
    }
    haptic.success();
    scoreRef.current += 100;
    setScore(scoreRef.current);
    const next = fishRef.current.map((f) =>
      f.id === id ? { ...f, fed: true } : f
    );
    fishRef.current = next;
    setFish(next);
    if (next.every((f) => f.fed) && !endedRef.current) {
      endedRef.current = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const remainingS = Math.max(
        0,
        (deadlineRef.current - performance.now()) / 1000
      );
      const total = Math.max(0, scoreRef.current + Math.round(remainingS * 5));
      window.setTimeout(() => onComplete(total), 200);
    }
  };

  const fedCount = fish.filter((f) => f.fed).length;

  return (
    <div className="space-y-3" data-testid="mini-pond">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Fed {fedCount} / {FISH_COUNT} · {score} pts</span>
        <span className={timeLeft <= 5 ? "font-bold text-rose-600 dark:text-rose-300" : ""}>
          {timeLeft}s
        </span>
      </div>
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
            <linearGradient id="dailyPondFish" x1="0" y1="-1" x2="0" y2="1">
              <stop offset="0%" stopColor="#bfa6ff" />
              <stop offset="100%" stopColor="#7e4dff" />
            </linearGradient>
          </defs>
          <g opacity="0.15" stroke="#0a4a42" strokeWidth="0.2" fill="none">
            <path d="M5 30 Q 40 35 95 25" />
            <path d="M5 60 Q 50 70 95 55" />
          </g>
          {fish.map((f) => {
            const deg = (f.rot * 180) / Math.PI;
            return (
              <g
                key={f.id}
                data-testid="fish"
                data-fed={f.fed ? "1" : "0"}
                transform={`translate(${f.x} ${f.y}) rotate(${deg})`}
                style={{ cursor: "pointer" }}
                onPointerDown={() => tapFish(f.id)}
              >
                <circle r={f.size * 1.6} fill="transparent" />
                <polygon
                  points={`${-f.size * 1.15},0 ${-f.size * 1.9},${-f.size * 0.75} ${-f.size * 1.9},${f.size * 0.75}`}
                  fill="#7e4dff"
                />
                <path
                  d={`
                    M ${f.size * 1.35} 0
                    Q ${f.size * 0.9} ${-f.size * 0.75} 0 ${-f.size * 0.62}
                    Q ${-f.size * 1.0} ${-f.size * 0.45} ${-f.size * 1.15} 0
                    Q ${-f.size * 1.0} ${f.size * 0.45} 0 ${f.size * 0.62}
                    Q ${f.size * 0.9} ${f.size * 0.75} ${f.size * 1.35} 0
                    Z
                  `}
                  fill="url(#dailyPondFish)"
                />
                <circle cx={f.size * 0.75} cy={-f.size * 0.22} r={f.size * 0.22} fill="#ffffff" />
                <circle cx={f.size * 0.82} cy={-f.size * 0.22} r={f.size * 0.11} fill="#0f172a" />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center justify-center">
        <motion.div
          className="flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-1.5 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:ring-slate-700"
          animate={{ scale: bucketReady ? 1 : 0.98 }}
        >
          <div className="relative grid h-8 w-8 place-items-center overflow-hidden rounded-lg bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-800">
            <div
              className="absolute inset-x-0 bottom-0 bg-amber-300/80 dark:bg-amber-500/50 transition-[height] duration-75"
              style={{ height: `${bucketProgress * 100}%` }}
            />
            <span className="relative text-xs font-bold text-amber-700 dark:text-amber-200">
              {bucketReady ? "●" : "…"}
            </span>
          </div>
          <span className={"text-xs font-bold " + (bucketReady ? "text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-slate-400")}>
            {bucketReady ? "Ready" : `${Math.round(bucketProgress * 100)}%`}
          </span>
        </motion.div>
      </div>
    </div>
  );
}

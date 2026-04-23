import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { DailyMiniProps } from "./types";

const SIZE = 5;
const TOTAL = SIZE * SIZE;
const TARGET_SECONDS = 40;

function shuffled(): number[] {
  const arr = Array.from({ length: TOTAL }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function SchulteMini({ onComplete }: DailyMiniProps) {
  const [grid] = useState<number[]>(() => shuffled());
  const [next, setNext] = useState(1);
  const [shake, setShake] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef(Date.now());
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    tickRef.current = window.setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 100);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, []);

  const onTap = (n: number) => {
    if (n !== next) {
      setShake((s) => s + 1);
      return;
    }
    if (n === TOTAL) {
      const sec = (Date.now() - startedAtRef.current) / 1000;
      const score = Math.max(
        50,
        Math.round(400 - sec * 4 + Math.max(0, (TARGET_SECONDS - sec) * 5))
      );
      onComplete(score);
      return;
    }
    setNext(n + 1);
  };

  const cells = useMemo(() => grid, [grid]);

  return (
    <div className="space-y-3" data-testid="mini-schulte">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          Next:{" "}
          <span className="font-bold text-slate-900 dark:text-white">{next}</span>
        </span>
        <span>{elapsed.toFixed(1)}s</span>
      </div>
      <motion.div
        role="grid"
        aria-label={`Schulte table, tap ${next} next`}
        className="mx-auto grid aspect-square w-full max-w-md grid-cols-5 gap-1.5 sm:gap-2"
        animate={shake > 0 ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.25 }}
        key={`shake-${shake}`}
      >
        {cells.map((n, i) => {
          const done = n < next;
          return (
            <button
              key={`${n}-${i}`}
              type="button"
              role="gridcell"
              data-testid="cell"
              data-value={n}
              onClick={() => onTap(n)}
              className={
                "relative aspect-square min-h-[44px] rounded-xl text-xl font-bold transition-colors sm:text-2xl " +
                (done
                  ? "bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600"
                  : "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-brand-50 dark:bg-slate-900 dark:text-white dark:ring-slate-700")
              }
            >
              {n}
            </button>
          );
        })}
      </motion.div>
    </div>
  );
}

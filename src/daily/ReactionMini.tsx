import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { haptic } from "@/lib/haptics";
import type { DailyMiniProps } from "./types";

const TRIALS = 4;
type TrialState = "waiting" | "ready" | "tooSoon" | "feedback";

export function ReactionMini({ onComplete }: DailyMiniProps) {
  const [trial, setTrial] = useState(0);
  const [state, setState] = useState<TrialState>("waiting");
  const [lastMs, setLastMs] = useState<number | null>(null);
  const scoreRef = useRef(0);
  const startAt = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const arm = () => {
    setState("waiting");
    setLastMs(null);
    const delay = 900 + Math.random() * 1700;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      startAt.current = performance.now();
      setState("ready");
    }, delay);
  };

  useEffect(() => {
    arm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextTrial = () => {
    const n = trial + 1;
    if (n >= TRIALS) {
      onComplete(scoreRef.current);
    } else {
      setTrial(n);
      arm();
    }
  };

  const onTap = () => {
    if (state === "ready") {
      const ms = performance.now() - startAt.current;
      const pts = Math.max(10, Math.round((800 - ms) / 3));
      scoreRef.current += pts;
      setLastMs(ms);
      haptic.success();
      setState("feedback");
      window.setTimeout(nextTrial, 650);
    } else if (state === "waiting") {
      clearTimer();
      haptic.error();
      setState("tooSoon");
    } else if (state === "tooSoon") {
      arm();
    }
  };

  const bg =
    state === "ready"
      ? "bg-emerald-500"
      : state === "tooSoon"
      ? "bg-rose-500"
      : state === "feedback"
      ? "bg-slate-100 dark:bg-slate-800"
      : "bg-slate-800";

  return (
    <div className="space-y-3" data-testid="mini-reaction">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Trial {Math.min(trial + 1, TRIALS)} / {TRIALS}</span>
        {lastMs !== null && state === "feedback" && (
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {Math.round(lastMs)} ms
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onTap}
        className={
          "no-select grid min-h-[50vh] w-full place-items-center rounded-3xl px-6 text-center text-xl font-bold text-white transition-colors sm:text-2xl " +
          bg
        }
      >
        <AnimatePresence mode="wait">
          {state === "waiting" && (
            <motion.span key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Wait for green…
            </motion.span>
          )}
          {state === "ready" && (
            <motion.span
              key="ready"
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 16 }}
            >
              Tap!
            </motion.span>
          )}
          {state === "tooSoon" && (
            <motion.span key="tooSoon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              Too soon — tap to retry
            </motion.span>
          )}
          {state === "feedback" && (
            <motion.span key="feedback" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="text-slate-900 dark:text-white">
                +{Math.max(10, Math.round((800 - (lastMs ?? 0)) / 3))}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}

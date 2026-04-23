import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { haptic } from "@/lib/haptics";
import type { DailyMiniProps } from "./types";

type Color = "red" | "green" | "blue" | "yellow";

const COLORS: Color[] = ["red", "green", "blue", "yellow"];
const COLOR_HEX: Record<Color, string> = {
  red: "#ef4444",
  green: "#10b981",
  blue: "#3b82f6",
  yellow: "#eab308",
};
const COLOR_LABEL: Record<Color, string> = {
  red: "RED",
  green: "GREEN",
  blue: "BLUE",
  yellow: "YELLOW",
};

const TRIALS = 6;
const WINDOW_MS = 2000;
const FALSE_ALARM_PENALTY = -5;

type Trial = { word: Color; ink: Color };

function pickIncongruent(): Trial {
  const ink = COLORS[Math.floor(Math.random() * COLORS.length)];
  let word = ink;
  while (word === ink) {
    word = COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  return { word, ink };
}

function scoreForHit(ms: number): number {
  return Math.max(15, Math.round((900 - ms) / 4));
}

export function StroopMini({ onComplete }: DailyMiniProps) {
  const [trialIdx, setTrialIdx] = useState(0);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [flash, setFlash] = useState<"hit" | "wrong" | "miss" | null>(null);
  const [flashPts, setFlashPts] = useState<number | null>(null);

  const scoreRef = useRef(0);
  const startAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const respondedRef = useRef(false);
  const doneRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    clearTimer();
    onComplete(scoreRef.current);
  }, [onComplete]);

  const nextTrial = useCallback(
    (i: number) => {
      if (doneRef.current) return;
      if (i >= TRIALS) {
        finish();
        return;
      }
      setTrial(pickIncongruent());
      setTrialIdx(i);
      respondedRef.current = false;
      startAtRef.current = performance.now();
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        if (respondedRef.current || doneRef.current) return;
        respondedRef.current = true;
        setFlash("miss");
        setFlashPts(null);
        setTrial(null);
        window.setTimeout(() => {
          setFlash(null);
          nextTrial(i + 1);
        }, 400);
      }, WINDOW_MS);
    },
    [finish]
  );

  useEffect(() => {
    nextTrial(0);
    return () => {
      clearTimer();
    };
  }, [nextTrial]);

  const handleTap = (choice: Color) => {
    if (!trial || respondedRef.current || doneRef.current) return;
    respondedRef.current = true;
    clearTimer();
    const ms = performance.now() - startAtRef.current;
    if (choice === trial.ink) {
      const pts = scoreForHit(ms);
      scoreRef.current += pts;
      haptic.success();
      setFlash("hit");
      setFlashPts(pts);
    } else {
      scoreRef.current = Math.max(0, scoreRef.current + FALSE_ALARM_PENALTY);
      haptic.error();
      setFlash("wrong");
      setFlashPts(FALSE_ALARM_PENALTY);
    }
    setTrial(null);
    window.setTimeout(() => {
      setFlash(null);
      nextTrial(trialIdx + 1);
    }, 400);
  };

  return (
    <div className="space-y-3" data-testid="mini-stroop">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          Trial {Math.min(trialIdx + 1, TRIALS)} / {TRIALS}
        </span>
        <span className="font-semibold">Tap the INK colour</span>
      </div>

      <div className="no-select relative grid min-h-[44vh] w-full place-items-center overflow-hidden rounded-3xl bg-slate-100 px-4 py-6 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex w-full max-w-md flex-col items-center gap-5">
          <div className="relative flex min-h-[120px] w-full items-center justify-center">
            <AnimatePresence mode="wait">
              {trial && !flash && (
                <motion.span
                  key={`stim-${trialIdx}`}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-5xl font-black tracking-wider sm:text-6xl"
                  style={{ color: COLOR_HEX[trial.ink] }}
                  data-testid="mini-stimulus"
                  data-ink={trial.ink}
                  data-word={trial.word}
                >
                  {COLOR_LABEL[trial.word]}
                </motion.span>
              )}
              {flash && (
                <motion.span
                  key={`flash-${trialIdx}-${flash}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={
                    "text-xl font-bold sm:text-2xl " +
                    (flash === "hit"
                      ? "text-emerald-600 dark:text-emerald-300"
                      : flash === "wrong"
                      ? "text-rose-600 dark:text-rose-300"
                      : "text-amber-600 dark:text-amber-300")
                  }
                >
                  {flash === "hit" && flashPts !== null
                    ? `+${flashPts}`
                    : flash === "wrong" && flashPts !== null
                    ? `${flashPts} · wrong`
                    : "missed"}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <div className="grid w-full grid-cols-4 gap-3">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleTap(c)}
                aria-label={`Choose ${c}`}
                data-testid="mini-choice"
                data-choice-color={c}
                className="grid place-items-center rounded-2xl bg-white p-3 shadow-soft ring-1 ring-slate-200 transition-transform active:scale-95 dark:bg-slate-800 dark:ring-slate-700"
              >
                <div
                  className="h-14 w-14 rounded-xl"
                  style={{ backgroundColor: COLOR_HEX[c] }}
                />
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {c}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

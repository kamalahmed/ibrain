import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LevelProgress } from "@/components/LevelProgress";

type Props = {
  levelTotal: number;
  /** 1-indexed active level. */
  levelCurrent: number;
  levelsCleared: number;
  score: number;
  /** Seconds remaining in the session. */
  timeLeft: number;
  /** Full session length in seconds — drives the time bar. */
  sessionSeconds: number;
  /** Extra chips (combo, lives, …) rendered before the score. */
  extra?: ReactNode;
};

/**
 * Shared in-game HUD: level pips, a score that pops when it changes, and a
 * draining session-time bar that turns urgent in the final seconds. One look
 * across all seven games so the session structure is always legible.
 */
export function GameHUD({
  levelTotal,
  levelCurrent,
  levelsCleared,
  score,
  timeLeft,
  sessionSeconds,
  extra,
}: Props) {
  const urgent = timeLeft <= 15;
  const frac = Math.max(0, Math.min(1, timeLeft / sessionSeconds));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LevelProgress
          total={levelTotal}
          current={levelCurrent}
          cleared={levelsCleared}
          label="Level"
        />
        <div className="flex items-center gap-2">
          {extra}
          <span className="chip tabular-nums" data-testid="score">
            <span className="relative inline-flex min-w-[2ch] justify-end overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={score}
                  initial={{ y: -14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 14, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  className="inline-block"
                >
                  {score}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="ml-1">pts</span>
          </span>
          <span
            className={
              "chip tabular-nums " +
              (urgent
                ? "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800"
                : "")
            }
            data-testid="timer"
          >
            {formatSessionTime(timeLeft)}
          </span>
        </div>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/80"
        role="progressbar"
        aria-label="Session time remaining"
        aria-valuemin={0}
        aria-valuemax={sessionSeconds}
        aria-valuenow={timeLeft}
      >
        <div
          className={
            "h-full rounded-full transition-[width] duration-300 ease-linear " +
            (urgent
              ? "animate-pulse-soft bg-rose-500"
              : "bg-gradient-to-r from-brand-500 to-accent-teal")
          }
          style={{ width: `${frac * 100}%` }}
        />
      </div>
    </div>
  );
}

export function formatSessionTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

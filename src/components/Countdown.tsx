import { useEffect, useReducer } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

type Props = {
  from?: number;
  onDone: () => void;
};

/** ms each number stays on screen */
const STEP_MS = 700;
/** ms the "Go!" beat holds before play begins */
const GO_MS = 550;

export function Countdown({ from = 3, onDone }: Props) {
  const reduceMotion = useReducedMotion();
  // counts `from` -> ... -> 1 -> 0, where 0 renders the "Go!" beat
  const [n, advance] = useReducer((v: number) => v - 1, from);

  useEffect(() => {
    const isGo = n <= 0;
    const id = window.setTimeout(
      () => (isGo ? onDone() : advance()),
      isGo ? GO_MS : STEP_MS
    );
    return () => window.clearTimeout(id);
  }, [n, onDone]);

  const steps = from + 1; // numbers + the "Go!" beat
  const progress = (from - n + 1) / steps;
  const beatSec = (n <= 0 ? GO_MS : STEP_MS) / 1000;
  const isGo = n <= 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-[40vh] place-items-center"
    >
      <div className="relative grid h-44 w-44 place-items-center sm:h-60 sm:w-60">
        {/* progress ring — advances one segment per beat, so it finishes
            exactly when the "Go!" beat ends */}
        <svg
          className="absolute inset-0 h-full w-full -rotate-90"
          viewBox="0 0 100 100"
          aria-hidden
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="3"
            className="stroke-slate-200/80 dark:stroke-slate-700/80"
          />
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className="stroke-brand-500"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: progress }}
            transition={{ duration: reduceMotion ? 0 : beatSec, ease: "linear" }}
          />
        </svg>

        <AnimatePresence>
          <motion.div
            key={n}
            initial={reduceMotion ? { opacity: 0 } : { scale: 0.5, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { scale: 1.5, opacity: 0 }}
            transition={
              reduceMotion
                ? { duration: 0.15 }
                : { type: "spring", stiffness: 280, damping: 22 }
            }
            className={
              "col-start-1 row-start-1 grid h-32 w-32 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-accent-teal font-black text-white shadow-soft sm:h-44 sm:w-44 " +
              (isGo ? "text-4xl sm:text-5xl" : "text-6xl sm:text-7xl")
            }
          >
            {isGo ? "Go!" : n}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

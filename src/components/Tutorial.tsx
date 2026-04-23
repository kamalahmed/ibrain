import { ReactNode, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type TutorialStep = {
  /** Narration shown above the stage */
  caption: ReactNode;
  /** Optional stage content (animation / graphic) */
  stage?: ReactNode;
  /** Auto-advance after N ms. Omit for interactive steps. */
  auto?: number;
  /** If true, step requires user action — call onAdvance externally. */
  interactive?: boolean;
};

type Props = {
  steps: TutorialStep[];
  onDone: () => void;
  onSkip?: () => void;
};

export function Tutorial({ steps, onDone, onSkip }: Props) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const isLast = i === steps.length - 1;

  useEffect(() => {
    if (!step || step.interactive) return;
    if (step.auto === undefined) return;
    const t = window.setTimeout(() => {
      if (isLast) onDone();
      else setI((v) => v + 1);
    }, step.auto);
    return () => window.clearTimeout(t);
  }, [step, i, isLast, onDone]);

  if (!step) return null;

  const next = () => {
    if (isLast) onDone();
    else setI((v) => v + 1);
  };

  return (
    <section
      aria-label="Tutorial"
      className="card relative overflow-hidden"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {steps.map((_, j) => (
            <span
              key={j}
              className={
                "h-1.5 w-6 rounded-full transition-colors " +
                (j <= i ? "bg-brand-600" : "bg-slate-200 dark:bg-slate-700")
              }
              aria-hidden
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => (onSkip ?? onDone)()}
          className="text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Skip tutorial
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22 }}
          className="min-h-[46vh]"
        >
          <div className="mb-4 text-center text-base font-semibold text-slate-800 dark:text-slate-100 sm:text-lg">
            {step.caption}
          </div>
          <div className="relative">{step.stage}</div>
        </motion.div>
      </AnimatePresence>

      {!step.interactive && step.auto === undefined && (
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={next} className="btn-primary">
            {isLast ? "I'm ready" : "Next"}
          </button>
        </div>
      )}
    </section>
  );
}

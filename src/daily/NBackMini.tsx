import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { DailyMiniProps } from "./types";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const N = 2;
const TOTAL = 14;
const INTERVAL_MS = 1800;

function genSequence(): string[] {
  const seq: string[] = [];
  for (let i = 0; i < TOTAL; i++) {
    if (i >= N && Math.random() < 0.4) {
      seq.push(seq[i - N]);
    } else {
      let choice = LETTERS[Math.floor(Math.random() * LETTERS.length)];
      if (i >= N && choice === seq[i - N]) {
        choice = LETTERS[(LETTERS.indexOf(choice) + 1) % LETTERS.length];
      }
      seq.push(choice);
    }
  }
  return seq;
}

export function NBackMini({ onComplete }: DailyMiniProps) {
  const [seq] = useState<string[]>(() => genSequence());
  const [idx, setIdx] = useState(0);
  const [hits, setHits] = useState(0);
  const scoreRef = useRef(0);
  const hitsRef = useRef(0);
  const idxRef = useRef(0);
  const respondedRef = useRef<boolean[]>(new Array(TOTAL).fill(false));
  const timerRef = useRef<number | null>(null);
  const endedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const evaluate = (i: number) => {
    if (i < N) return;
    const isTarget = seq[i] === seq[i - N];
    const responded = respondedRef.current[i] === true;
    if (isTarget && responded) {
      scoreRef.current += 15;
      hitsRef.current += 1;
      setHits(hitsRef.current);
    } else if (!isTarget && responded) {
      scoreRef.current = Math.max(0, scoreRef.current - 5);
    } else if (!isTarget && !responded) {
      scoreRef.current += 3;
    }
  };

  const advance = useCallback(() => {
    evaluate(idxRef.current);
    const n = idxRef.current + 1;
    if (n >= TOTAL) {
      if (!endedRef.current) {
        endedRef.current = true;
        clearTimer();
        onComplete(Math.max(0, scoreRef.current));
      }
      return;
    }
    idxRef.current = n;
    setIdx(n);
    timerRef.current = window.setTimeout(advance, INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  useEffect(() => {
    timerRef.current = window.setTimeout(advance, INTERVAL_MS);
    return () => clearTimer();
  }, [advance]);

  const onMatch = useCallback(() => {
    const i = idxRef.current;
    if (i < N) return;
    if (respondedRef.current[i]) return;
    respondedRef.current[i] = true;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "m" || e.key === "M") {
        e.preventDefault();
        onMatch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onMatch]);

  const current = idx < TOTAL ? seq[idx] : null;

  return (
    <div className="space-y-3" data-testid="mini-nback">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Letter {Math.min(idx + 1, TOTAL)} / {TOTAL}</span>
        <span>{hits} hits</span>
      </div>
      <div className="grid min-h-[32vh] place-items-center rounded-3xl bg-white/80 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.18 }}
            className="bg-gradient-to-br from-brand-600 to-accent-teal bg-clip-text text-[8rem] font-black leading-none text-transparent sm:text-[11rem]"
          >
            {current ?? "•"}
          </motion.div>
        </AnimatePresence>
      </div>
      <button
        type="button"
        onClick={onMatch}
        disabled={idx < N}
        className="btn-primary w-full min-h-[56px] text-lg disabled:opacity-50"
      >
        Match (space)
      </button>
      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
        Press Match when the current letter equals the one 2 steps back.
      </p>
    </div>
  );
}

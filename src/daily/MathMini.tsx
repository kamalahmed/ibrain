import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { DailyMiniProps } from "./types";

type Op = "+" | "-" | "×";
type Problem = { text: string; answer: number; choices: number[] };

const DURATION_S = 45;
const POINTS_CORRECT = 25;

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function reversed(n: number): number {
  const s = String(Math.abs(n));
  return parseInt(s.split("").reverse().join(""), 10);
}

function makeProblem(): Problem {
  const ops: Op[] = ["+", "-", "×"];
  const op = ops[randInt(0, ops.length - 1)];
  let a: number, b: number, answer: number;
  if (op === "×") {
    a = randInt(2, 12);
    b = randInt(2, 12);
    answer = a * b;
  } else if (op === "+") {
    a = randInt(10, 60);
    b = randInt(10, 60);
    answer = a + b;
  } else {
    a = randInt(20, 99);
    b = randInt(1, a);
    answer = a - b;
  }
  const pool = new Set<number>();
  pool.add(answer);
  if (answer >= 10) {
    const swap = reversed(answer);
    if (swap !== answer && swap >= 0) pool.add(swap);
  }
  const offsets = [1, -1, 2, -2, 10, -10, 3, -3];
  for (const o of offsets) {
    if (pool.size >= 4) break;
    const v = answer + o;
    if (v < 0) continue;
    pool.add(v);
  }
  while (pool.size < 4) pool.add(answer + pool.size + 3);
  const choices = Array.from(pool).slice(0, 4);
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { text: `${a} ${op} ${b}`, answer, choices };
}

export function MathMini({ onComplete }: DailyMiniProps) {
  const [problem, setProblem] = useState<Problem>(() => makeProblem());
  const [timeLeft, setTimeLeft] = useState(DURATION_S);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const scoreRef = useRef(0);
  const deadlineRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const endedRef = useRef(false);

  useEffect(() => {
    deadlineRef.current = Date.now() + DURATION_S * 1000;
    tickRef.current = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0 && !endedRef.current) {
        endedRef.current = true;
        if (tickRef.current) window.clearInterval(tickRef.current);
        onComplete(scoreRef.current);
      }
    }, 200);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChoice = (n: number) => {
    if (endedRef.current) return;
    if (n === problem.answer) {
      scoreRef.current += POINTS_CORRECT;
      setCorrect((c) => c + 1);
      setFlash("ok");
    } else {
      setWrong((w) => w + 1);
      setFlash("bad");
    }
    window.setTimeout(() => setFlash(null), 200);
    setProblem(makeProblem());
  };

  return (
    <div className="space-y-3" data-testid="mini-math">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{correct} correct · {wrong} wrong</span>
        <span className={timeLeft <= 10 ? "font-bold text-rose-600 dark:text-rose-300" : ""}>
          {timeLeft}s
        </span>
      </div>
      <div
        className={
          "relative grid min-h-[22vh] place-items-center rounded-3xl p-4 ring-1 transition-colors " +
          (flash === "ok"
            ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-900/40 dark:ring-emerald-800"
            : flash === "bad"
            ? "bg-rose-50 ring-rose-200 dark:bg-rose-900/40 dark:ring-rose-800"
            : "bg-white/80 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800")
        }
      >
        <AnimatePresence mode="wait">
          <motion.p
            key={problem.text + correct + wrong}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="text-4xl font-black text-slate-900 dark:text-white sm:text-5xl"
          >
            {problem.text} = ?
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {problem.choices.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChoice(n)}
            data-testid="choice"
            data-value={n}
            className="min-h-[60px] rounded-2xl bg-white text-2xl font-black text-slate-900 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:ring-brand-300 active:scale-[0.98] dark:bg-slate-900 dark:text-white dark:ring-slate-700"
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

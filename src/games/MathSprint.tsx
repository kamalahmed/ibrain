import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";

type Phase = "intro" | "countdown" | "playing" | "done";

type Op = "+" | "-" | "×" | "÷";

type Problem = { a: number; b: number; op: Op; answer: number; text: string };

const DURATION_S = 60;
const WRONG_PENALTY_S = 3;

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeProblem(): Problem {
  const ops: Op[] = ["+", "-", "×", "÷"];
  const op = ops[randInt(0, ops.length - 1)];
  let a: number, b: number, answer: number;
  switch (op) {
    case "+":
      a = randInt(10, 99);
      b = randInt(10, 99);
      answer = a + b;
      break;
    case "-":
      a = randInt(20, 99);
      b = randInt(1, a);
      answer = a - b;
      break;
    case "×":
      a = randInt(2, 12);
      b = randInt(2, 12);
      answer = a * b;
      break;
    case "÷":
      b = randInt(2, 12);
      answer = randInt(2, 12);
      a = b * answer;
      break;
  }
  return { a, b, op, answer, text: `${a} ${op} ${b}` };
}

export default function MathSprint() {
  const game = getGame("math");
  const recordPlay = useStore((s) => s.recordPlay);

  const [phase, setPhase] = useState<Phase>("intro");
  const [problem, setProblem] = useState<Problem>(makeProblem);
  const [input, setInput] = useState("");
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [timeLeft, setTimeLeft] = useState(DURATION_S);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [isBest, setIsBest] = useState(false);
  const [finalScore, setFinalScore] = useState(0);

  const timerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const endedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const end = useCallback(
    (finalCorrect: number) => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearTimer();
      const { isBest: best } = recordPlay("math", finalCorrect);
      setFinalScore(finalCorrect);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  useEffect(() => () => clearTimer(), []);

  const begin = () => {
    setCorrect(0);
    setWrong(0);
    setInput("");
    setTimeLeft(DURATION_S);
    setProblem(makeProblem());
    endedRef.current = false;
    setPhase("countdown");
  };

  const startPlay = () => {
    setPhase("playing");
    clearTimer();
    timerRef.current = window.setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          end(correctRef.current);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    // focus the input after mount
    window.setTimeout(() => inputRef.current?.focus(), 50);
  };

  const correctRef = useRef(0);
  useEffect(() => {
    correctRef.current = correct;
  }, [correct]);

  const submit = () => {
    if (phase !== "playing") return;
    const parsed = Number(input.trim());
    if (!Number.isFinite(parsed) || input.trim() === "") return;
    if (parsed === problem.answer) {
      setCorrect((c) => c + 1);
      setFlash("ok");
      setProblem(makeProblem());
      setInput("");
    } else {
      setWrong((w) => w + 1);
      setFlash("bad");
      setInput("");
      setTimeLeft((t) => {
        const nt = Math.max(0, t - WRONG_PENALTY_S);
        if (nt === 0) end(correctRef.current);
        return nt;
      });
    }
    window.setTimeout(() => setFlash(null), 260);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          You have {DURATION_S} seconds. Solve each problem and press enter.
          Wrong answers cost {WRONG_PENALTY_S}s.
        </Instructions>
      )}

      {phase === "countdown" && <Countdown onDone={startPlay} />}

      {phase === "playing" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="chip">Correct: {correct}</span>
            <span
              className={
                "chip " +
                (timeLeft <= 10
                  ? "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800"
                  : "")
              }
            >
              {timeLeft}s
            </span>
            <span className="chip">Wrong: {wrong}</span>
          </div>

          <div
            className={
              "relative grid min-h-[26vh] place-items-center rounded-3xl p-4 ring-1 transition-colors " +
              (flash === "ok"
                ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-900/40 dark:ring-emerald-800"
                : flash === "bad"
                ? "bg-rose-50 ring-rose-200 dark:bg-rose-900/40 dark:ring-rose-800"
                : "bg-white/80 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800")
            }
          >
            <AnimatePresence mode="wait">
              <motion.p
                key={problem.text}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="text-5xl font-black text-slate-900 dark:text-white sm:text-6xl"
                aria-live="polite"
              >
                {problem.text} = ?
              </motion.p>
            </AnimatePresence>
          </div>

          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              pattern="[0-9-]*"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Your answer"
              aria-label="Your answer"
              className="min-h-[56px] flex-1 rounded-2xl bg-white px-4 text-2xl font-bold text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-slate-900 dark:text-white dark:ring-slate-700"
              autoFocus
            />
            <button type="submit" className="btn-primary min-h-[56px]">
              Enter
            </button>
          </form>
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${correct} correct · ${wrong} wrong`}
        />
      )}
    </GameShell>
  );
}

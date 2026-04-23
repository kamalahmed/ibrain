import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";

type Phase = "intro" | "tutorial" | "countdown" | "playing" | "done";

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
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [problem, setProblem] = useState<Problem>(makeProblem);
  const [input, setInput] = useState("");
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [timeLeft, setTimeLeft] = useState(DURATION_S);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [isBest, setIsBest] = useState(false);
  const [finalScore, setFinalScore] = useState(0);

  const deadlineRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const endedRef = useRef(false);
  const correctRef = useRef(0);

  useEffect(() => {
    correctRef.current = correct;
  }, [correct]);

  const stopTick = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  useEffect(() => () => stopTick(), []);

  const end = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopTick();
    const finalCorrect = correctRef.current;
    const { isBest: best } = recordPlay("math", finalCorrect);
    setFinalScore(finalCorrect);
    setIsBest(best);
    setPhase("done");
  }, [recordPlay]);

  const computeTimeLeft = () => {
    const ms = deadlineRef.current - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  };

  const begin = () => {
    setCorrect(0);
    correctRef.current = 0;
    setWrong(0);
    setInput("");
    setTimeLeft(DURATION_S);
    setProblem(makeProblem());
    endedRef.current = false;
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  const startPlay = () => {
    setPhase("playing");
    deadlineRef.current = Date.now() + DURATION_S * 1000;
    setTimeLeft(DURATION_S);
    stopTick();
    tickRef.current = window.setInterval(() => {
      const left = computeTimeLeft();
      setTimeLeft(left);
      if (left <= 0) end();
    }, 200);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  };

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
      // Deadline-based penalty: move the deadline earlier.
      deadlineRef.current -= WRONG_PENALTY_S * 1000;
      const left = computeTimeLeft();
      setTimeLeft(left);
      if (left <= 0) end();
    }
    window.setTimeout(() => setFlash(null), 260);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "You'll see a simple arithmetic problem.",
      stage: (
        <div className="grid min-h-[22vh] place-items-center rounded-2xl bg-white/80 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <p className="text-5xl font-black text-slate-900 dark:text-white">
            12 × 4 = ?
          </p>
        </div>
      ),
    },
    {
      caption: "Type the answer and press Enter.",
      stage: (
        <div className="mx-auto max-w-sm space-y-2">
          <div className="flex items-center justify-center rounded-2xl bg-emerald-50 p-4 text-3xl font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800">
            48 ✓
          </div>
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Correct → next problem
          </p>
        </div>
      ),
    },
    {
      caption: `Wrong answer costs ${WRONG_PENALTY_S} seconds. Use the full ${DURATION_S} seconds wisely.`,
      stage: (
        <div className="mx-auto max-w-sm space-y-2">
          <div className="flex items-center justify-center rounded-2xl bg-rose-50 p-4 text-3xl font-bold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800">
            45 ✗ −{WRONG_PENALTY_S}s
          </div>
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Score = number of correct answers
          </p>
        </div>
      ),
    },
  ];

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          You have {DURATION_S} seconds. Solve each problem and press enter.
          Wrong answers cost {WRONG_PENALTY_S}s.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
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

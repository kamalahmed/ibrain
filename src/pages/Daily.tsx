import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useStore } from "@/store/useStore";
import { Confetti } from "@/components/Confetti";
import { DAILY_GAMES } from "@/daily/types";
import { ReactionMini } from "@/daily/ReactionMini";
import { MathMini } from "@/daily/MathMini";
import { SchulteMini } from "@/daily/SchulteMini";
import { MemoryMini } from "@/daily/MemoryMini";
import { NBackMini } from "@/daily/NBackMini";
import { PondMini } from "@/daily/PondMini";
import { StroopMini } from "@/daily/StroopMini";
import { todayKey } from "@/lib/date";

type Phase = "intro" | "transition" | "playing" | "done";

export default function Daily() {
  const recordDaily = useStore((s) => s.recordDaily);
  const dailyStreak = useStore((s) => s.dailyStreak);
  const bestDaily = useStore((s) => s.bestDaily);
  const lastDailyDate = useStore((s) => s.lastDailyDate);
  const dailyResults = useStore((s) => s.dailyResults);

  const [phase, setPhase] = useState<Phase>("intro");
  const [stepIdx, setStepIdx] = useState(0);
  const [scores, setScores] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [isPractice, setIsPractice] = useState(false);
  const [newStreak, setNewStreak] = useState(dailyStreak);

  const alreadyDoneToday = lastDailyDate === todayKey();
  const todayResult = useMemo(
    () =>
      dailyResults.find(
        (r) => r.date === todayKey() && !r.isPractice
      ),
    [dailyResults]
  );

  const transitionRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (transitionRef.current !== null) {
        window.clearTimeout(transitionRef.current);
      }
    },
    []
  );

  const begin = () => {
    setPhase("transition");
    setStepIdx(0);
    setScores([]);
    setTotal(0);
    setIsBest(false);
    setIsPractice(false);
    // brief transition card, then first mini-game
    if (transitionRef.current !== null) window.clearTimeout(transitionRef.current);
    transitionRef.current = window.setTimeout(() => setPhase("playing"), 1000);
  };

  const onMiniComplete = (score: number) => {
    const nextScores = [...scores, score];
    setScores(nextScores);
    const nextStep = stepIdx + 1;
    if (nextStep >= DAILY_GAMES.length) {
      // session done
      const t = nextScores.reduce((a, b) => a + b, 0);
      setTotal(t);
      const perGame = DAILY_GAMES.map((g, i) => ({
        game: g.id,
        score: nextScores[i] ?? 0,
      }));
      const result = recordDaily(t, perGame);
      setIsBest(result.isBest);
      setIsPractice(result.isPractice);
      setNewStreak(result.streak);
      setPhase("done");
      return;
    }
    setStepIdx(nextStep);
    setPhase("transition");
    if (transitionRef.current !== null) window.clearTimeout(transitionRef.current);
    transitionRef.current = window.setTimeout(() => setPhase("playing"), 900);
  };

  const currentSlot = DAILY_GAMES[stepIdx];
  const currentKey = `${stepIdx}-${currentSlot.id}-${phase}`;

  return (
    <main className="mx-auto w-full max-w-3xl safe-px pb-16 pt-4 sm:pt-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link to="/dashboard" className="btn-ghost -ml-2 text-sm">
          <span aria-hidden>←</span> Dashboard
        </Link>
      </div>

      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mb-5 rounded-3xl bg-gradient-to-br from-brand-600 via-accent-blue to-accent-teal p-5 text-white shadow-soft"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 text-2xl backdrop-blur">
            <span aria-hidden>🗓️</span>
          </div>
          <div>
            <h1 className="text-xl font-extrabold sm:text-2xl">Daily Challenge</h1>
            <p className="text-sm text-white/90">
              One short run of each game — ~5 minutes total.
            </p>
          </div>
        </div>
      </motion.header>

      {phase === "intro" && (
        <section className="card animate-fade-in">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            {alreadyDoneToday ? "You already trained today" : "Today's training"}
          </h2>
          <p className="mt-2 text-slate-700 dark:text-slate-300">
            {alreadyDoneToday
              ? "You can still practice — the score won't change your streak."
              : `You'll play a short version of all ${DAILY_GAMES.length} games back-to-back. One composite score, one shot for the day's streak.`}
          </p>

          {alreadyDoneToday && todayResult && (
            <div className="mt-4 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:ring-emerald-800">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                Today's score: {todayResult.totalScore} pts
              </p>
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                Completed at{" "}
                {new Date(todayResult.completedAt).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          )}

          <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {DAILY_GAMES.map((g) => (
              <li
                key={g.id}
                className="rounded-2xl bg-white/80 p-3 text-center ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800"
              >
                <div className="text-2xl" aria-hidden>
                  {g.emoji}
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {g.label}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  ~{g.estimatedSeconds}s
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm">
              <div>
                <span className="text-slate-500 dark:text-slate-400">Streak</span>{" "}
                <span className="font-bold text-slate-900 dark:text-white">
                  {dailyStreak} {dailyStreak === 1 ? "day" : "days"}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400">Best</span>{" "}
                <span className="font-bold text-slate-900 dark:text-white">
                  {bestDaily} pts
                </span>
              </div>
            </div>
            <button type="button" className="btn-primary" onClick={begin} data-testid="daily-start">
              {alreadyDoneToday ? "Practice" : "Start"}
            </button>
          </div>
        </section>
      )}

      {(phase === "transition" || phase === "playing") && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5" aria-label="Daily progress">
              {DAILY_GAMES.map((g, i) => {
                const s: "done" | "active" | "todo" =
                  i < stepIdx ? "done" : i === stepIdx ? "active" : "todo";
                return (
                  <span
                    key={g.id}
                    className={
                      "grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold " +
                      (s === "done"
                        ? "bg-brand-600 text-white"
                        : s === "active"
                        ? "bg-white text-brand-700 ring-2 ring-brand-500 dark:bg-slate-900 dark:text-brand-300 dark:ring-brand-400"
                        : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400")
                    }
                    title={g.label}
                  >
                    {s === "done" ? "✓" : g.emoji}
                  </span>
                );
              })}
            </div>
            <span className="chip" data-testid="running-total">
              Total {scores.reduce((a, b) => a + b, 0)} pts
            </span>
          </div>

          <AnimatePresence mode="wait">
            {phase === "transition" && (
              <motion.div
                key="transition"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                className="mx-auto grid min-h-[50vh] max-w-md place-items-center rounded-3xl bg-gradient-to-br from-brand-500 to-accent-teal p-6 text-center text-white shadow-soft"
                data-testid="daily-transition"
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-white/80">
                    Up next
                  </p>
                  <div className="mt-2 text-6xl" aria-hidden>
                    {currentSlot.emoji}
                  </div>
                  <p className="mt-2 text-2xl font-black">{currentSlot.label}</p>
                  <p className="mt-2 text-sm text-white/90">
                    Game {stepIdx + 1} of {DAILY_GAMES.length}
                  </p>
                </div>
              </motion.div>
            )}
            {phase === "playing" && (
              <motion.div
                key={currentKey}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
              >
                {currentSlot.id === "reaction" && <ReactionMini onComplete={onMiniComplete} />}
                {currentSlot.id === "math" && <MathMini onComplete={onMiniComplete} />}
                {currentSlot.id === "schulte" && <SchulteMini onComplete={onMiniComplete} />}
                {currentSlot.id === "memory" && <MemoryMini onComplete={onMiniComplete} />}
                {currentSlot.id === "nback" && <NBackMini onComplete={onMiniComplete} />}
                {currentSlot.id === "pond" && <PondMini onComplete={onMiniComplete} />}
                {currentSlot.id === "stroop" && <StroopMini onComplete={onMiniComplete} />}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {phase === "done" && (
        <section
          className="card relative overflow-hidden text-center"
          data-testid="daily-done"
        >
          {isBest && <Confetti />}
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {isPractice ? "Practice complete" : isBest ? "New daily best!" : "Daily complete"}
          </h2>
          <p className="mt-2 text-5xl font-black text-slate-900 dark:text-white sm:text-6xl">
            {total} pts
          </p>
          {!isPractice && (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
              Streak:{" "}
              <span className="font-bold text-slate-900 dark:text-white">
                {newStreak} {newStreak === 1 ? "day" : "days"}
              </span>
              {" · "}Personal best:{" "}
              <span className="font-bold text-slate-900 dark:text-white">
                {Math.max(bestDaily, total)} pts
              </span>
            </p>
          )}

          <ul className="mx-auto mt-5 grid max-w-md grid-cols-2 gap-2 text-left sm:grid-cols-3">
            {DAILY_GAMES.map((g, i) => (
              <li
                key={g.id}
                className="flex items-center gap-2 rounded-2xl bg-white/80 p-3 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800"
              >
                <span className="text-xl" aria-hidden>
                  {g.emoji}
                </span>
                <div className="text-xs">
                  <div className="font-semibold text-slate-700 dark:text-slate-200">
                    {g.label}
                  </div>
                  <div className="text-slate-900 dark:text-white">
                    {scores[i] ?? 0} pts
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" className="btn-primary" onClick={begin}>
              Play again
            </button>
            <Link to="/dashboard" className="btn-secondary">
              Back to dashboard
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

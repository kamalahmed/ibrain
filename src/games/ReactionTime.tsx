import { useCallback, useEffect, useRef, useState } from "react";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { ResultsScreen } from "@/components/ResultsScreen";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";

type Phase = "intro" | "waiting" | "ready" | "tooSoon" | "done";

const TRIALS = 5;

export default function ReactionTime() {
  const game = getGame("reaction");
  const recordPlay = useStore((s) => s.recordPlay);

  const [phase, setPhase] = useState<Phase>("intro");
  const [trial, setTrial] = useState(0);
  const [times, setTimes] = useState<number[]>([]);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [isBest, setIsBest] = useState(false);
  const startAt = useRef<number>(0);
  const timerId = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerId.current !== null) {
      window.clearTimeout(timerId.current);
      timerId.current = null;
    }
  };

  const armNextTrial = useCallback(() => {
    setPhase("waiting");
    const delay = 900 + Math.random() * 1700;
    clearTimer();
    timerId.current = window.setTimeout(() => {
      startAt.current = performance.now();
      setPhase("ready");
    }, delay);
  }, []);

  useEffect(() => () => clearTimer(), []);

  const begin = () => {
    setTrial(0);
    setTimes([]);
    setLastMs(null);
    armNextTrial();
  };

  const finishTrial = (reaction: number) => {
    const next = [...times, reaction];
    setTimes(next);
    setLastMs(reaction);
    if (next.length >= TRIALS) {
      const avg = next.reduce((a, b) => a + b, 0) / next.length;
      const rounded = Math.round(avg);
      const { isBest: best } = recordPlay("reaction", rounded);
      setIsBest(best);
      setPhase("done");
    } else {
      setTrial((t) => t + 1);
      armNextTrial();
    }
  };

  const onTap = () => {
    if (phase === "waiting") {
      clearTimer();
      setPhase("tooSoon");
    } else if (phase === "ready") {
      const ms = performance.now() - startAt.current;
      finishTrial(ms);
    } else if (phase === "tooSoon") {
      armNextTrial();
    }
  };

  const avg =
    times.length > 0
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : null;

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          You'll take {TRIALS} trials. Wait for the screen to turn{" "}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            green
          </span>
          , then tap as quickly as you can. Tapping too early will restart that
          trial.
        </Instructions>
      )}

      {(phase === "waiting" || phase === "ready" || phase === "tooSoon") && (
        <div className="card p-0">
          <div className="flex items-center justify-between p-4">
            <span className="chip">
              Trial {Math.min(trial + 1, TRIALS)} / {TRIALS}
            </span>
            {lastMs !== null && (
              <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                Last: {Math.round(lastMs)} ms
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onTap}
            aria-label={
              phase === "ready"
                ? "Tap now"
                : phase === "waiting"
                ? "Wait for green"
                : "Too soon, tap to retry"
            }
            className={
              "no-select relative grid min-h-[60vh] w-full place-items-center rounded-b-3xl px-6 text-center text-2xl font-bold text-white transition-colors sm:text-3xl " +
              (phase === "ready"
                ? "bg-emerald-500"
                : phase === "tooSoon"
                ? "bg-rose-500"
                : "bg-slate-800")
            }
          >
            {phase === "waiting" && "Wait for green…"}
            {phase === "ready" && "Tap!"}
            {phase === "tooSoon" && "Too soon — tap to retry"}
          </button>
        </div>
      )}

      {phase === "done" && avg !== null && (
        <ResultsScreen
          game={game}
          score={avg}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`Average of ${TRIALS} trials · fastest ${Math.round(
            Math.min(...times)
          )} ms`}
        />
      )}
    </GameShell>
  );
}

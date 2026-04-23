import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";

type Phase = "intro" | "tutorial" | "countdown" | "playing" | "done";

const SIZE = 5;
const TOTAL = SIZE * SIZE;

function shuffled(): number[] {
  const arr = Array.from({ length: TOTAL }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function SchulteTable() {
  const game = getGame("schulte");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [grid, setGrid] = useState<number[]>(() => shuffled());
  const [next, setNext] = useState(1);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [shake, setShake] = useState(false);
  const [finalTime, setFinalTime] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== "playing") return;
    tickRef.current = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 100);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [phase, startedAt]);

  const begin = () => {
    setGrid(shuffled());
    setNext(1);
    setElapsed(0);
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Numbers 1 to 25 are shuffled into a 5×5 grid.",
      stage: <SchulteDemo stage="all" />,
    },
    {
      caption: "Tap 1 first, then 2, then 3 — in order.",
      stage: <SchulteDemo stage="inProgress" />,
    },
    {
      caption:
        "Try to fixate in the center and spot numbers with your peripheral vision. Faster = better.",
      stage: <SchulteDemo stage="center" />,
    },
  ];

  const startPlay = () => {
    setStartedAt(Date.now());
    setPhase("playing");
  };

  const onTap = (n: number) => {
    if (phase !== "playing") return;
    if (n !== next) {
      setShake(true);
      window.setTimeout(() => setShake(false), 200);
      return;
    }
    if (n === TOTAL) {
      const t = (Date.now() - startedAt) / 1000;
      setFinalTime(t);
      // Raw score is seconds; lower is better
      const rounded = Math.round(t * 10) / 10;
      const { isBest: best } = recordPlay("schulte", rounded);
      setIsBest(best);
      setPhase("done");
      return;
    }
    setNext(n + 1);
  };

  const cells = useMemo(() => grid, [grid]);

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Tap the numbers in order from 1 to {TOTAL}. Try to fixate in the
          center and find numbers with your peripheral vision.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startPlay} />}

      {phase === "playing" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="chip">Next: {next}</span>
            <span className="chip">{elapsed.toFixed(1)}s</span>
          </div>

          <motion.div
            role="grid"
            aria-label={`Schulte table, tap ${next} next`}
            className="mx-auto grid aspect-square w-full max-w-md grid-cols-5 gap-1.5 sm:gap-2"
            animate={shake ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
            transition={{ duration: 0.25 }}
          >
            {cells.map((n, i) => {
              const done = n < next;
              return (
                <button
                  key={`${n}-${i}`}
                  type="button"
                  role="gridcell"
                  aria-label={`Number ${n}`}
                  onClick={() => onTap(n)}
                  className={
                    "relative aspect-square min-h-[44px] rounded-xl text-xl font-bold transition-colors sm:text-2xl " +
                    (done
                      ? "bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600"
                      : "bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-brand-50 active:bg-brand-100 dark:bg-slate-900 dark:text-white dark:ring-slate-700 dark:hover:bg-slate-800")
                  }
                >
                  {n}
                </button>
              );
            })}
          </motion.div>
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Tap the wrong number? It doesn't count against you — just shakes.
          </p>
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={Math.round(finalTime * 10) / 10}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`Completed 1–${TOTAL}`}
        />
      )}
    </GameShell>
  );
}

function SchulteDemo({
  stage,
}: {
  stage: "all" | "inProgress" | "center";
}) {
  const grid = [7, 3, 14, 2, 21, 11, 5, 18, 9, 1, 23, 15, 13, 6, 19, 4, 20, 8, 17, 22, 12, 25, 10, 24, 16];
  const next = stage === "inProgress" ? 4 : 1;
  return (
    <div className="mx-auto grid aspect-square w-full max-w-xs grid-cols-5 gap-1 rounded-2xl bg-slate-100 p-2 dark:bg-slate-800">
      {grid.map((n, i) => {
        const done = stage === "inProgress" && n < next;
        const centerHi =
          stage === "center" && (i === 12 || i === 7 || i === 17 || i === 11 || i === 13);
        return (
          <div
            key={i}
            className={
              "grid aspect-square place-items-center rounded-md text-sm font-bold sm:text-base " +
              (done
                ? "bg-slate-300 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
                : centerHi
                ? "bg-brand-500 text-white"
                : stage === "center" && i === 12
                ? "bg-brand-600 text-white ring-2 ring-brand-300"
                : "bg-white text-slate-900 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700")
            }
          >
            {n}
          </div>
        );
      })}
    </div>
  );
}

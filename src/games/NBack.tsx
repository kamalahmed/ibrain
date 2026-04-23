import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";

type Phase = "intro" | "tutorial" | "countdown" | "playing" | "done";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const N = 2;
const TOTAL = 20;
const INTERVAL_MS = 2000;

function generateSequence(): string[] {
  const seq: string[] = [];
  for (let i = 0; i < TOTAL; i++) {
    if (i >= N && Math.random() < 0.35) {
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

export default function NBack() {
  const game = getGame("nback");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [seq, setSeq] = useState<string[]>([]);
  const [idx, setIdx] = useState(-1);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [falseAlarms, setFalseAlarms] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);

  const timerRef = useRef<number | null>(null);
  const respondedRef = useRef<boolean[]>([]);
  const seqRef = useRef<string[]>([]);
  const idxRef = useRef(-1);
  const statsRef = useRef({ hits: 0, misses: 0, falseAlarms: 0 });

  useEffect(() => {
    seqRef.current = seq;
  }, [seq]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const evalStep = (i: number) => {
    if (i < N) return;
    const s = seqRef.current;
    const wasMatch = s[i] === s[i - N];
    const didRespond = respondedRef.current[i] === true;
    if (wasMatch && didRespond) {
      statsRef.current.hits += 1;
      setHits((v) => v + 1);
    } else if (wasMatch && !didRespond) {
      statsRef.current.misses += 1;
      setMisses((v) => v + 1);
    } else if (!wasMatch && didRespond) {
      statsRef.current.falseAlarms += 1;
      setFalseAlarms((v) => v + 1);
    }
  };

  const finish = useCallback(() => {
    const { hits: h, misses: m, falseAlarms: fa } = statsRef.current;
    const raw = Math.max(0, h * 10 - fa * 5 - m * 3);
    const { isBest: best } = recordPlay("nback", raw);
    setFinalScore(raw);
    setIsBest(best);
    setPhase("done");
  }, [recordPlay]);

  const advance = useCallback(() => {
    // Evaluate the step that just ended (idxRef.current), then advance.
    if (idxRef.current >= 0) {
      evalStep(idxRef.current);
    }
    const next = idxRef.current + 1;
    if (next >= TOTAL) {
      clearTimer();
      finish();
      return;
    }
    idxRef.current = next;
    setIdx(next);
    timerRef.current = window.setTimeout(advance, INTERVAL_MS);
  }, [finish]);

  useEffect(() => () => clearTimer(), []);

  const begin = () => {
    const s = generateSequence();
    setSeq(s);
    seqRef.current = s;
    setIdx(-1);
    idxRef.current = -1;
    respondedRef.current = new Array(TOTAL).fill(false);
    statsRef.current = { hits: 0, misses: 0, falseAlarms: 0 };
    setHits(0);
    setMisses(0);
    setFalseAlarms(0);
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "A letter appears every 2 seconds.",
      stage: <NBackDemo highlight={[true, false, false]} />,
    },
    {
      caption: `Compare the current letter with the one shown ${N} steps ago.`,
      stage: <NBackDemo highlight={[true, false, true]} arrow />,
    },
    {
      caption: "If they match, press Match (or the space bar).",
      stage: <NBackDemo highlight={[true, false, true]} arrow matched />,
    },
    {
      caption:
        "If they don't match, do nothing — extra presses count as false alarms.",
      stage: <NBackDemo highlight={[true, true, false]} arrow nonMatch />,
    },
  ];

  const startPlay = () => {
    setPhase("playing");
    idxRef.current = 0;
    setIdx(0);
    clearTimer();
    timerRef.current = window.setTimeout(advance, INTERVAL_MS);
  };

  const onMatch = useCallback(() => {
    const i = idxRef.current;
    if (i < N) return;
    if (respondedRef.current[i]) return;
    respondedRef.current[i] = true;
    // Visual feedback: nothing here (could add a flash)
  }, []);

  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "m" || e.key === "M") {
        e.preventDefault();
        onMatch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onMatch]);

  const current = idx >= 0 && idx < TOTAL ? seq[idx] : null;
  const progress = useMemo(
    () => Math.max(0, Math.min(1, (idx + 1) / TOTAL)),
    [idx]
  );

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Watch the letters one-by-one. When the current letter matches the one
          shown <strong>2 steps back</strong>, press <kbd>Match</kbd> (or the
          space bar). {TOTAL} letters total.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startPlay} />}

      {phase === "playing" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="chip">
              Step {Math.max(1, idx + 1)} / {TOTAL}
            </span>
            <span className="chip">Hits: {hits}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <motion.div
              className="h-full bg-gradient-to-r from-brand-500 to-accent-teal"
              animate={{ width: `${progress * 100}%` }}
              transition={{ ease: "linear", duration: 0.2 }}
            />
          </div>

          <div className="grid min-h-[36vh] place-items-center rounded-3xl bg-white/80 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
            <AnimatePresence mode="wait">
              <motion.div
                key={idx}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.18 }}
                className="bg-gradient-to-br from-brand-600 to-accent-teal bg-clip-text text-[8rem] font-black leading-none text-transparent sm:text-[11rem]"
                aria-live="polite"
              >
                {current ?? "•"}
              </motion.div>
            </AnimatePresence>
          </div>

          <button
            type="button"
            onClick={onMatch}
            className="btn-primary w-full min-h-[56px] text-lg disabled:opacity-50"
            aria-label="Press if current letter matches 2 back"
            disabled={idx < N}
          >
            Match (space)
          </button>
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            First {N} letters have no match target — just watch.
          </p>
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${hits} hits · ${misses} missed · ${falseAlarms} false alarms`}
        />
      )}
    </GameShell>
  );
}

function NBackDemo({
  highlight,
  arrow,
  matched,
  nonMatch,
}: {
  highlight: [boolean, boolean, boolean];
  arrow?: boolean;
  matched?: boolean;
  nonMatch?: boolean;
}) {
  const letters: [string, string, string] = ["K", "R", "K"];
  if (nonMatch) letters[2] = "T";
  return (
    <div className="mx-auto max-w-sm">
      <div className="flex items-center justify-center gap-3">
        {letters.map((l, i) => (
          <div
            key={i}
            className={
              "grid h-20 w-20 place-items-center rounded-2xl text-4xl font-black transition-all " +
              (highlight[i]
                ? "bg-gradient-to-br from-brand-500 to-accent-teal text-white shadow-soft"
                : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500")
            }
          >
            {l}
          </div>
        ))}
      </div>
      {arrow && (
        <div className="mt-3 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            ← compare 2 back
          </span>
        </div>
      )}
      {matched && (
        <p className="mt-3 text-center text-sm font-bold text-emerald-600 dark:text-emerald-400">
          Same letter → press Match
        </p>
      )}
      {nonMatch && (
        <p className="mt-3 text-center text-sm font-bold text-slate-500">
          Different → do nothing
        </p>
      )}
    </div>
  );
}

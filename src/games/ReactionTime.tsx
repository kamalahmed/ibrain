import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { LevelProgress } from "@/components/LevelProgress";
import { LevelComplete } from "@/components/LevelComplete";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";
import { haptic } from "@/lib/haptics";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

type TrialState = "waiting" | "ready" | "tooSoon" | "feedback";

type Stimulus = {
  go: boolean;
  color: "green" | "red";
  shape: "circle" | "square";
};

type TrialResult = {
  kind: "hit" | "miss" | "wrong" | "nogo-correct";
  ms?: number;
  pts: number;
};

type Level = {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  trialCount: number;
  requiredCorrect: number;
  windowMs: number;
  delayRange: [number, number];
  instruction: string;
  genStimulus: () => Stimulus;
};

const SESSION_SECONDS = 300;
const LEVEL_CLEAR_BONUS = 50;

function stim(
  go: boolean,
  color: "green" | "red",
  shape: "circle" | "square"
): Stimulus {
  return { go, color, shape };
}

function genSimple(): Stimulus {
  return stim(true, "green", "circle");
}

function genGoNoGo(): Stimulus {
  const go = Math.random() < 0.65;
  return stim(go, go ? "green" : "red", "circle");
}

function genDiscrim(): Stimulus {
  const r = Math.random();
  if (r < 0.5) return stim(true, "green", "circle"); // GO
  if (r < 0.75) return stim(false, "red", "circle"); // NO-GO (red circle)
  return stim(false, "green", "square"); // NO-GO (green square)
}

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Warm-up",
    trialCount: 3,
    requiredCorrect: 3,
    windowMs: 2500,
    delayRange: [1200, 3000],
    instruction: "Tap the moment the circle turns green.",
    genStimulus: genSimple,
  },
  {
    id: 2,
    name: "Faster",
    trialCount: 4,
    requiredCorrect: 4,
    windowMs: 2000,
    delayRange: [900, 2200],
    instruction: "Same drill — shorter waits.",
    genStimulus: genSimple,
  },
  {
    id: 3,
    name: "Go / no-go",
    trialCount: 5,
    requiredCorrect: 4,
    windowMs: 1400,
    delayRange: [900, 2100],
    instruction: "Green circle = tap. Red circle = don't tap.",
    genStimulus: genGoNoGo,
  },
  {
    id: 4,
    name: "Only green circles",
    trialCount: 5,
    requiredCorrect: 4,
    windowMs: 1300,
    delayRange: [800, 1900],
    instruction: "Tap only for a green circle. Green squares & red = hold.",
    genStimulus: genDiscrim,
  },
  {
    id: 5,
    name: "Lightning",
    trialCount: 6,
    requiredCorrect: 5,
    windowMs: 900,
    delayRange: [700, 1600],
    instruction: "Green circle only, and fast.",
    genStimulus: genDiscrim,
  },
];

function scoreForHit(ms: number): number {
  // ~200 ms → ~200 pts, ~500 ms → ~100 pts, ~800 ms → 0 pts. Clamped floor 20.
  return Math.max(20, Math.round((800 - ms) / 3));
}

export default function ReactionTime() {
  const game = getGame("reaction");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [trialIdx, setTrialIdx] = useState(0);
  const [trialState, setTrialState] = useState<TrialState>("waiting");
  const [stimulus, setStimulus] = useState<Stimulus | null>(null);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [score, setScore] = useState(0);
  const [levelCorrect, setLevelCorrect] = useState(0);
  const [lastResult, setLastResult] = useState<TrialResult | null>(null);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [totalHits, setTotalHits] = useState(0);

  const scoreRef = useRef(0);
  const clearedRef = useRef(0);
  const levelPointsRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const trialDelayRef = useRef<number | null>(null);
  const responseTimerRef = useRef<number | null>(null);
  const startAtRef = useRef(0);
  const endedRef = useRef(false);

  const currentLevel = LEVELS[levelIdx];

  const clearTimers = () => {
    if (trialDelayRef.current !== null) {
      window.clearTimeout(trialDelayRef.current);
      trialDelayRef.current = null;
    }
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
  };

  const stopSessionTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  useEffect(
    () => () => {
      clearTimers();
      stopSessionTick();
    },
    []
  );

  const end = useCallback(
    (clearedAll: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearTimers();
      stopSessionTick();
      let final = scoreRef.current;
      if (clearedAll) {
        const remaining = Math.max(
          0,
          Math.floor((deadlineRef.current - Date.now()) / 1000)
        );
        final += remaining;
      }
      scoreRef.current = final;
      setScore(final);
      const { isBest: best } = recordPlay("reaction", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  /* ----- Trial machinery ----- */

  const armTrial = useCallback(() => {
    if (endedRef.current) return;
    const lvl = LEVELS[levelIdxRef.current];
    const [a, b] = lvl.delayRange;
    const delay = a + Math.random() * (b - a);
    setStimulus(null);
    setTrialState("waiting");
    trialDelayRef.current = window.setTimeout(() => {
      const s = lvl.genStimulus();
      setStimulus(s);
      startAtRef.current = performance.now();
      setTrialState("ready");
      // response window
      responseTimerRef.current = window.setTimeout(() => {
        handleTimeout(s);
      }, lvl.windowMs);
    }, delay);
  }, []);

  // Keep a ref-mirror of levelIdx for use inside setTimeout callbacks
  const levelIdxRef = useRef(0);
  useEffect(() => {
    levelIdxRef.current = levelIdx;
  }, [levelIdx]);

  const afterTrial = (result: TrialResult) => {
    clearTimers();
    setLastResult(result);
    if (result.pts > 0) {
      scoreRef.current += result.pts;
      levelPointsRef.current += result.pts;
      setScore(scoreRef.current);
    }
    const correctThisTrial =
      result.kind === "hit" || result.kind === "nogo-correct";
    if (result.kind === "hit") setTotalHits((n) => n + 1);
    if (correctThisTrial) {
      levelCorrectRef.current += 1;
      setLevelCorrect(levelCorrectRef.current);
    }
    setTrialState("feedback");

    const lvl = LEVELS[levelIdxRef.current];
    const isLastTrial = trialIdxRef.current + 1 >= lvl.trialCount;

    window.setTimeout(() => {
      if (endedRef.current) return;
      if (isLastTrial) {
        if (levelCorrectRef.current >= lvl.requiredCorrect) {
          scoreRef.current += LEVEL_CLEAR_BONUS;
          levelPointsRef.current += LEVEL_CLEAR_BONUS;
          setScore(scoreRef.current);
          clearedRef.current += 1;
          setLastCleared(lvl.id);
          setLastLevelScore(levelPointsRef.current);
          const nextIdx = levelIdxRef.current + 1;
          if (nextIdx >= LEVELS.length) {
            setPhase("levelDone");
            window.setTimeout(() => end(true), 1100);
          } else {
            setPhase("levelDone");
            window.setTimeout(() => startLevel(nextIdx), 1100);
          }
        } else {
          end(false);
        }
      } else {
        trialIdxRef.current += 1;
        setTrialIdx(trialIdxRef.current);
        armTrial();
      }
    }, 550);
  };

  // Mirror refs for trial callbacks
  const trialIdxRef = useRef(0);
  const levelCorrectRef = useRef(0);
  useEffect(() => {
    trialIdxRef.current = trialIdx;
  }, [trialIdx]);
  useEffect(() => {
    levelCorrectRef.current = levelCorrect;
  }, [levelCorrect]);

  const handleTimeout = (s: Stimulus) => {
    // Response window expired without a tap
    if (s.go) {
      afterTrial({ kind: "miss", pts: 0 });
    } else {
      afterTrial({ kind: "nogo-correct", pts: 30 });
    }
  };

  const onStageTap = () => {
    if (phase !== "playing") return;
    if (trialState === "tooSoon") {
      // re-arm same trial
      armTrial();
      return;
    }
    if (trialState === "waiting") {
      clearTimers();
      setTrialState("tooSoon");
      haptic.error();
      return;
    }
    if (trialState === "ready" && stimulus) {
      const ms = performance.now() - startAtRef.current;
      if (stimulus.go) {
        haptic.success();
        afterTrial({ kind: "hit", ms, pts: scoreForHit(ms) });
      } else {
        haptic.error();
        afterTrial({ kind: "wrong", pts: 0 });
      }
    }
  };

  /* ----- Level / session machinery ----- */

  const startLevel = useCallback((idx: number) => {
    setLevelIdx(idx);
    levelIdxRef.current = idx;
    setTrialIdx(0);
    trialIdxRef.current = 0;
    setLevelCorrect(0);
    levelCorrectRef.current = 0;
    levelPointsRef.current = 0;
    setLastResult(null);
    setPhase("playing");
    armTrial();
  }, [armTrial]);

  const startSession = () => {
    deadlineRef.current = Date.now() + SESSION_SECONDS * 1000;
    setTimeLeft(SESSION_SECONDS);
    stopSessionTick();
    sessionTickRef.current = window.setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000)
      );
      setTimeLeft(left);
      if (left <= 0) end(false);
    }, 250);
    startLevel(0);
  };

  const begin = () => {
    setScore(0);
    scoreRef.current = 0;
    clearedRef.current = 0;
    setLevelIdx(0);
    levelIdxRef.current = 0;
    setTrialIdx(0);
    trialIdxRef.current = 0;
    setLevelCorrect(0);
    levelCorrectRef.current = 0;
    setTotalHits(0);
    setLastResult(null);
    setTimeLeft(SESSION_SECONDS);
    endedRef.current = false;
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  /* ----- Tutorial ----- */

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Wait for the circle to appear. When it's green, tap fast.",
      stage: (
        <DemoStage trialState="ready" stimulus={stim(true, "green", "circle")} label="Green circle — TAP" />
      ),
    },
    {
      caption: "Levels 3+: red circles mean DON'T tap. Hold still.",
      stage: (
        <DemoStage trialState="ready" stimulus={stim(false, "red", "circle")} label="Red — HOLD" />
      ),
    },
    {
      caption: "Levels 4-5: even a green SQUARE is a trap. Only green CIRCLES count.",
      stage: (
        <DemoStage trialState="ready" stimulus={stim(false, "green", "square")} label="Green square — HOLD" />
      ),
    },
    {
      caption: "Clear every level inside 5 minutes. Faster taps = more points.",
      stage: (
        <div className="grid min-h-[22vh] place-items-center rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <LevelProgress total={5} current={1} cleared={0} />
        </div>
      ),
    },
  ];

  /* ----- Render helpers ----- */

  const stageBg =
    trialState === "tooSoon"
      ? "bg-rose-500"
      : trialState === "ready"
      ? "bg-slate-100 dark:bg-slate-800"
      : "bg-slate-800";

  const stageText =
    trialState === "tooSoon"
      ? "Too soon — tap to retry"
      : trialState === "waiting"
      ? "Wait…"
      : trialState === "ready"
      ? currentLevel.id <= 2
        ? "Tap!"
        : ""
      : lastResult?.kind === "hit"
      ? `+${lastResult.pts} · ${Math.round(lastResult.ms || 0)} ms`
      : lastResult?.kind === "nogo-correct"
      ? "+30 · held"
      : lastResult?.kind === "miss"
      ? "Missed"
      : lastResult?.kind === "wrong"
      ? "Shouldn't have tapped"
      : "";

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Five reaction levels in one 5-minute session. Level 1 is a simple
          reflex test; by level 5 you're only allowed to tap on a green
          circle — green squares and red circles are traps.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startSession} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LevelProgress
              total={LEVELS.length}
              current={levelIdx + 1}
              cleared={clearedRef.current}
              label="Level"
            />
            <div className="flex items-center gap-2">
              <span className="chip" data-testid="score">
                {score} pts
              </span>
              <span
                className={
                  "chip " +
                  (timeLeft <= 15
                    ? "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-800"
                    : "")
                }
                data-testid="timer"
              >
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {currentLevel.name} · {currentLevel.instruction}
            </span>
            <span data-testid="progress">
              {levelCorrect} / {currentLevel.requiredCorrect} correct · trial{" "}
              {Math.min(trialIdx + 1, currentLevel.trialCount)} /{" "}
              {currentLevel.trialCount}
            </span>
          </div>

          {phase === "levelDone" ? (
            <LevelComplete
              levelJustCleared={lastCleared}
              totalLevels={LEVELS.length}
              levelScore={lastLevelScore}
              nextLabel={LEVELS[lastCleared]?.name}
            />
          ) : (
            <button
              type="button"
              onClick={onStageTap}
              aria-label="Reaction stage"
              data-testid="stage"
              data-state={trialState}
              className={
                "no-select relative grid min-h-[60vh] w-full place-items-center overflow-hidden rounded-3xl px-6 text-center text-xl font-bold text-white transition-colors sm:text-2xl " +
                stageBg
              }
            >
              <AnimatePresence mode="wait">
                {trialState === "ready" && stimulus && (
                  <motion.div
                    key={JSON.stringify(stimulus) + trialIdx + levelIdx}
                    initial={{ scale: 0.3, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 320, damping: 18 }}
                    className="grid place-items-center"
                  >
                    <StimulusShape stimulus={stimulus} />
                  </motion.div>
                )}
                {trialState !== "ready" && (
                  <motion.span
                    key={trialState + (lastResult?.kind || "")}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="relative"
                  >
                    {stageText}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          )}
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${totalHits} taps scored`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Presentation bits ---------------- */

function StimulusShape({ stimulus }: { stimulus: Stimulus }) {
  const color =
    stimulus.color === "green" ? "bg-emerald-500" : "bg-rose-500";
  return (
    <div
      className={
        "h-44 w-44 sm:h-56 sm:w-56 " +
        color +
        " " +
        (stimulus.shape === "circle" ? "rounded-full" : "rounded-3xl") +
        " shadow-2xl"
      }
      aria-label={`${stimulus.color} ${stimulus.shape}`}
      data-testid="stimulus"
      data-shape={stimulus.shape}
      data-color={stimulus.color}
      data-go={stimulus.go ? "1" : "0"}
    />
  );
}

function DemoStage({
  trialState,
  stimulus,
  label,
}: {
  trialState: TrialState;
  stimulus?: Stimulus;
  label: string;
}) {
  return (
    <div className="grid min-h-[28vh] place-items-center rounded-2xl bg-slate-100 p-6 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <div className="flex flex-col items-center gap-3">
        {stimulus && trialState === "ready" && <StimulusShape stimulus={stimulus} />}
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {label}
        </span>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

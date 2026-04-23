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
import { haptic } from "@/lib/haptics";
import { useStore } from "@/store/useStore";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

type Shape = "circle" | "square" | "triangle";
type Color = "green" | "red" | "yellow" | "blue";
type Stimulus = { shape: Shape; color: Color };

type Rule = {
  label: string;
  isTarget: (s: Stimulus) => boolean;
  shapes: Shape[];
  colors: Color[];
};

type Trial = {
  options: [Stimulus, Stimulus, Stimulus];
  /** -1 when this trial has no target (player must hold); else 0 | 1 | 2. */
  targetIdx: -1 | 0 | 1 | 2;
  windowMs: number;
};

type TrialResult = {
  kind: "hit" | "miss" | "wrong" | "nogo-correct";
  ms?: number;
  pts: number;
};

type Level = {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  rule: Rule;
  trialCount: number;
  requiredCorrect: number;
  startWindowMs: number;
  endWindowMs: number;
  /** Probability 0..1 that a given trial is a no-target "hold" trial. */
  noTargetPct: number;
};

const SESSION_SECONDS = 300;
const LEVEL_CLEAR_BONUS = 75;
const INTER_STIMULUS_MS = 300;
const NOGO_CORRECT_BONUS = 40;
const FALSE_ALARM_PENALTY = -8;

/* ---------------- Rules ---------------- */

const ruleAnyCircle: Rule = {
  label: "Tap any CIRCLE",
  isTarget: (s) => s.shape === "circle",
  shapes: ["circle", "square", "triangle"],
  colors: ["green", "red", "yellow", "blue"],
};
const ruleAnyGreen: Rule = {
  label: "Tap any GREEN",
  isTarget: (s) => s.color === "green",
  shapes: ["circle", "square", "triangle"],
  colors: ["green", "red", "yellow", "blue"],
};
const ruleAnySquare: Rule = {
  label: "Tap any SQUARE",
  isTarget: (s) => s.shape === "square",
  shapes: ["circle", "square", "triangle"],
  colors: ["green", "red", "yellow", "blue"],
};
const ruleAnyRed: Rule = {
  label: "Tap any RED",
  isTarget: (s) => s.color === "red",
  shapes: ["circle", "square", "triangle"],
  colors: ["green", "red", "yellow", "blue"],
};
const ruleGreenCircleOnly: Rule = {
  label: "Tap only GREEN CIRCLE",
  isTarget: (s) => s.color === "green" && s.shape === "circle",
  shapes: ["circle", "square", "triangle"],
  colors: ["green", "red", "yellow", "blue"],
};

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Any circle",
    rule: ruleAnyCircle,
    trialCount: 24,
    requiredCorrect: 18,
    startWindowMs: 2400,
    endWindowMs: 1900,
    noTargetPct: 0,
  },
  {
    id: 2,
    name: "Any green",
    rule: ruleAnyGreen,
    trialCount: 28,
    requiredCorrect: 21,
    startWindowMs: 2100,
    endWindowMs: 1700,
    noTargetPct: 0,
  },
  {
    id: 3,
    name: "Any square",
    rule: ruleAnySquare,
    trialCount: 30,
    requiredCorrect: 22,
    startWindowMs: 1900,
    endWindowMs: 1500,
    noTargetPct: 0,
  },
  {
    id: 4,
    name: "Any red",
    rule: ruleAnyRed,
    trialCount: 32,
    requiredCorrect: 22,
    startWindowMs: 1700,
    endWindowMs: 1300,
    noTargetPct: 0.15,
  },
  {
    id: 5,
    name: "Green circle only",
    rule: ruleGreenCircleOnly,
    trialCount: 36,
    requiredCorrect: 23,
    startWindowMs: 1500,
    endWindowMs: 1000,
    noTargetPct: 0.25,
  },
];

/* ---------------- Trial generator ---------------- */

function randomStimulus(rule: Rule): Stimulus {
  const shape = rule.shapes[Math.floor(Math.random() * rule.shapes.length)];
  const color = rule.colors[Math.floor(Math.random() * rule.colors.length)];
  return { shape, color };
}

function sampleMatching(rule: Rule): Stimulus {
  for (let tries = 0; tries < 200; tries += 1) {
    const s = randomStimulus(rule);
    if (rule.isTarget(s)) return s;
  }
  return { shape: "circle", color: "green" };
}

function sampleNonMatching(rule: Rule): Stimulus {
  for (let tries = 0; tries < 200; tries += 1) {
    const s = randomStimulus(rule);
    if (!rule.isTarget(s)) return s;
  }
  return { shape: "triangle", color: "yellow" };
}

function windowForTrial(lvl: Level, trialIdx: number): number {
  const denom = Math.max(1, lvl.trialCount - 1);
  const t = Math.min(1, trialIdx / denom);
  return Math.round(
    lvl.startWindowMs + (lvl.endWindowMs - lvl.startWindowMs) * t
  );
}

function buildTrial(lvl: Level, trialIdx: number): Trial {
  const windowMs = windowForTrial(lvl, trialIdx);
  const hasTarget = Math.random() >= lvl.noTargetPct;
  const options: [Stimulus, Stimulus, Stimulus] = [
    sampleNonMatching(lvl.rule),
    sampleNonMatching(lvl.rule),
    sampleNonMatching(lvl.rule),
  ];
  if (!hasTarget) {
    return { options, targetIdx: -1, windowMs };
  }
  const targetIdx = Math.floor(Math.random() * 3) as 0 | 1 | 2;
  options[targetIdx] = sampleMatching(lvl.rule);
  return { options, targetIdx, windowMs };
}

function scoreForHit(ms: number): number {
  return Math.max(20, Math.round((1200 - ms) / 4));
}

/* ---------------- Component ---------------- */

export default function ReactionTime() {
  const game = getGame("reaction");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [trialIdx, setTrialIdx] = useState(0);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [score, setScore] = useState(0);
  const [levelCorrect, setLevelCorrect] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [lastResult, setLastResult] = useState<TrialResult | null>(null);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [totalHits, setTotalHits] = useState(0);
  const [falseAlarms, setFalseAlarms] = useState(0);

  const scoreRef = useRef(0);
  const levelPointsRef = useRef(0);
  const clearedRef = useRef(0);
  const levelIdxRef = useRef(0);
  const trialIdxRef = useRef(0);
  const levelCorrectRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const responseTimerRef = useRef<number | null>(null);
  const interStimulusTimerRef = useRef<number | null>(null);
  const startAtRef = useRef(0);
  const respondedRef = useRef(false);
  const endedRef = useRef(false);
  const trialRef = useRef<Trial | null>(null);

  const currentLevel = LEVELS[levelIdx];

  const clearTimers = () => {
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    if (interStimulusTimerRef.current !== null) {
      window.clearTimeout(interStimulusTimerRef.current);
      interStimulusTimerRef.current = null;
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
      scoreRef.current = Math.max(0, final);
      setScore(scoreRef.current);
      const { isBest: best } = recordPlay("reaction", scoreRef.current);
      setFinalScore(scoreRef.current);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  const evaluate = (result: TrialResult) => {
    if (result.pts !== 0) {
      scoreRef.current = Math.max(0, scoreRef.current + result.pts);
      levelPointsRef.current += result.pts;
      setScore(scoreRef.current);
    }
    const correct = result.kind === "hit" || result.kind === "nogo-correct";
    if (correct) {
      levelCorrectRef.current += 1;
      setLevelCorrect(levelCorrectRef.current);
    }
    if (result.kind === "hit") setTotalHits((n) => n + 1);
    if (result.kind === "wrong") setFalseAlarms((n) => n + 1);
    setLastResult(result);
    window.setTimeout(() => setLastResult(null), INTER_STIMULUS_MS);
  };

  const armNext = useCallback(() => {
    if (endedRef.current) return;
    const lvl = LEVELS[levelIdxRef.current];
    const i = trialIdxRef.current;
    if (i >= lvl.trialCount) {
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
      return;
    }
    const t = buildTrial(lvl, i);
    trialRef.current = t;
    respondedRef.current = false;
    setTrial(t);
    startAtRef.current = performance.now();

    responseTimerRef.current = window.setTimeout(() => {
      if (respondedRef.current || endedRef.current) return;
      const current = trialRef.current;
      const isHoldTrial = current?.targetIdx === -1;
      evaluate(
        isHoldTrial
          ? { kind: "nogo-correct", pts: NOGO_CORRECT_BONUS }
          : { kind: "miss", pts: 0 }
      );
      trialIdxRef.current += 1;
      setTrialIdx(trialIdxRef.current);
      trialRef.current = null;
      setTrial(null);
      interStimulusTimerRef.current = window.setTimeout(
        armNext,
        INTER_STIMULUS_MS
      );
    }, t.windowMs);
  }, [end]);

  const startLevel = useCallback(
    (idx: number) => {
      setLevelIdx(idx);
      levelIdxRef.current = idx;
      setTrialIdx(0);
      trialIdxRef.current = 0;
      setLevelCorrect(0);
      levelCorrectRef.current = 0;
      levelPointsRef.current = 0;
      setLastResult(null);
      trialRef.current = null;
      setTrial(null);
      setPhase("playing");
      clearTimers();
      interStimulusTimerRef.current = window.setTimeout(armNext, 450);
    },
    [armNext]
  );

  const handleTap = (idx: 0 | 1 | 2) => {
    if (phase !== "playing" || respondedRef.current || endedRef.current) return;
    const current = trialRef.current;
    if (!current) return;
    respondedRef.current = true;
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    const ms = performance.now() - startAtRef.current;
    const isHoldTrial = current.targetIdx === -1;
    const isHit = !isHoldTrial && idx === current.targetIdx;
    if (isHit) {
      haptic.success();
      evaluate({ kind: "hit", ms, pts: scoreForHit(ms) });
    } else {
      haptic.error();
      evaluate({ kind: "wrong", pts: FALSE_ALARM_PENALTY });
    }
    trialIdxRef.current += 1;
    setTrialIdx(trialIdxRef.current);
    trialRef.current = null;
    setTrial(null);
    interStimulusTimerRef.current = window.setTimeout(
      armNext,
      INTER_STIMULUS_MS
    );
  };

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
    setFalseAlarms(0);
    setLastResult(null);
    trialRef.current = null;
    setTrial(null);
    setTimeLeft(SESSION_SECONDS);
    endedRef.current = false;
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  /* ---------------- Tutorial ---------------- */

  const tutorialSteps: TutorialStep[] = [
    {
      caption:
        "Each level has a rule. Three options appear side by side — tap the one that matches. If NONE match, hold (don't tap).",
      stage: (
        <div className="grid min-h-[26vh] place-items-center rounded-2xl bg-white/80 p-6 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <div className="text-center">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Rule
            </div>
            <div className="mt-1 text-2xl font-black text-slate-900 dark:text-white">
              Tap any CIRCLE
            </div>
            <div className="mt-3 flex items-center justify-center gap-3">
              <div className="opacity-40">
                <StimulusShape
                  stimulus={{ shape: "square", color: "green" }}
                  size={56}
                />
              </div>
              <StimulusShape
                stimulus={{ shape: "circle", color: "red" }}
                size={56}
              />
              <div className="opacity-40">
                <StimulusShape
                  stimulus={{ shape: "triangle", color: "blue" }}
                  size={56}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Circle → tap. Others → ignore.
            </p>
          </div>
        </div>
      ),
    },
    {
      caption:
        "Trials stream back-to-back. Each set of three disappears if you don't tap in time.",
      stage: (
        <div className="grid min-h-[26vh] place-items-center rounded-2xl bg-white/80 p-6 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <div className="flex items-center gap-3">
            <StimulusShape
              stimulus={{ shape: "circle", color: "green" }}
              size={48}
            />
            <StimulusShape
              stimulus={{ shape: "triangle", color: "red" }}
              size={48}
            />
            <StimulusShape
              stimulus={{ shape: "square", color: "blue" }}
              size={48}
            />
          </div>
        </div>
      ),
    },
    {
      caption:
        "Rules change every level. Later levels sometimes show NO match — hold and wait for the next trial.",
      stage: (
        <div className="mx-auto grid max-w-md gap-2 rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          {LEVELS.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between text-sm"
            >
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                Level {l.id}
              </span>
              <span className="text-slate-900 dark:text-white">
                {l.rule.label}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      caption:
        "Hit = points (faster = more). Wrong tap = -8. Hold correctly through a no-target trial = +40.",
      stage: (
        <div className="grid min-h-[22vh] place-items-center rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <LevelProgress total={5} current={1} cleared={0} />
        </div>
      ),
    },
  ];

  /* ---------------- Render ---------------- */

  const feedbackColor =
    lastResult?.kind === "hit"
      ? "ring-emerald-300"
      : lastResult?.kind === "nogo-correct"
      ? "ring-emerald-200"
      : lastResult?.kind === "wrong"
      ? "ring-rose-300"
      : lastResult?.kind === "miss"
      ? "ring-amber-300"
      : "ring-slate-200 dark:ring-slate-800";

  const feedbackText =
    lastResult?.kind === "hit"
      ? `+${lastResult.pts} · ${Math.round(lastResult.ms || 0)} ms`
      : lastResult?.kind === "nogo-correct"
      ? `+${NOGO_CORRECT_BONUS} · held`
      : lastResult?.kind === "wrong"
      ? `${FALSE_ALARM_PENALTY} · wrong`
      : lastResult?.kind === "miss"
      ? "missed"
      : null;

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Five reaction levels in one 5-minute session. Each trial shows
          three options — tap the one that matches the level's rule, or
          hold when none of them do. Rules shift between shape and colour,
          and the pace tightens as you climb.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startSession} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-3">
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

          <div
            className="rounded-2xl bg-gradient-to-br from-brand-600 to-accent-teal px-4 py-2 text-center text-white shadow-soft"
            data-testid="rule"
          >
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/80">
              Rule
            </div>
            <div className="text-lg font-black sm:text-xl">
              {currentLevel.rule.label}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {currentLevel.name} · need {currentLevel.requiredCorrect} /{" "}
              {currentLevel.trialCount}
            </span>
            <span data-testid="progress">
              {levelCorrect} correct · trial{" "}
              {Math.min(trialIdx + 1, currentLevel.trialCount)} /{" "}
              {currentLevel.trialCount}
            </span>
          </div>

          {phase === "levelDone" ? (
            <LevelComplete
              levelJustCleared={lastCleared}
              totalLevels={LEVELS.length}
              levelScore={lastLevelScore}
              nextLabel={LEVELS[lastCleared]?.rule.label}
            />
          ) : (
            <div
              data-testid="stage"
              className={
                "no-select relative grid min-h-[54vh] w-full place-items-center overflow-hidden rounded-3xl bg-slate-100 px-4 py-6 ring-1 transition-colors dark:bg-slate-900 " +
                feedbackColor
              }
            >
              <div className="flex w-full max-w-md flex-col items-center gap-5">
                <CountdownBar
                  durationMs={trial?.windowMs ?? 0}
                  trialKey={`${levelIdx}-${trialIdx}`}
                  active={!!trial}
                />
                <div className="relative flex min-h-[140px] w-full items-center justify-center">
                  {trial && (
                    <div
                      key={`row-${levelIdx}-${trialIdx}`}
                      className="grid w-full grid-cols-3 items-center justify-items-center gap-3"
                    >
                      {trial.options.map((opt, idx) => (
                        <button
                          key={`opt-${levelIdx}-${trialIdx}-${idx}`}
                          type="button"
                          onClick={() => handleTap(idx as 0 | 1 | 2)}
                          aria-label={`Option ${idx + 1}: ${opt.color} ${opt.shape}`}
                          data-testid="stimulus"
                          data-option-idx={idx}
                          data-is-target={
                            trial.targetIdx === idx ? 1 : 0
                          }
                          data-shape={opt.shape}
                          data-color={opt.color}
                          className="grid h-[110px] w-[110px] place-items-center rounded-2xl bg-white shadow-soft ring-1 ring-slate-200 transition-transform active:scale-95 dark:bg-slate-800 dark:ring-slate-700"
                        >
                          <StimulusShape stimulus={opt} size={96} />
                        </button>
                      ))}
                    </div>
                  )}
                  <AnimatePresence>
                    {!trial && feedbackText && (
                      <motion.div
                        key={`fb-${lastResult?.kind}-${trialIdx}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={
                          "absolute text-xl font-bold sm:text-2xl " +
                          (lastResult?.kind === "hit" ||
                          lastResult?.kind === "nogo-correct"
                            ? "text-emerald-600 dark:text-emerald-300"
                            : lastResult?.kind === "wrong"
                            ? "text-rose-600 dark:text-rose-300"
                            : "text-amber-600 dark:text-amber-300")
                        }
                      >
                        {feedbackText}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${totalHits} hits · ${falseAlarms} false alarm${falseAlarms === 1 ? "" : "s"}`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Stimulus shape ---------------- */

const COLOR_FILL: Record<Color, string> = {
  green: "#10b981",
  red: "#ef4444",
  yellow: "#eab308",
  blue: "#3b82f6",
};
const COLOR_STROKE: Record<Color, string> = {
  green: "#047857",
  red: "#991b1b",
  yellow: "#a16207",
  blue: "#1e40af",
};

function StimulusShape({
  stimulus,
  size = 96,
}: {
  stimulus: Stimulus;
  size?: number;
}) {
  const fill = COLOR_FILL[stimulus.color];
  const stroke = COLOR_STROKE[stimulus.color];
  const s = size;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 100 100"
      aria-label={`${stimulus.color} ${stimulus.shape}`}
    >
      {stimulus.shape === "circle" && (
        <circle
          cx="50"
          cy="50"
          r="44"
          fill={fill}
          stroke={stroke}
          strokeWidth="3"
        />
      )}
      {stimulus.shape === "square" && (
        <rect
          x="8"
          y="8"
          width="84"
          height="84"
          rx="14"
          fill={fill}
          stroke={stroke}
          strokeWidth="3"
        />
      )}
      {stimulus.shape === "triangle" && (
        <polygon
          points="50,8 92,88 8,88"
          fill={fill}
          stroke={stroke}
          strokeWidth="3"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/* ---------------- Shared countdown bar ---------------- */

function CountdownBar({
  durationMs,
  trialKey,
  active,
}: {
  durationMs: number;
  trialKey: string;
  active: boolean;
}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      {active && durationMs > 0 && (
        <motion.div
          key={trialKey}
          className="h-full w-full origin-left bg-brand-500"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: durationMs / 1000, ease: "linear" }}
        />
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

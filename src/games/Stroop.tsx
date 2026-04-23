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

type Color = "red" | "green" | "blue" | "yellow";

type LevelMode =
  | "swatchOnly" // L1: colour rectangle, no word
  | "wordNeutral" // L2: word shown in neutral ink
  | "congruent" // L3: word ink matches meaning
  | "incongruent" // L4: word ink never matches meaning
  | "mixed"; // L5: incongruent word + per-trial prompt swap

type RespondTo = "ink" | "word";

type Trial = {
  word: Color | null; // null on swatchOnly levels
  ink: Color;
  respondTo: RespondTo;
  windowMs: number;
};

type TrialResult = {
  kind: "hit" | "miss" | "wrong";
  ms?: number;
  pts: number;
};

type Level = {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  ruleLabel: string;
  mode: LevelMode;
  trialCount: number;
  requiredCorrect: number;
  startWindowMs: number;
  endWindowMs: number;
};

const COLORS: Color[] = ["red", "green", "blue", "yellow"];

const SESSION_SECONDS = 300;
const INTER_STIMULUS_MS = 300;
const LEVEL_CLEAR_BONUS = 50;
const FALSE_ALARM_PENALTY = -5;

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Colour swatches",
    ruleLabel: "Tap the COLOUR",
    mode: "swatchOnly",
    trialCount: 20,
    requiredCorrect: 15,
    startWindowMs: 2000,
    endWindowMs: 1600,
  },
  {
    id: 2,
    name: "Words only",
    ruleLabel: "Tap the WORD's colour",
    mode: "wordNeutral",
    trialCount: 22,
    requiredCorrect: 16,
    startWindowMs: 1900,
    endWindowMs: 1500,
  },
  {
    id: 3,
    name: "Congruent",
    ruleLabel: "Tap the INK colour",
    mode: "congruent",
    trialCount: 24,
    requiredCorrect: 18,
    startWindowMs: 1800,
    endWindowMs: 1400,
  },
  {
    id: 4,
    name: "Incongruent",
    ruleLabel: "Tap the INK colour",
    mode: "incongruent",
    trialCount: 28,
    requiredCorrect: 20,
    startWindowMs: 2000,
    endWindowMs: 1500,
  },
  {
    id: 5,
    name: "Mixed switch",
    ruleLabel: "Read the prompt each trial",
    mode: "mixed",
    trialCount: 32,
    requiredCorrect: 22,
    startWindowMs: 1800,
    endWindowMs: 1300,
  },
];

/* ---------------- Trial generator ---------------- */

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickDifferent<T>(arr: readonly T[], not: T): T {
  for (let i = 0; i < 50; i += 1) {
    const candidate = pick(arr);
    if (candidate !== not) return candidate;
  }
  return arr.find((x) => x !== not) ?? arr[0];
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
  switch (lvl.mode) {
    case "swatchOnly": {
      return { word: null, ink: pick(COLORS), respondTo: "ink", windowMs };
    }
    case "wordNeutral": {
      // word shown in neutral ink; player taps the colour named by the word
      return { word: pick(COLORS), ink: "red" /* ignored */, respondTo: "word", windowMs };
    }
    case "congruent": {
      const c = pick(COLORS);
      return { word: c, ink: c, respondTo: "ink", windowMs };
    }
    case "incongruent": {
      const ink = pick(COLORS);
      const word = pickDifferent(COLORS, ink);
      return { word, ink, respondTo: "ink", windowMs };
    }
    case "mixed": {
      const ink = pick(COLORS);
      const word = pickDifferent(COLORS, ink);
      const respondTo: RespondTo = Math.random() < 0.5 ? "ink" : "word";
      return { word, ink, respondTo, windowMs };
    }
  }
}

function correctAnswer(trial: Trial): Color {
  if (trial.respondTo === "word") return trial.word ?? trial.ink;
  return trial.ink;
}

function perTrialPrompt(lvl: Level, trial: Trial): string {
  if (lvl.mode === "mixed") {
    return trial.respondTo === "ink"
      ? "Tap the INK colour"
      : "Tap the WORD";
  }
  return lvl.ruleLabel;
}

function scoreForHit(ms: number): number {
  return Math.max(20, Math.round((900 - ms) / 4));
}

/* ---------------- Component ---------------- */

export default function Stroop() {
  const game = getGame("stroop");
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
      const { isBest: best } = recordPlay("stroop", scoreRef.current);
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
    if (result.kind === "hit") {
      levelCorrectRef.current += 1;
      setLevelCorrect(levelCorrectRef.current);
      setTotalHits((n) => n + 1);
    }
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
      evaluate({ kind: "miss", pts: 0 });
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
      interStimulusTimerRef.current = window.setTimeout(armNext, 500);
    },
    [armNext]
  );

  const handleTap = (choice: Color) => {
    if (phase !== "playing" || respondedRef.current || endedRef.current) return;
    const current = trialRef.current;
    if (!current) return;
    respondedRef.current = true;
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    const ms = performance.now() - startAtRef.current;
    const answer = correctAnswer(current);
    if (choice === answer) {
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
        "Stroop test. Each trial shows a colour or a word. Tap one of the 4 coloured buttons that matches.",
      stage: (
        <div className="grid min-h-[26vh] place-items-center rounded-2xl bg-white/80 p-6 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <div className="flex items-center justify-center gap-3">
            {COLORS.map((c) => (
              <ColorButton key={c} color={c} onClick={() => {}} size={52} />
            ))}
          </div>
        </div>
      ),
    },
    {
      caption:
        "Levels 1–2 ease you in: colour swatches, then plain words. Easy mapping.",
      stage: (
        <div className="grid min-h-[26vh] place-items-center rounded-2xl bg-white/80 p-6 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <div className="flex items-center gap-5">
            <Swatch color="blue" />
            <StroopWord word="GREEN" ink={null} />
          </div>
        </div>
      ),
    },
    {
      caption:
        "Level 4 is the classic Stroop: the word says one thing, the ink says another. Tap the INK colour and resist reading.",
      stage: (
        <div className="grid min-h-[26vh] place-items-center rounded-2xl bg-white/80 p-6 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <div className="text-center">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Tap the INK colour
            </div>
            <StroopWord word="RED" ink="blue" />
            <div className="mt-3 text-xs text-slate-500">Answer: blue</div>
          </div>
        </div>
      ),
    },
    {
      caption:
        "Level 5 flips the rule trial by trial: sometimes tap the INK, sometimes tap the WORD. Read the prompt every time.",
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
      : lastResult?.kind === "wrong"
      ? "ring-rose-300"
      : lastResult?.kind === "miss"
      ? "ring-amber-300"
      : "ring-slate-200 dark:ring-slate-800";

  const feedbackText =
    lastResult?.kind === "hit"
      ? `+${lastResult.pts} · ${Math.round(lastResult.ms || 0)} ms`
      : lastResult?.kind === "wrong"
      ? `${FALSE_ALARM_PENALTY} · wrong`
      : lastResult?.kind === "miss"
      ? "missed"
      : null;

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Five Stroop levels in one 5-minute session. Levels 1–2 build the
          colour-to-word map. Level 3 is congruent (word and ink agree).
          Level 4 is the classic Stroop conflict — the word fights the
          ink. Level 5 flips the rule each trial — read the prompt.
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
            className="rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 px-4 py-2 text-center text-white shadow-soft"
            data-testid="rule"
          >
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/80">
              Rule
            </div>
            <div className="text-lg font-black sm:text-xl">
              {trial ? perTrialPrompt(currentLevel, trial) : currentLevel.ruleLabel}
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
              nextLabel={LEVELS[lastCleared]?.ruleLabel}
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
                <div className="relative flex min-h-[160px] w-full items-center justify-center">
                  {trial && (
                    <div
                      key={`stim-${levelIdx}-${trialIdx}`}
                      data-testid="stimulus"
                      data-ink={trial.ink}
                      data-word={trial.word ?? ""}
                      data-respond-to={trial.respondTo}
                      data-answer={correctAnswer(trial)}
                    >
                      <StroopStimulus
                        mode={currentLevel.mode}
                        ink={trial.ink}
                        word={trial.word}
                      />
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
                          (lastResult?.kind === "hit"
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

                <div className="grid w-full grid-cols-4 gap-3">
                  {COLORS.map((c) => (
                    <ColorButton
                      key={c}
                      color={c}
                      onClick={() => handleTap(c)}
                      testId="choice"
                    />
                  ))}
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
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${totalHits} hits · ${falseAlarms} wrong`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Visual pieces ---------------- */

const COLOR_HEX: Record<Color, string> = {
  red: "#ef4444",
  green: "#10b981",
  blue: "#3b82f6",
  yellow: "#eab308",
};

const COLOR_LABEL: Record<Color, string> = {
  red: "RED",
  green: "GREEN",
  blue: "BLUE",
  yellow: "YELLOW",
};

function Swatch({ color, size = 96 }: { color: Color; size?: number }) {
  return (
    <div
      className="rounded-2xl shadow-soft ring-1 ring-black/10"
      style={{
        width: size,
        height: size,
        backgroundColor: COLOR_HEX[color],
      }}
      aria-label={`${color} swatch`}
    />
  );
}

function StroopWord({
  word,
  ink,
}: {
  word: string;
  ink: Color | null;
}) {
  const color = ink ? COLOR_HEX[ink] : undefined;
  return (
    <span
      className={
        "text-5xl font-black tracking-wider sm:text-6xl " +
        (ink ? "" : "text-slate-700 dark:text-slate-200")
      }
      style={color ? { color } : undefined}
    >
      {word}
    </span>
  );
}

function StroopStimulus({
  mode,
  ink,
  word,
}: {
  mode: LevelMode;
  ink: Color;
  word: Color | null;
}) {
  if (mode === "swatchOnly") {
    return <Swatch color={ink} size={140} />;
  }
  // wordNeutral, congruent, incongruent, mixed all render the word
  const label = word ? COLOR_LABEL[word] : COLOR_LABEL[ink];
  const renderInk = mode === "wordNeutral" ? null : ink;
  return <StroopWord word={label} ink={renderInk} />;
}

function ColorButton({
  color,
  onClick,
  size = 64,
  testId,
}: {
  color: Color;
  onClick: () => void;
  size?: number;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Choose ${color}`}
      data-testid={testId}
      data-choice-color={color}
      className="grid place-items-center rounded-2xl bg-white p-3 shadow-soft ring-1 ring-slate-200 transition-transform active:scale-95 dark:bg-slate-800 dark:ring-slate-700"
    >
      <div
        className="rounded-xl"
        style={{
          width: size,
          height: size,
          backgroundColor: COLOR_HEX[color],
        }}
      />
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {color}
      </span>
    </button>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

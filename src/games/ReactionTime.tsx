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
type Size = "small" | "big";
type Stimulus = { shape: Shape; color: Color; size: Size };

/** A rule constrains 1–3 attributes. The more it pins down, the harder the
 *  visual search ("any circle" vs "the big red triangle"). */
type RuleSpec = {
  shape?: Shape;
  color?: Color;
  size?: Size;
};

type Trial = {
  options: [Stimulus, Stimulus, Stimulus];
  /** -1 when this trial has no target (player must hold); else 0 | 1 | 2. */
  targetIdx: -1 | 0 | 1 | 2;
  windowMs: number;
};

type ResultKind = "hit" | "miss" | "wrong" | "nogo-correct";
type TrialResult = {
  kind: ResultKind;
  ms?: number;
  pts: number;
  mult: number;
};

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  /** Rule complexity: how many attributes a generated rule pins down. */
  minAttrs: number;
  maxAttrs: number;
  /** A rule stays active for a random count in this range, then switches. */
  switchEvery: [number, number];
  trialCount: number;
  requiredCorrect: number;
  startWindowMs: number;
  endWindowMs: number;
  /** Probability 0..1 that a given trial is a no-target "hold" trial. */
  noTargetPct: number;
};

const SESSION_SECONDS = 180; // 3-minute session
const LEVEL_CLEAR_BONUS = 75;
const INTER_STIMULUS_MS = 300;
const RULE_FLASH_MS = 850; // pause to read a freshly switched rule
const NOGO_CORRECT_BONUS = 40;
const FALSE_ALARM_PENALTY = -8;

const SHAPES: readonly Shape[] = ["circle", "square", "triangle"];
const COLORS: readonly Color[] = ["green", "red", "yellow", "blue"];
const SIZES: readonly Size[] = ["small", "big"];
const ATTR_KEYS = ["shape", "color", "size"] as const;

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Single feature",
    minAttrs: 1,
    maxAttrs: 1,
    switchEvery: [5, 7],
    trialCount: 18,
    requiredCorrect: 13,
    startWindowMs: 2400,
    endWindowMs: 1900,
    noTargetPct: 0,
  },
  {
    id: 2,
    name: "Shifting rules",
    minAttrs: 1,
    maxAttrs: 2,
    switchEvery: [3, 5],
    trialCount: 22,
    requiredCorrect: 16,
    startWindowMs: 2100,
    endWindowMs: 1600,
    noTargetPct: 0.1,
  },
  {
    id: 3,
    name: "Feature pairs",
    minAttrs: 2,
    maxAttrs: 2,
    switchEvery: [3, 4],
    trialCount: 24,
    requiredCorrect: 17,
    startWindowMs: 1900,
    endWindowMs: 1400,
    noTargetPct: 0.18,
  },
  {
    id: 4,
    name: "Full conjunction",
    minAttrs: 2,
    maxAttrs: 3,
    switchEvery: [2, 4],
    trialCount: 28,
    requiredCorrect: 18,
    startWindowMs: 1700,
    endWindowMs: 1200,
    noTargetPct: 0.25,
  },
];

/* ---------------- Helpers ---------------- */

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOther<T>(arr: readonly T[], val: T): T {
  const others = arr.filter((x) => x !== val);
  return others[randInt(0, others.length - 1)];
}

function comboMultiplier(combo: number): number {
  return Math.min(5, 1 + Math.floor(combo / 3));
}

/* ---------------- Rules ---------------- */

function makeRuleSpec(attrCount: number): RuleSpec {
  const keys = [...ATTR_KEYS]
    .sort(() => Math.random() - 0.5)
    .slice(0, attrCount);
  const spec: RuleSpec = {};
  for (const k of keys) {
    if (k === "shape") spec.shape = SHAPES[randInt(0, SHAPES.length - 1)];
    else if (k === "color") spec.color = COLORS[randInt(0, COLORS.length - 1)];
    else spec.size = SIZES[randInt(0, SIZES.length - 1)];
  }
  return spec;
}

function sameSpec(a: RuleSpec, b: RuleSpec): boolean {
  return a.shape === b.shape && a.color === b.color && a.size === b.size;
}

/** A rule that differs from the previous one, so a switch is always visible. */
function nextRuleSpec(level: Level, prev: RuleSpec | null): RuleSpec {
  let spec = makeRuleSpec(randInt(level.minAttrs, level.maxAttrs));
  for (let i = 0; i < 25 && prev && sameSpec(spec, prev); i += 1) {
    spec = makeRuleSpec(randInt(level.minAttrs, level.maxAttrs));
  }
  return spec;
}

function ruleLabel(spec: RuleSpec): string {
  const parts: string[] = [];
  if (spec.size) parts.push(spec.size === "big" ? "BIG" : "SMALL");
  if (spec.color) parts.push(spec.color.toUpperCase());
  if (spec.shape) parts.push(spec.shape.toUpperCase());
  if (parts.length === 0) return "Tap a shape";
  return parts.length === 1
    ? `Tap any ${parts[0]}`
    : `Tap the ${parts.join(" ")}`;
}

/* ---------------- Trial generator ---------------- */

function sampleMatching(spec: RuleSpec): Stimulus {
  return {
    shape: spec.shape ?? SHAPES[randInt(0, SHAPES.length - 1)],
    color: spec.color ?? COLORS[randInt(0, COLORS.length - 1)],
    size: spec.size ?? SIZES[randInt(0, SIZES.length - 1)],
  };
}

/** A near-miss distractor: matches the rule on all but one pinned attribute,
 *  so distractors look almost right and the search is real. */
function sampleNonMatching(spec: RuleSpec): Stimulus {
  const pinned = ATTR_KEYS.filter((k) => spec[k] !== undefined);
  const s = sampleMatching(spec);
  if (pinned.length === 0) return s; // rule pins nothing — shouldn't happen
  const flip = pinned[randInt(0, pinned.length - 1)];
  if (flip === "shape") s.shape = pickOther(SHAPES, s.shape);
  else if (flip === "color") s.color = pickOther(COLORS, s.color);
  else s.size = pickOther(SIZES, s.size);
  return s;
}

function windowForTrial(lvl: Level, trialIdx: number): number {
  const denom = Math.max(1, lvl.trialCount - 1);
  const t = Math.min(1, trialIdx / denom);
  return Math.round(
    lvl.startWindowMs + (lvl.endWindowMs - lvl.startWindowMs) * t
  );
}

function buildTrial(lvl: Level, trialIdx: number, spec: RuleSpec): Trial {
  const windowMs = windowForTrial(lvl, trialIdx);
  const hasTarget = Math.random() >= lvl.noTargetPct;
  const options: [Stimulus, Stimulus, Stimulus] = [
    sampleNonMatching(spec),
    sampleNonMatching(spec),
    sampleNonMatching(spec),
  ];
  if (!hasTarget) {
    return { options, targetIdx: -1, windowMs };
  }
  const targetIdx = randInt(0, 2) as 0 | 1 | 2;
  options[targetIdx] = sampleMatching(spec);
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
  const [rule, setRule] = useState<RuleSpec | null>(null);
  const [ruleSwitchKey, setRuleSwitchKey] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [levelCorrect, setLevelCorrect] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [lastResult, setLastResult] = useState<TrialResult | null>(null);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [totalHits, setTotalHits] = useState(0);
  const [falseAlarms, setFalseAlarms] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);

  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const bestComboRef = useRef(0);
  const levelPointsRef = useRef(0);
  const clearedRef = useRef(0);
  const levelIdxRef = useRef(0);
  const trialIdxRef = useRef(0);
  const levelCorrectRef = useRef(0);
  const ruleRef = useRef<RuleSpec | null>(null);
  const trialsUntilSwitchRef = useRef(0);
  const ruleSwitchKeyRef = useRef(0);
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

  /** Apply a trial outcome: update the combo streak, score, and feedback. */
  const evaluate = (kind: ResultKind, basePts: number, ms?: number) => {
    const correct = kind === "hit" || kind === "nogo-correct";
    if (correct) {
      comboRef.current += 1;
      if (comboRef.current > bestComboRef.current) {
        bestComboRef.current = comboRef.current;
        setBestCombo(bestComboRef.current);
      }
    } else {
      comboRef.current = 0;
    }
    setCombo(comboRef.current);

    const mult = comboMultiplier(comboRef.current);
    const pts = correct ? basePts * mult : basePts;
    if (pts !== 0) {
      scoreRef.current = Math.max(0, scoreRef.current + pts);
      levelPointsRef.current += pts;
      setScore(scoreRef.current);
    }
    if (correct) {
      levelCorrectRef.current += 1;
      setLevelCorrect(levelCorrectRef.current);
    }
    if (kind === "hit") setTotalHits((n) => n + 1);
    if (kind === "wrong") setFalseAlarms((n) => n + 1);
    setLastResult({ kind, ms, pts, mult });
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

    // Rule switch: the active rule changes mid-level so you can't autopilot.
    let switched = false;
    if (trialsUntilSwitchRef.current <= 0) {
      const spec = nextRuleSpec(lvl, ruleRef.current);
      ruleRef.current = spec;
      setRule(spec);
      ruleSwitchKeyRef.current += 1;
      setRuleSwitchKey(ruleSwitchKeyRef.current);
      trialsUntilSwitchRef.current = randInt(
        lvl.switchEvery[0],
        lvl.switchEvery[1]
      );
      switched = true;
    }
    trialsUntilSwitchRef.current -= 1;

    const buildAndShow = () => {
      if (endedRef.current) return;
      const t = buildTrial(lvl, i, ruleRef.current as RuleSpec);
      trialRef.current = t;
      respondedRef.current = false;
      setTrial(t);
      startAtRef.current = performance.now();
      responseTimerRef.current = window.setTimeout(() => {
        if (respondedRef.current || endedRef.current) return;
        const current = trialRef.current;
        const isHoldTrial = current?.targetIdx === -1;
        if (isHoldTrial) {
          haptic.tap();
          evaluate("nogo-correct", NOGO_CORRECT_BONUS);
        } else {
          evaluate("miss", 0);
        }
        trialIdxRef.current += 1;
        setTrialIdx(trialIdxRef.current);
        trialRef.current = null;
        setTrial(null);
        interStimulusTimerRef.current = window.setTimeout(
          armNext,
          INTER_STIMULUS_MS
        );
      }, t.windowMs);
    };

    // After a switch, hold the trial back briefly so the new rule can be read.
    if (switched) {
      interStimulusTimerRef.current = window.setTimeout(
        buildAndShow,
        RULE_FLASH_MS
      );
    } else {
      buildAndShow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end]);

  const startLevel = useCallback(
    (idx: number) => {
      const lvl = LEVELS[idx];
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
      // first rule of the level
      const spec = nextRuleSpec(lvl, null);
      ruleRef.current = spec;
      setRule(spec);
      ruleSwitchKeyRef.current += 1;
      setRuleSwitchKey(ruleSwitchKeyRef.current);
      trialsUntilSwitchRef.current = randInt(
        lvl.switchEvery[0],
        lvl.switchEvery[1]
      );
      setPhase("playing");
      clearTimers();
      interStimulusTimerRef.current = window.setTimeout(armNext, RULE_FLASH_MS);
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
      evaluate("hit", scoreForHit(ms), ms);
    } else {
      haptic.error();
      evaluate("wrong", FALSE_ALARM_PENALTY);
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
    comboRef.current = 0;
    bestComboRef.current = 0;
    setCombo(0);
    setBestCombo(0);
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
    ruleRef.current = null;
    setRule(null);
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
        "Three options appear side by side. Tap the one that matches the current rule — or if NONE match, hold and don't tap.",
      stage: (
        <div className="grid min-h-[26vh] place-items-center rounded-2xl bg-white/80 p-6 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <RtDefs />
          <div className="text-center">
            <RuleBadge label="Tap any CIRCLE" switchKey={0} />
            <div className="mt-3 flex items-center justify-center gap-3">
              <div className="opacity-40">
                <StimulusShape
                  stimulus={{ shape: "square", color: "green", size: "big" }}
                  size={56}
                />
              </div>
              <StimulusShape
                stimulus={{ shape: "circle", color: "red", size: "big" }}
                size={56}
              />
              <div className="opacity-40">
                <StimulusShape
                  stimulus={{ shape: "triangle", color: "blue", size: "big" }}
                  size={56}
                />
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      caption:
        "The rule keeps switching mid-level — a banner flashes the new one. Re-read it every time; you can't autopilot.",
      stage: (
        <div className="grid min-h-[26vh] place-items-center gap-3 rounded-2xl bg-white/80 p-6 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <RtDefs />
          <RuleBadge label="Tap any GREEN" switchKey={0} />
          <div className="text-xs font-semibold text-slate-400">↓ a few trials later ↓</div>
          <RuleBadge label="Tap any TRIANGLE" switchKey={1} />
        </div>
      ),
    },
    {
      caption:
        "Later, rules pin down two or three features at once. 'Tap the BIG RED TRIANGLE' — colour or shape alone is a trap.",
      stage: (
        <div className="grid min-h-[26vh] place-items-center rounded-2xl bg-white/80 p-6 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <RtDefs />
          <div className="text-center">
            <RuleBadge label="Tap the BIG RED TRIANGLE" switchKey={0} />
            <div className="mt-3 flex items-center justify-center gap-3">
              <div className="opacity-40">
                <StimulusShape
                  stimulus={{ shape: "triangle", color: "red", size: "small" }}
                  size={56}
                />
              </div>
              <StimulusShape
                stimulus={{ shape: "triangle", color: "red", size: "big" }}
                size={56}
              />
              <div className="opacity-40">
                <StimulusShape
                  stimulus={{ shape: "circle", color: "red", size: "big" }}
                  size={56}
                />
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      caption:
        "Hit = points (faster = more). Consecutive correct answers build a combo multiplier — up to x5. A wrong tap (-8) resets it.",
      stage: (
        <div className="grid min-h-[22vh] place-items-center rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-800">
          <LevelProgress total={4} current={1} cleared={0} />
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

  const mult = comboMultiplier(combo);

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four reaction levels in one 3-minute session. Tap the option that
          matches the rule, or hold when none do — but the rule keeps
          switching, and later it pins down two or three features at once
          ("the big red triangle"). Fast, clean streaks build a combo
          multiplier.
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
              <AnimatePresence>
                {combo >= 2 && (
                  <motion.span
                    key={`combo-${combo}`}
                    initial={{ scale: 1.35, opacity: 0.6 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800"
                    data-testid="combo"
                  >
                    <FlameIcon /> x{mult} · {combo}
                  </motion.span>
                )}
              </AnimatePresence>
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

          <div data-testid="rule">
            <RuleBadge
              label={rule ? ruleLabel(rule) : ""}
              switchKey={ruleSwitchKey}
            />
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
              nextLabel={LEVELS[lastCleared]?.name}
            />
          ) : (
            <div
              data-testid="stage"
              className={
                "no-select relative grid min-h-[54vh] w-full place-items-center overflow-hidden rounded-3xl bg-slate-100 px-4 py-6 ring-1 transition-colors dark:bg-slate-900 " +
                feedbackColor
              }
            >
              <RtDefs />
              <div className="flex w-full max-w-md flex-col items-center gap-5">
                <CountdownBar
                  durationMs={trial?.windowMs ?? 0}
                  trialKey={`${levelIdx}-${trialIdx}`}
                  active={!!trial}
                />
                <div className="relative flex min-h-[150px] w-full items-center justify-center">
                  {trial && (
                    <div
                      key={`row-${levelIdx}-${trialIdx}`}
                      className="grid w-full grid-cols-3 items-center justify-items-center gap-3"
                    >
                      {trial.options.map((opt, idx) => (
                        <motion.button
                          key={`opt-${levelIdx}-${trialIdx}-${idx}`}
                          type="button"
                          initial={{ opacity: 0, scale: 0.7, y: 12 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{
                            delay: idx * 0.05,
                            type: "spring",
                            stiffness: 440,
                            damping: 24,
                          }}
                          whileTap={{ scale: 0.93 }}
                          onClick={() => handleTap(idx as 0 | 1 | 2)}
                          aria-label={`Option ${idx + 1}: ${opt.size} ${opt.color} ${opt.shape}`}
                          data-testid="stimulus"
                          data-option-idx={idx}
                          data-is-target={trial.targetIdx === idx ? 1 : 0}
                          data-shape={opt.shape}
                          data-color={opt.color}
                          data-size={opt.size}
                          className="grid h-[110px] w-[110px] place-items-center rounded-2xl bg-white shadow-soft ring-1 ring-slate-200 transition-colors hover:ring-brand-300 dark:bg-slate-800 dark:ring-slate-700"
                        >
                          <StimulusShape stimulus={opt} size={96} />
                        </motion.button>
                      ))}
                    </div>
                  )}
                  <AnimatePresence>
                    {!trial && lastResult && (
                      <motion.div
                        key={`fb-${lastResult.kind}-${trialIdx}`}
                        initial={{ opacity: 0, y: 8, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute flex flex-col items-center gap-1.5"
                      >
                        <FeedbackPanel result={lastResult} />
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
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${totalHits} hits · best combo x${comboMultiplier(bestCombo)} · ${falseAlarms} false alarm${falseAlarms === 1 ? "" : "s"}`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Rule badge ---------------- */

function RuleBadge({
  label,
  switchKey,
}: {
  label: string;
  switchKey: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-accent-teal px-4 py-2 text-center text-white shadow-soft">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-white/80">
        Rule
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={switchKey}
          initial={{ opacity: 0, scale: 0.85, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 1.1, y: -6 }}
          transition={{ type: "spring", stiffness: 380, damping: 22 }}
          className="text-lg font-black sm:text-xl"
        >
          {label || "—"}
        </motion.div>
      </AnimatePresence>
      {/* a quick sheen sweeps across whenever the rule changes */}
      <motion.div
        key={`sheen-${switchKey}`}
        initial={{ x: "-120%" }}
        animate={{ x: "120%" }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-white/25"
      />
    </div>
  );
}

/* ---------------- Feedback panel ---------------- */

function FeedbackPanel({ result }: { result: TrialResult }) {
  if (result.kind === "hit") {
    const ms = Math.round(result.ms ?? 0);
    return (
      <>
        <div className="flex items-baseline gap-2 text-emerald-600 dark:text-emerald-300">
          <span className="text-2xl font-black sm:text-3xl">{ms} ms</span>
          <span className="text-sm font-bold">
            +{result.pts}
            {result.mult > 1 && (
              <span className="text-amber-600 dark:text-amber-300">
                {" "}
                (x{result.mult})
              </span>
            )}
          </span>
        </div>
        <ReactionGauge ms={ms} />
      </>
    );
  }
  if (result.kind === "nogo-correct") {
    return (
      <div className="text-xl font-bold text-emerald-600 dark:text-emerald-300 sm:text-2xl">
        +{result.pts} · held
      </div>
    );
  }
  if (result.kind === "wrong") {
    return (
      <div className="text-xl font-bold text-rose-600 dark:text-rose-300 sm:text-2xl">
        {result.pts} · wrong — combo lost
      </div>
    );
  }
  return (
    <div className="text-xl font-bold text-amber-600 dark:text-amber-300 sm:text-2xl">
      missed
    </div>
  );
}

/** Horizontal meter: a fast reaction fills it green, a slow one barely moves. */
function ReactionGauge({ ms }: { ms: number }) {
  const fill = Math.max(0, Math.min(1, (900 - ms) / 750));
  const color =
    fill > 0.66 ? "bg-emerald-500" : fill > 0.33 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <motion.div
        className={"h-full rounded-full " + color}
        initial={{ width: 0 }}
        animate={{ width: `${fill * 100}%` }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

function FlameIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2c1.5 3 5 4.5 5 9a5 5 0 1 1-10 0c0-2 1-3 1-3 0 1.5 1 2.5 2 2.5 0-3-1-5 2-8.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

/* ---------------- Stimulus shape ---------------- */

const COLOR_FILL: Record<Color, string> = {
  green: "#10b981",
  red: "#ef4444",
  yellow: "#eab308",
  blue: "#3b82f6",
};
const COLOR_LIGHT: Record<Color, string> = {
  green: "#6ee7b7",
  red: "#fca5a5",
  yellow: "#fde047",
  blue: "#93c5fd",
};
const COLOR_STROKE: Record<Color, string> = {
  green: "#047857",
  red: "#991b1b",
  yellow: "#a16207",
  blue: "#1e40af",
};

/** Shared gradient + shadow defs — referenced document-wide via url(#id). */
function RtDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        {(Object.keys(COLOR_FILL) as Color[]).map((c) => (
          <linearGradient
            key={c}
            id={`rtGrad-${c}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={COLOR_LIGHT[c]} />
            <stop offset="100%" stopColor={COLOR_FILL[c]} />
          </linearGradient>
        ))}
        <filter id="rtShadow" x="-35%" y="-35%" width="170%" height="170%">
          <feDropShadow
            dx="0"
            dy="2.5"
            stdDeviation="2"
            floodColor="#0f172a"
            floodOpacity="0.3"
          />
        </filter>
      </defs>
    </svg>
  );
}

function StimulusShape({
  stimulus,
  size = 96,
}: {
  stimulus: Stimulus;
  size?: number;
}) {
  const fill = `url(#rtGrad-${stimulus.color})`;
  const stroke = COLOR_STROKE[stimulus.color];
  // "small" stimuli are drawn noticeably smaller within the same box
  const scale = stimulus.size === "small" ? 0.6 : 1;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-label={`${stimulus.size} ${stimulus.color} ${stimulus.shape}`}
    >
      <g
        transform={`translate(50 50) scale(${scale}) translate(-50 -50)`}
        filter="url(#rtShadow)"
      >
        {stimulus.shape === "circle" && (
          <circle
            cx="50"
            cy="50"
            r="42"
            fill={fill}
            stroke={stroke}
            strokeWidth="3"
          />
        )}
        {stimulus.shape === "square" && (
          <rect
            x="10"
            y="10"
            width="80"
            height="80"
            rx="14"
            fill={fill}
            stroke={stroke}
            strokeWidth="3"
          />
        )}
        {stimulus.shape === "triangle" && (
          <polygon
            points="50,10 90,86 10,86"
            fill={fill}
            stroke={stroke}
            strokeWidth="3"
            strokeLinejoin="round"
          />
        )}
      </g>
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

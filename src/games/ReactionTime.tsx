import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { LevelComplete } from "@/components/LevelComplete";
import { GameHUD } from "@/components/GameHUD";
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
 *  visual search ("any red balloon" vs "the big red triangle balloon"). */
type RuleSpec = {
  shape?: Shape;
  color?: Color;
  size?: Size;
};

/** One drifting balloon: its stimulus plus where it flies in the scene. */
type BalloonSpec = {
  stimulus: Stimulus;
  x: number; // lane centre (scene units)
  spawnY: number; // body-centre y at launch
  driftTo: number; // body-centre y when the window expires
  bobDur: number; // idle bob duration (s)
  bobDelay: number;
};

type Trial = {
  balloons: [BalloonSpec, BalloonSpec, BalloonSpec];
  /** -1 when no balloon matches (player must tap the cloud); else 0|1|2. */
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

type Ping = {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: "ok" | "bad" | "warn";
};

type Burst = {
  id: number;
  x: number;
  y: number;
  color: Color;
  s: number;
};

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  /** Attribute combinations a rule may pin at this level. */
  rulePools: (keyof RuleSpec)[][];
  /** Trials between rule switches — null = the rule never switches. */
  switchEvery: [number, number] | null;
  trialCount: number;
  requiredCorrect: number;
  startWindowMs: number;
  endWindowMs: number;
  /** Probability 0..1 that a launch has no matching balloon. */
  noTargetPct: number;
};

const SESSION_SECONDS = 180; // 3-minute session
const LEVEL_CLEAR_BONUS = 75;
const INTER_STIMULUS_MS = 300;
const RULE_FLASH_MS = 900; // pause to read a freshly switched rule
const NOGO_BASE = 8; // base points for a correct "none match"
const WRONG_PENALTY = -10;
const FEEDBACK_MS = 900;

const SKY = { w: 100, h: 80 };
const LANES = [22, 50, 78] as const;
const BIG_S = 8.2;
const SMALL_S = 5.6;

const SHAPES: readonly Shape[] = ["circle", "square", "triangle"];
const COLORS: readonly Color[] = ["green", "red", "yellow", "blue"];
const SIZES: readonly Size[] = ["small", "big"];

const LEVELS: Level[] = [
  {
    id: 1,
    name: "One colour",
    rulePools: [["color"]],
    switchEvery: null, // the rule is fixed — pure warm-up
    trialCount: 10,
    requiredCorrect: 6,
    startWindowMs: 3400,
    endWindowMs: 2800,
    noTargetPct: 0,
  },
  {
    id: 2,
    name: "Rule starts switching",
    rulePools: [["color"], ["shape"]],
    switchEvery: [4, 6],
    trialCount: 14,
    requiredCorrect: 9,
    startWindowMs: 3000,
    endWindowMs: 2400,
    noTargetPct: 0.12,
  },
  {
    id: 3,
    name: "Two features",
    rulePools: [["color", "shape"]],
    switchEvery: [3, 4],
    trialCount: 16,
    requiredCorrect: 10,
    startWindowMs: 2700,
    endWindowMs: 2100,
    noTargetPct: 0.18,
  },
  {
    id: 4,
    name: "Full conjunction, faster",
    rulePools: [["color", "shape", "size"]],
    switchEvery: [2, 4],
    trialCount: 18,
    requiredCorrect: 11,
    startWindowMs: 2300,
    endWindowMs: 1700,
    noTargetPct: 0.22,
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

function makeRuleSpec(lvl: Level): RuleSpec {
  const pool = lvl.rulePools[randInt(0, lvl.rulePools.length - 1)];
  const spec: RuleSpec = {};
  for (const k of pool) {
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
  let spec = makeRuleSpec(level);
  for (let i = 0; i < 25 && prev && sameSpec(spec, prev); i += 1) {
    spec = makeRuleSpec(level);
  }
  return spec;
}

function ruleLabel(spec: RuleSpec): string {
  const parts: string[] = [];
  if (spec.size) parts.push(spec.size === "big" ? "BIG" : "SMALL");
  if (spec.color) parts.push(spec.color.toUpperCase());
  if (spec.shape) parts.push(spec.shape.toUpperCase());
  if (parts.length === 0) return "any balloon";
  return parts.length === 1 ? `any ${parts[0]}` : `the ${parts.join(" ")}`;
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
 *  so distractor balloons look almost right and the search is real. */
function sampleNonMatching(spec: RuleSpec): Stimulus {
  const pinned = (["shape", "color", "size"] as const).filter(
    (k) => spec[k] !== undefined
  );
  const s = sampleMatching(spec);
  if (pinned.length === 0) return s;
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
  const stimuli: [Stimulus, Stimulus, Stimulus] = [
    sampleNonMatching(spec),
    sampleNonMatching(spec),
    sampleNonMatching(spec),
  ];
  let targetIdx: -1 | 0 | 1 | 2 = -1;
  if (hasTarget) {
    targetIdx = randInt(0, 2) as 0 | 1 | 2;
    stimuli[targetIdx] = sampleMatching(spec);
  }
  const balloons = stimuli.map((stimulus, i) => ({
    stimulus,
    x: LANES[i] + (Math.random() * 8 - 4),
    spawnY: 62 + Math.random() * 6,
    driftTo: 6 + Math.random() * 4,
    bobDur: 2.1 + Math.random() * 1.1,
    bobDelay: Math.random() * 0.7,
  })) as [BalloonSpec, BalloonSpec, BalloonSpec];
  return { balloons, targetIdx, windowMs };
}

/** Speed-scaled base points for a pop; the combo multiplier stacks on top. */
function scoreForHit(ms: number): number {
  return Math.max(4, Math.round((1250 - ms) / 50));
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
  const [pings, setPings] = useState<Ping[]>([]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [cloudPulse, setCloudPulse] = useState(0);

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
  const transientTimersRef = useRef<number[]>([]);
  const startAtRef = useRef(0);
  const respondedRef = useRef(false);
  const endedRef = useRef(false);
  const trialRef = useRef<Trial | null>(null);
  const pingIdRef = useRef(0);
  const burstIdRef = useRef(0);

  const currentLevel = LEVELS[levelIdx];

  /** Fire-and-forget timeout that is guaranteed to be cleared on unmount. */
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    transientTimersRef.current.push(id);
  };

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
      transientTimersRef.current.forEach((id) => window.clearTimeout(id));
      transientTimersRef.current = [];
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

  const addPing = (x: number, y: number, text: string, tone: Ping["tone"]) => {
    const id = ++pingIdRef.current;
    setPings((ps) => [...ps, { id, x, y, text, tone }]);
    later(() => setPings((ps) => ps.filter((p) => p.id !== id)), 950);
  };

  const addBurst = (x: number, y: number, color: Color, s: number) => {
    const id = ++burstIdRef.current;
    setBursts((bs) => [...bs, { id, x, y, color, s }]);
    later(() => setBursts((bs) => bs.filter((b) => b.id !== id)), 750);
  };

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
    const result: TrialResult = { kind, ms, pts, mult };
    setLastResult(result);
    later(() => {
      setLastResult((cur) => (cur === result ? null : cur));
    }, FEEDBACK_MS);
    return pts;
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
        setPhase("levelDone");
        if (nextIdx >= LEVELS.length) {
          later(() => end(true), 1100);
        } else {
          later(() => startLevel(nextIdx), 1100);
        }
      } else {
        end(false);
      }
      return;
    }

    // Rule switch: the active rule changes mid-level so you can't autopilot.
    let switched = false;
    if (lvl.switchEvery !== null && trialsUntilSwitchRef.current <= 0) {
      const spec = nextRuleSpec(lvl, ruleRef.current);
      ruleRef.current = spec;
      setRule(spec);
      ruleSwitchKeyRef.current += 1;
      setRuleSwitchKey(ruleSwitchKeyRef.current);
      trialsUntilSwitchRef.current = randInt(
        lvl.switchEvery[0],
        lvl.switchEvery[1]
      );
      haptic.tap();
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
          // Waiting a clear sky out still counts — the cloud is just faster.
          haptic.tap();
          const pts = evaluate("nogo-correct", NOGO_BASE);
          addPing(50, 30, `+${pts}`, "ok");
        } else {
          evaluate("miss", 0);
          addPing(50, 16, "flew away", "warn");
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

    // After a switch, hold the launch back briefly so the new rule can be read.
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
      if (endedRef.current) return; // session ended during the levelDone pause
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
      setPings([]);
      setBursts([]);
      // first rule of the level
      const spec = nextRuleSpec(lvl, ruleRef.current);
      ruleRef.current = spec;
      setRule(spec);
      ruleSwitchKeyRef.current += 1;
      setRuleSwitchKey(ruleSwitchKeyRef.current);
      trialsUntilSwitchRef.current =
        lvl.switchEvery === null
          ? Number.POSITIVE_INFINITY
          : randInt(lvl.switchEvery[0], lvl.switchEvery[1]);
      setPhase("playing");
      clearTimers();
      interStimulusTimerRef.current = window.setTimeout(armNext, RULE_FLASH_MS);
    },
    [armNext]
  );

  /** Where a balloon's body sits right now (drift is linear over the window). */
  const balloonPosNow = (b: BalloonSpec, windowMs: number) => {
    const frac = Math.min(
      1,
      Math.max(0, (performance.now() - startAtRef.current) / windowMs)
    );
    return { x: b.x, y: b.spawnY + (b.driftTo - b.spawnY) * frac };
  };

  const finishTrial = () => {
    trialIdxRef.current += 1;
    setTrialIdx(trialIdxRef.current);
    trialRef.current = null;
    setTrial(null);
    interStimulusTimerRef.current = window.setTimeout(
      armNext,
      INTER_STIMULUS_MS
    );
  };

  const claimResponse = (): Trial | null => {
    if (phase !== "playing" || respondedRef.current || endedRef.current)
      return null;
    const current = trialRef.current;
    if (!current) return null;
    respondedRef.current = true;
    if (responseTimerRef.current !== null) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }
    return current;
  };

  const handleTapBalloon = (idx: 0 | 1 | 2, e: React.PointerEvent) => {
    e.stopPropagation();
    const current = claimResponse();
    if (!current) return;
    const ms = performance.now() - startAtRef.current;
    const b = current.balloons[idx];
    const pos = balloonPosNow(b, current.windowMs);
    const isHit = current.targetIdx !== -1 && idx === current.targetIdx;
    if (isHit) {
      haptic.success();
      const pts = evaluate("hit", scoreForHit(ms), ms);
      addBurst(pos.x, pos.y, b.stimulus.color, b.stimulus.size === "big" ? BIG_S : SMALL_S);
      addPing(pos.x, pos.y - 4, `+${pts}`, "ok");
    } else {
      haptic.error();
      const pts = evaluate("wrong", WRONG_PENALTY);
      addPing(pos.x, pos.y - 4, `${pts}`, "bad");
    }
    finishTrial();
  };

  const handleNoneMatch = () => {
    const current = claimResponse();
    if (!current) return;
    if (current.targetIdx === -1) {
      haptic.success();
      setCloudPulse((n) => n + 1);
      const pts = evaluate("nogo-correct", NOGO_BASE);
      addPing(50, 66, `+${pts}`, "ok");
    } else {
      haptic.error();
      const pts = evaluate("wrong", WRONG_PENALTY);
      addPing(50, 66, `${pts}`, "bad");
    }
    finishTrial();
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
    }, 200);
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
    setPings([]);
    setBursts([]);
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
      caption: "Balloons drift up. Pop the one that matches the rule banner.",
      stage: <DemoSky mode="pop" />,
      auto: 3600,
    },
    {
      caption: "Watch the banner — the rule flips as you play. Re-check it!",
      stage: <DemoSky mode="switch" />,
      auto: 3400,
    },
    {
      caption: "No balloon matches? Tap the cloud instead of popping.",
      stage: <DemoSky mode="cloud" />,
      auto: 3600,
    },
    {
      caption: "Streaks build a combo, up to x5. Later rules add shape and size.",
      stage: <DemoSky mode="combo" />,
    },
  ];

  /* ---------------- Render ---------------- */

  const ringClass =
    lastResult?.kind === "hit"
      ? "ring-emerald-400/80"
      : lastResult?.kind === "nogo-correct"
      ? "ring-emerald-300/80"
      : lastResult?.kind === "wrong"
      ? "ring-rose-400/80"
      : lastResult?.kind === "miss"
      ? "ring-amber-300/80"
      : "ring-sky-200/80 dark:ring-indigo-900";

  const mult = comboMultiplier(combo);
  const trialKey = `${levelIdx}-${trialIdx}`;

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four skies in one 3-minute session. Balloons drift up, each carrying
          a shape — pop the one matching the rule banner, or tap the
          None&nbsp;match cloud when no balloon fits. Level 1 is a single fixed
          colour; by level 4 the rule pins colour, shape AND size while the
          balloons fly faster. Clean streaks build a combo multiplier up to x5.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startSession} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-3">
          <BalloonDefs />
          <GameHUD
            levelTotal={LEVELS.length}
            levelCurrent={levelIdx + 1}
            levelsCleared={clearedRef.current}
            score={score}
            timeLeft={timeLeft}
            sessionSeconds={SESSION_SECONDS}
            extra={
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
            }
          />

          <div data-testid="rule">
            <RuleBanner spec={rule} switchKey={ruleSwitchKey} />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {currentLevel.name} · need {currentLevel.requiredCorrect} /{" "}
              {currentLevel.trialCount}
            </span>
            <span data-testid="progress">
              {levelCorrect} correct · launch{" "}
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
            <>
              <SkyScene
                trial={trial}
                trialKey={trialKey}
                pings={pings}
                bursts={bursts}
                ringClass={ringClass}
                lastResult={lastResult}
                onTapBalloon={handleTapBalloon}
              />
              <CloudButton onPress={handleNoneMatch} pulseKey={cloudPulse} />
            </>
          )}
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${totalHits} pops · best combo x${comboMultiplier(bestCombo)} · ${falseAlarms} wrong tap${falseAlarms === 1 ? "" : "s"}`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Colours & shared defs ---------------- */

const COLOR_FILL: Record<Color, string> = {
  green: "#10b981",
  red: "#ef4444",
  yellow: "#eab308",
  blue: "#3b82f6",
};
const COLOR_LIGHT: Record<Color, string> = {
  green: "#a7f3d0",
  red: "#fecaca",
  yellow: "#fef08a",
  blue: "#bfdbfe",
};
const COLOR_DEEP: Record<Color, string> = {
  green: "#047857",
  red: "#b91c1c",
  yellow: "#a16207",
  blue: "#1d4ed8",
};

type BalloonColor = Color | "any";

function strokeFor(color: BalloonColor): string {
  return color === "any" ? "#64748b" : COLOR_DEEP[color];
}

/** Document-wide gradients for balloon bodies. Rendered once per phase — the
 *  playing view and each tutorial stage mount their own copy (never both). */
function BalloonDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <defs>
        {(Object.keys(COLOR_FILL) as Color[]).map((c) => (
          <radialGradient key={c} id={`bal-${c}`} cx="0.34" cy="0.28" r="1.05">
            <stop offset="0%" stopColor={COLOR_LIGHT[c]} />
            <stop offset="55%" stopColor={COLOR_FILL[c]} />
            <stop offset="100%" stopColor={COLOR_DEEP[c]} />
          </radialGradient>
        ))}
        <radialGradient id="bal-any" cx="0.34" cy="0.28" r="1.05">
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="55%" stopColor="#cbd5e1" />
          <stop offset="100%" stopColor="#64748b" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/* ---------------- Balloon art ---------------- */

// Balloon-local space: body centred on (0,0), knot at the bottom tip, wavy
// string trailing below. `s` is roughly the body radius.
function balloonBodyPath(s: number): string {
  return (
    `M 0 ${1.2 * s} ` +
    `C ${-0.32 * s} ${0.92 * s} ${-1.0 * s} ${0.55 * s} ${-1.0 * s} ${-0.18 * s} ` +
    `C ${-1.0 * s} ${-1.02 * s} ${-0.55 * s} ${-1.38 * s} 0 ${-1.38 * s} ` +
    `C ${0.55 * s} ${-1.38 * s} ${1.0 * s} ${-1.02 * s} ${1.0 * s} ${-0.18 * s} ` +
    `C ${1.0 * s} ${0.55 * s} ${0.32 * s} ${0.92 * s} 0 ${1.2 * s} Z`
  );
}

function Emblem({ shape, s, color }: { shape: Shape; s: number; color: BalloonColor }) {
  const e = 0.52 * s;
  const cy = -0.14 * s;
  const stroke = strokeFor(color);
  const common = {
    fill: "#ffffff",
    fillOpacity: 0.95,
    stroke,
    strokeWidth: 0.09 * s,
  } as const;
  if (shape === "circle") return <circle cx={0} cy={cy} r={e} {...common} />;
  if (shape === "square")
    return (
      <rect
        x={-e * 0.92}
        y={cy - e * 0.92}
        width={e * 1.84}
        height={e * 1.84}
        rx={e * 0.28}
        {...common}
      />
    );
  return (
    <polygon
      points={`0,${cy - e * 1.05} ${e},${cy + e * 0.8} ${-e},${cy + e * 0.8}`}
      strokeLinejoin="round"
      {...common}
    />
  );
}

function BalloonArt({
  s,
  color,
  shape,
  string = true,
}: {
  s: number;
  color: BalloonColor;
  shape?: Shape;
  string?: boolean;
}) {
  const stroke = strokeFor(color);
  return (
    <g>
      {string && (
        <path
          d={`M 0 ${1.44 * s} q ${0.55 * s} ${0.5 * s} 0 ${1.0 * s} q ${-0.55 * s} ${0.5 * s} 0 ${1.0 * s}`}
          fill="none"
          strokeWidth={0.09 * s}
          strokeLinecap="round"
          className="stroke-slate-500/70 dark:stroke-slate-300/60"
        />
      )}
      {/* knot */}
      <path
        d={`M 0 ${1.12 * s} L ${-0.2 * s} ${1.46 * s} L ${0.2 * s} ${1.46 * s} Z`}
        fill={stroke}
        opacity={0.9}
      />
      {/* body */}
      <path
        d={balloonBodyPath(s)}
        fill={`url(#bal-${color})`}
        stroke={stroke}
        strokeWidth={0.06 * s}
        strokeOpacity={0.4}
      />
      {/* soft highlight */}
      <ellipse
        cx={-0.42 * s}
        cy={-0.6 * s}
        rx={0.24 * s}
        ry={0.42 * s}
        fill="#ffffff"
        opacity={0.55}
        transform={`rotate(-24 ${-0.42 * s} ${-0.6 * s})`}
      />
      <circle cx={-0.18 * s} cy={-1.0 * s} r={0.09 * s} fill="#ffffff" opacity={0.6} />
      {shape && <Emblem shape={shape} s={s} color={color} />}
    </g>
  );
}

/* ---------------- Rule banner ---------------- */

function MiniTargetIcon({ spec }: { spec: RuleSpec }) {
  const s = spec.size === "small" ? 4.4 : 6.2;
  return (
    <svg
      viewBox="-8.5 -10 17 22"
      className="h-12 w-9 shrink-0 drop-shadow"
      aria-hidden
      focusable="false"
    >
      <BalloonArt
        s={s}
        color={spec.color ?? "any"}
        shape={spec.shape}
        string={false}
      />
    </svg>
  );
}

function RuleBanner({
  spec,
  switchKey,
}: {
  spec: RuleSpec | null;
  switchKey: number;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-pink-500 px-4 py-1.5 text-white shadow-soft"
      style={{ perspective: 500 }}
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={switchKey}
          initial={{ rotateX: -92, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          exit={{ rotateX: 88, opacity: 0 }}
          transition={{ duration: 0.26, ease: "easeOut" }}
          className="flex min-h-[3rem] items-center justify-center gap-3"
        >
          {spec ? (
            <>
              <MiniTargetIcon spec={spec} />
              <div className="text-left leading-tight">
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/80">
                  Pop
                </div>
                <div className="text-lg font-black sm:text-xl">
                  {ruleLabel(spec)}
                </div>
              </div>
            </>
          ) : (
            <div className="text-lg font-black">Get ready…</div>
          )}
        </motion.div>
      </AnimatePresence>
      {/* white flash whenever the rule flips */}
      <motion.div
        key={`flash-${switchKey}`}
        initial={{ opacity: 0.75 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="pointer-events-none absolute inset-0 bg-white"
      />
    </div>
  );
}

/* ---------------- Sky scene ---------------- */

function SkyScene({
  trial,
  trialKey,
  pings,
  bursts,
  ringClass,
  lastResult,
  onTapBalloon,
}: {
  trial: Trial | null;
  trialKey: string;
  pings: Ping[];
  bursts: Burst[];
  ringClass: string;
  lastResult: TrialResult | null;
  onTapBalloon: (idx: 0 | 1 | 2, e: React.PointerEvent) => void;
}) {
  return (
    <div
      data-testid="stage"
      className={`no-select relative mx-auto w-full max-w-lg overflow-hidden rounded-3xl bg-sky-300 ring-1 shadow-soft transition-colors duration-200 dark:bg-indigo-950 ${ringClass}`}
      style={{ aspectRatio: `${SKY.w} / ${SKY.h}` }}
    >
      <svg
        viewBox={`0 0 ${SKY.w} ${SKY.h}`}
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="skyDay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#60b8f8" />
            <stop offset="60%" stopColor="#a8dcff" />
            <stop offset="100%" stopColor="#e6f7ff" />
          </linearGradient>
          <linearGradient id="skyNight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#171438" />
            <stop offset="60%" stopColor="#2b2566" />
            <stop offset="100%" stopColor="#4c3d99" />
          </linearGradient>
        </defs>

        {/* backdrop — day and night variants */}
        <rect width={SKY.w} height={SKY.h} fill="url(#skyDay)" className="dark:hidden" />
        <rect width={SKY.w} height={SKY.h} fill="url(#skyNight)" className="hidden dark:block" />

        <Sun />
        <MoonAndStars />

        {/* drifting far clouds */}
        <DriftCloud cx={20} cy={14} k={1} dur={26} dx={9} />
        <DriftCloud cx={76} cy={26} k={0.7} dur={34} dx={-8} />
        <DriftCloud cx={48} cy={48} k={0.55} dur={30} dx={7} />

        {/* rolling hills far below — the balloons' launch field */}
        <path
          d={`M 0 ${SKY.h} L 0 ${SKY.h - 7} Q 25 ${SKY.h - 14} 52 ${SKY.h - 7} Q 78 ${SKY.h - 1} 100 ${SKY.h - 9} L 100 ${SKY.h} Z`}
          className="fill-emerald-300 dark:fill-indigo-900"
        />
        <path
          d={`M 0 ${SKY.h} L 0 ${SKY.h - 3.5} Q 30 ${SKY.h - 9} 60 ${SKY.h - 3} Q 82 ${SKY.h + 1} 100 ${SKY.h - 4} L 100 ${SKY.h} Z`}
          className="fill-emerald-400 dark:fill-indigo-800"
        />

        {/* balloons */}
        <AnimatePresence>
          {trial &&
            trial.balloons.map((b, i) => (
              <SceneBalloon
                key={`b-${trialKey}-${i}`}
                b={b}
                idx={i as 0 | 1 | 2}
                windowMs={trial.windowMs}
                isTarget={trial.targetIdx === i}
                onTap={onTapBalloon}
              />
            ))}
        </AnimatePresence>

        {/* pop bursts */}
        <g pointerEvents="none">
          {bursts.map((bu) => (
            <BurstFx key={bu.id} burst={bu} />
          ))}
        </g>

        {/* floating score pings */}
        <g pointerEvents="none">
          {pings.map((p) => (
            <PingFx key={p.id} ping={p} />
          ))}
        </g>
      </svg>

      {/* per-launch countdown bar */}
      <div className="absolute inset-x-3 top-2 h-1 overflow-hidden rounded-full bg-white/40 dark:bg-white/10">
        {trial && (
          <motion.div
            key={trialKey}
            className="h-full origin-left rounded-full bg-white/90 dark:bg-indigo-300"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: trial.windowMs / 1000, ease: "linear" }}
          />
        )}
      </div>

      {/* between-launch feedback chip (never blocks input) */}
      <AnimatePresence>
        {lastResult && (
          <motion.div
            key={`fb-${lastResult.kind}-${lastResult.pts}-${lastResult.ms ?? 0}`}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
          >
            <FeedbackChip result={lastResult} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FeedbackChip({ result }: { result: TrialResult }) {
  let text: string;
  let cls: string;
  if (result.kind === "hit") {
    const ms = Math.round(result.ms ?? 0);
    text = `${ms} ms · +${result.pts}${result.mult > 1 ? ` (x${result.mult})` : ""}`;
    cls = "bg-emerald-500/95 text-white";
  } else if (result.kind === "nogo-correct") {
    text = `+${result.pts} · clear sky`;
    cls = "bg-emerald-500/95 text-white";
  } else if (result.kind === "wrong") {
    text = `${result.pts} · wrong — combo lost`;
    cls = "bg-rose-500/95 text-white";
  } else {
    text = "flew away";
    cls = "bg-amber-500/95 text-white";
  }
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-black shadow-soft ${cls}`}>
      {text}
    </span>
  );
}

/* ---------------- Scene balloon ---------------- */

function SceneBalloon({
  b,
  idx,
  windowMs,
  isTarget,
  onTap,
}: {
  b: BalloonSpec;
  idx: 0 | 1 | 2;
  windowMs: number;
  isTarget: boolean;
  onTap: (idx: 0 | 1 | 2, e: React.PointerEvent) => void;
}) {
  const st = b.stimulus;
  const s = st.size === "big" ? BIG_S : SMALL_S;
  return (
    <g transform={`translate(${b.x} ${b.spawnY})`}>
      <motion.g
        initial={{ y: 0, opacity: 0, scale: 0.4 }}
        animate={{ y: b.driftTo - b.spawnY, opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.16 } }}
        transition={{
          y: { duration: windowMs / 1000 + 0.4, ease: "linear" },
          opacity: { duration: 0.18 },
          scale: { type: "spring", stiffness: 340, damping: 20 },
        }}
      >
        {/* idle bob — a gentle pendulum sway around the balloon's centre */}
        <motion.g
          animate={{ rotate: [-2.5, 2.5, -2.5], x: [-1, 1, -1] }}
          transition={{
            duration: b.bobDur,
            delay: b.bobDelay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <g
            data-testid="stimulus"
            data-option-idx={idx}
            data-is-target={isTarget ? 1 : 0}
            data-shape={st.shape}
            data-color={st.color}
            data-size={st.size}
            aria-label={`${st.size} ${st.color} ${st.shape} balloon`}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => onTap(idx, e)}
          >
            {/* generous invisible hit target (≥44px at 320px width) */}
            <circle r={s * 1.95} fill="transparent" />
            <BalloonArt s={s} color={st.color} shape={st.shape} />
          </g>
        </motion.g>
      </motion.g>
    </g>
  );
}

/* ---------------- Pop burst ---------------- */

function sliverPath(k: number): string {
  return `M 0 0 Q ${0.55 * k} ${-1.1 * k} 0 ${-2.3 * k} Q ${-0.55 * k} ${-1.1 * k} 0 0 Z`;
}

function BurstFx({ burst }: { burst: Burst }) {
  const { x, y, color, s, id } = burst;
  const n = 7;
  const frags = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + ((id % 5) * Math.PI) / 7;
    const dist = s * (1.1 + ((id + i) % 3) * 0.35);
    return {
      dx: Math.cos(a) * dist,
      dy: Math.sin(a) * dist,
      rot: ((a * 180) / Math.PI + 90) % 360,
      spin: 70 + ((id + i) % 4) * 40,
    };
  });
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* white pop flash */}
      <motion.circle
        r={s * 0.7}
        fill="none"
        stroke="#ffffff"
        strokeWidth={0.9}
        initial={{ scale: 0.4, opacity: 0.95 }}
        animate={{ scale: 2.1, opacity: 0 }}
        transition={{ duration: 0.42, ease: "easeOut" }}
      />
      {frags.map((f, i) => (
        <motion.path
          key={i}
          d={sliverPath(s * 0.26)}
          fill={COLOR_FILL[color]}
          stroke={COLOR_DEEP[color]}
          strokeWidth={0.12}
          initial={{ x: 0, y: 0, rotate: f.rot, scale: 1, opacity: 1 }}
          animate={{
            x: f.dx,
            y: f.dy + s * 0.4,
            rotate: f.rot + f.spin,
            scale: 0.55,
            opacity: 0,
          }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      ))}
    </g>
  );
}

/* ---------------- Score ping ---------------- */

function PingFx({ ping }: { ping: Ping }) {
  const bg =
    ping.tone === "ok" ? "#10b981" : ping.tone === "bad" ? "#f43f5e" : "#f59e0b";
  const edge =
    ping.tone === "ok" ? "#047857" : ping.tone === "bad" ? "#be123c" : "#b45309";
  const w = 7 + ping.text.length * 3.3;
  const h = 8.6;
  return (
    <g transform={`translate(${ping.x} ${ping.y})`}>
      <motion.g
        initial={{ y: 0, scale: 0.5, opacity: 0 }}
        animate={{ y: [0, -3, -10], scale: [0.5, 1.14, 1], opacity: [0, 1, 0] }}
        transition={{ duration: 0.9, times: [0, 0.2, 1], ease: "easeOut" }}
      >
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={h / 2}
          fill={bg}
          stroke={edge}
          strokeWidth={0.45}
        />
        <text
          x={0}
          y={0.3}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={4.8}
          fontWeight={900}
          fill="#ffffff"
        >
          {ping.text}
        </text>
      </motion.g>
    </g>
  );
}

/* ---------------- Sky decorations ---------------- */

function Sun() {
  return (
    <g className="dark:hidden" pointerEvents="none">
      <motion.g
        animate={{ rotate: 360 }}
        transition={{ duration: 90, repeat: Infinity, ease: "linear" }}
        style={{ transformOrigin: "88px 10px" }}
      >
        {Array.from({ length: 8 }, (_, i) => (
          <rect
            key={i}
            x={87.4}
            y={-1}
            width={1.2}
            height={5}
            rx={0.6}
            fill="#fde68a"
            transform={`rotate(${i * 45} 88 10)`}
          />
        ))}
      </motion.g>
      <circle cx={88} cy={10} r={6.5} fill="#fcd34d" />
      <circle cx={86.5} cy={8.5} r={2.2} fill="#fef3c7" opacity={0.8} />
    </g>
  );
}

function MoonAndStars() {
  const stars = [
    { x: 12, y: 10, r: 0.7, d: 0 },
    { x: 30, y: 20, r: 0.5, d: 0.7 },
    { x: 55, y: 8, r: 0.6, d: 1.3 },
    { x: 70, y: 18, r: 0.45, d: 0.4 },
    { x: 92, y: 30, r: 0.55, d: 1.9 },
    { x: 44, y: 30, r: 0.4, d: 1.1 },
  ];
  return (
    <g className="hidden dark:block" pointerEvents="none">
      <circle cx={88} cy={10} r={6} fill="#fef9c3" />
      <circle cx={85.6} cy={8.8} r={5} className="fill-[#2b2566]" />
      {stars.map((st, i) => (
        <motion.circle
          key={i}
          cx={st.x}
          cy={st.y}
          r={st.r}
          fill="#e0e7ff"
          animate={{ opacity: [0.25, 0.95, 0.25] }}
          transition={{
            duration: 2.6,
            delay: st.d,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </g>
  );
}

function DriftCloud({
  cx,
  cy,
  k,
  dur,
  dx,
}: {
  cx: number;
  cy: number;
  k: number;
  dur: number;
  dx: number;
}) {
  return (
    <motion.g
      className="fill-white/80 dark:fill-white/10"
      animate={{ x: [0, dx, 0] }}
      transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
      pointerEvents="none"
    >
      <ellipse cx={cx} cy={cy} rx={9 * k} ry={2.8 * k} />
      <circle cx={cx - 4 * k} cy={cy - 1.4 * k} r={2.6 * k} />
      <circle cx={cx + 1.5 * k} cy={cy - 2.2 * k} r={3.2 * k} />
      <circle cx={cx + 5.5 * k} cy={cy - 1 * k} r={2.2 * k} />
    </motion.g>
  );
}

/* ---------------- "None match" cloud button ---------------- */

function CloudButton({
  onPress,
  pulseKey,
}: {
  onPress: () => void;
  pulseKey: number;
}) {
  return (
    <div className="flex justify-center">
      <motion.button
        type="button"
        key={pulseKey}
        onPointerDown={onPress}
        whileTap={{ scale: 0.93 }}
        animate={pulseKey > 0 ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={{ duration: 0.3 }}
        data-testid="nomatch"
        aria-label="No balloon matches"
        className="relative h-16 w-full max-w-xs select-none"
      >
        <svg
          viewBox="0 0 220 64"
          className="absolute inset-0 h-full w-full drop-shadow-md"
          preserveAspectRatio="none"
          aria-hidden
          focusable="false"
        >
          <g className="fill-white dark:fill-slate-700">
            <circle cx={46} cy={38} r={20} />
            <circle cx={82} cy={27} r={24} />
            <circle cx={126} cy={25} r={26} />
            <circle cx={168} cy={36} r={20} />
            <rect x={30} y={32} width={158} height={26} rx={13} />
          </g>
          <g className="fill-sky-100 dark:fill-slate-600">
            <circle cx={70} cy={50} r={7} />
            <circle cx={148} cy={51} r={8} />
          </g>
        </svg>
        <span className="relative z-10 text-base font-extrabold text-slate-700 dark:text-slate-100">
          None match
        </span>
      </motion.button>
    </div>
  );
}

/* ---------------- Tutorial demos ---------------- */

const DEMO_T = 3.4; // seconds per demo loop

function DemoFrame({
  rule,
  switchKey = 0,
  children,
  overlay,
}: {
  rule: RuleSpec;
  switchKey?: number;
  children: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
      <BalloonDefs />
      <RuleBanner spec={rule} switchKey={switchKey} />
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-sky-400 via-sky-200 to-sky-50 ring-1 ring-sky-200/80 dark:from-indigo-950 dark:via-indigo-900 dark:to-indigo-800 dark:ring-indigo-900">
        <svg viewBox="0 0 100 58" className="block h-auto w-full">
          <DriftCloud cx={18} cy={9} k={0.6} dur={22} dx={6} />
          <DriftCloud cx={80} cy={14} k={0.45} dur={28} dx={-5} />
          {children}
        </svg>
        {overlay}
      </div>
    </div>
  );
}

/** A statically-placed balloon that idles with the same bob as gameplay. */
function DemoBalloon({
  x,
  y,
  s,
  color,
  shape,
  delay = 0,
}: {
  x: number;
  y: number;
  s: number;
  color: Color;
  shape: Shape;
  delay?: number;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <motion.g
        animate={{ rotate: [-2.5, 2.5, -2.5], x: [-1, 1, -1], y: [0, -1.2, 0] }}
        transition={{ duration: 2.6, delay, repeat: Infinity, ease: "easeInOut" }}
      >
        <BalloonArt s={s} color={color} shape={shape} />
      </motion.g>
    </g>
  );
}

/** Ghost finger that loops toward a target, "taps", then retreats. */
function GhostFinger({
  from,
  to,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
}) {
  return (
    <motion.g
      initial={false}
      animate={{
        x: [from.x, to.x, to.x, to.x, from.x],
        y: [from.y, to.y, to.y, to.y, from.y],
        scale: [1, 1, 0.75, 1, 1],
        opacity: [0, 0.9, 0.9, 0, 0],
      }}
      transition={{
        duration: DEMO_T,
        times: [0, 0.32, 0.42, 0.6, 1],
        repeat: Infinity,
        ease: "easeInOut",
      }}
      pointerEvents="none"
    >
      <circle r={4.2} fill="#ffffff" opacity={0.35} />
      <circle r={2.6} fill="#ffffff" opacity={0.9} />
      <circle r={2.6} fill="none" stroke="#0f172a" strokeOpacity={0.25} strokeWidth={0.5} />
    </motion.g>
  );
}

/** The pop step: a red balloon bursts on loop under a ghost finger. */
function DemoPop() {
  const n = 7;
  const frags = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { dx: Math.cos(a) * 11, dy: Math.sin(a) * 11, rot: (a * 180) / Math.PI + 90 };
  });
  return (
    <DemoFrame rule={{ color: "red" }}>
      <DemoBalloon x={20} y={28} s={7} color="blue" shape="circle" delay={0.3} />
      <DemoBalloon x={81} y={24} s={7} color="yellow" shape="square" delay={0.8} />
      {/* the target — pops mid-loop, then respawns */}
      <g transform="translate(50 27)">
        <motion.g
          animate={{ scale: [1, 1, 1, 0, 0, 1], opacity: [1, 1, 1, 0, 0, 1] }}
          transition={{
            duration: DEMO_T,
            times: [0, 0.4, 0.42, 0.45, 0.93, 1],
            repeat: Infinity,
            ease: "linear",
          }}
        >
          <motion.g
            animate={{ rotate: [-2.5, 2.5, -2.5] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <BalloonArt s={7.6} color="red" shape="triangle" />
          </motion.g>
        </motion.g>
        {frags.map((f, i) => (
          <motion.path
            key={i}
            d={sliverPath(1.9)}
            fill={COLOR_FILL.red}
            animate={{
              x: [0, 0, f.dx, f.dx],
              y: [0, 0, f.dy + 2, f.dy + 2],
              rotate: [f.rot, f.rot, f.rot + 90, f.rot + 90],
              opacity: [0, 0, 1, 0],
              scale: [1, 1, 0.6, 0.5],
            }}
            transition={{
              duration: DEMO_T,
              times: [0, 0.42, 0.58, 0.7],
              repeat: Infinity,
              ease: "easeOut",
            }}
          />
        ))}
        {/* +N ping */}
        <motion.g
          animate={{ y: [0, 0, -8, -12], opacity: [0, 0, 1, 0] }}
          transition={{
            duration: DEMO_T,
            times: [0, 0.44, 0.62, 0.8],
            repeat: Infinity,
            ease: "easeOut",
          }}
        >
          <rect x={-8} y={-12} width={16} height={8} rx={4} fill="#10b981" />
          <text
            x={0}
            y={-7.7}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={4.6}
            fontWeight={900}
            fill="#ffffff"
          >
            +24
          </text>
        </motion.g>
      </g>
      <GhostFinger from={{ x: 68, y: 54 }} to={{ x: 51, y: 30 }} />
    </DemoFrame>
  );
}

/** The switch step: the real banner flips between two rules on a loop. */
function DemoSwitch() {
  const [k, setK] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setK((v) => v + 1), 1600);
    return () => window.clearInterval(id);
  }, []);
  const specs: RuleSpec[] = [{ color: "green" }, { shape: "triangle" }];
  const spec = specs[k % 2];
  const match = spec.color === "green";
  return (
    <DemoFrame rule={spec} switchKey={k}>
      <DemoBalloon x={26} y={28} s={7} color="green" shape="square" delay={0.2} />
      <DemoBalloon x={62} y={24} s={7} color="red" shape="triangle" delay={0.6} />
      {/* arrow hinting which balloon the current rule points at */}
      <motion.path
        d="M 0 0 L 3.2 -5 L -3.2 -5 Z"
        fill="#ffffff"
        stroke="#0f172a"
        strokeOpacity={0.2}
        strokeWidth={0.4}
        animate={{ x: match ? 26 : 62, y: [46, 43, 46] }}
        transition={{
          x: { duration: 0.4, ease: "easeOut" },
          y: { duration: 1.1, repeat: Infinity, ease: "easeInOut" },
        }}
      />
    </DemoFrame>
  );
}

/** The cloud step: nothing matches, so the finger taps the cloud button. */
function DemoCloud() {
  return (
    <DemoFrame
      rule={{ color: "red" }}
      overlay={
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center">
          <motion.div
            animate={{ scale: [1, 1, 1.1, 1, 1] }}
            transition={{
              duration: DEMO_T,
              times: [0, 0.4, 0.48, 0.56, 1],
              repeat: Infinity,
            }}
            className="relative h-12 w-40"
          >
            <svg
              viewBox="0 0 220 64"
              className="absolute inset-0 h-full w-full drop-shadow"
              preserveAspectRatio="none"
              aria-hidden
            >
              <g className="fill-white dark:fill-slate-700">
                <circle cx={46} cy={38} r={20} />
                <circle cx={82} cy={27} r={24} />
                <circle cx={126} cy={25} r={26} />
                <circle cx={168} cy={36} r={20} />
                <rect x={30} y={32} width={158} height={26} rx={13} />
              </g>
            </svg>
            <span className="absolute inset-0 z-10 grid place-items-center text-sm font-extrabold text-slate-700 dark:text-slate-100">
              None match
            </span>
          </motion.div>
        </div>
      }
    >
      <DemoBalloon x={20} y={24} s={6.6} color="blue" shape="circle" delay={0.1} />
      <DemoBalloon x={50} y={20} s={6.6} color="green" shape="triangle" delay={0.5} />
      <DemoBalloon x={80} y={25} s={6.6} color="yellow" shape="square" delay={0.9} />
      {/* +N ping over the cloud area */}
      <motion.g
        transform="translate(50 46)"
        animate={{ y: [0, 0, -7, -10], opacity: [0, 0, 1, 0] }}
        transition={{
          duration: DEMO_T,
          times: [0, 0.48, 0.66, 0.84],
          repeat: Infinity,
          ease: "easeOut",
        }}
      >
        <rect x={-7} y={-4} width={14} height={8} rx={4} fill="#10b981" />
        <text
          x={0}
          y={0.3}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={4.6}
          fontWeight={900}
          fill="#ffffff"
        >
          +8
        </text>
      </motion.g>
      <GhostFinger from={{ x: 78, y: 40 }} to={{ x: 50, y: 52 }} />
    </DemoFrame>
  );
}

/** The final step: previews conjunction rules (size matters) and the combo. */
function DemoCombo() {
  return (
    <DemoFrame
      rule={{ color: "red", shape: "triangle", size: "big" }}
      overlay={
        <div className="pointer-events-none absolute right-2 top-2">
          <motion.span
            animate={{ scale: [1, 1.12, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800"
          >
            <FlameIcon /> x5 · 12
          </motion.span>
        </div>
      }
    >
      {/* near-misses: right colour+shape but small; big+red but wrong shape */}
      <DemoBalloon x={22} y={30} s={5.2} color="red" shape="triangle" delay={0.2} />
      <DemoBalloon x={52} y={24} s={7.8} color="red" shape="triangle" delay={0.6} />
      <DemoBalloon x={82} y={29} s={7.8} color="red" shape="circle" delay={1.0} />
      {/* halo around the true match */}
      <motion.circle
        cx={52}
        cy={22}
        r={12}
        fill="none"
        stroke="#ffffff"
        strokeWidth={0.8}
        strokeDasharray="2.4 1.8"
        animate={{ opacity: [0.25, 0.9, 0.25], scale: [0.96, 1.04, 0.96] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "52px 22px" }}
      />
    </DemoFrame>
  );
}

function DemoSky({ mode }: { mode: "pop" | "switch" | "cloud" | "combo" }) {
  if (mode === "pop") return <DemoPop />;
  if (mode === "switch") return <DemoSwitch />;
  if (mode === "cloud") return <DemoCloud />;
  return <DemoCombo />;
}

/* ---------------- Icons ---------------- */

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

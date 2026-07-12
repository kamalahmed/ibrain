import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { LevelComplete } from "@/components/LevelComplete";
import { GameHUD } from "@/components/GameHUD";
import { getGame } from "@/lib/games";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { useStore } from "@/store/useStore";

/**
 * Stroop Test — Paint Studio.
 * The classic ink-vs-word conflict staged in an artist's studio: the stimulus
 * sits on a paint-can label in front of an easel, answers are four paint
 * splats, and every correct answer flings paint onto the canvas — which
 * visibly fills up over the 3-minute session. Wrong answers splodge onto the
 * floor. Mechanics, level structure and scoring are unchanged from the
 * previous build (anchor ≈ 3000 pts).
 */

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

type Color = "red" | "green" | "blue" | "yellow";

type LevelMode =
  | "swatchOnly" // L1: colour swatch on the can label, no word
  | "wordNeutral" // L2: word in neutral ink — tap what it SAYS
  | "congruent" // word ink matches meaning (tutorial only)
  | "incongruent" // L3: word ink never matches meaning — tap the INK
  | "mixed"; // L4: incongruent word + per-trial rule flip

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
  id: 1 | 2 | 3 | 4;
  name: string;
  /** The one new mechanic this level introduces — shown as the "up next" label. */
  twist: string;
  mode: LevelMode;
  trialCount: number;
  requiredCorrect: number;
  startWindowMs: number;
  endWindowMs: number;
};

const COLORS: Color[] = ["red", "green", "blue", "yellow"];

const COLOR_HEX: Record<Color, string> = {
  red: "#ef4444",
  green: "#10b981",
  blue: "#3b82f6",
  yellow: "#eab308",
};

const COLOR_DARK: Record<Color, string> = {
  red: "#b91c1c",
  green: "#047857",
  blue: "#1e40af",
  yellow: "#a16207",
};

const COLOR_LABEL: Record<Color, string> = {
  red: "RED",
  green: "GREEN",
  blue: "BLUE",
  yellow: "YELLOW",
};

const SESSION_SECONDS = 180; // 3-minute session
const INTER_STIMULUS_MS = 300;
const LEVEL_CLEAR_BONUS = 50;
const FALSE_ALARM_PENALTY = -5;
const PING_LIFE_MS = 950;
const FLY_MS = 650; // canvas splat flight (render swaps to static after)
const FLOOR_FLY_MS = 550; // floor splodge fall
const MAX_CANVAS_SPLATS = 130;
const MAX_FLOOR_SPLATS = 26;

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Swatch warm-up",
    twist: "Match the paint colour",
    mode: "swatchOnly",
    trialCount: 20,
    requiredCorrect: 15,
    startWindowMs: 2000,
    endWindowMs: 1600,
  },
  {
    id: 2,
    name: "Word labels",
    twist: "Words appear — tap what they SAY",
    mode: "wordNeutral",
    trialCount: 22,
    requiredCorrect: 16,
    startWindowMs: 1900,
    endWindowMs: 1500,
  },
  {
    id: 3,
    name: "Ink conflict",
    twist: "The ink fights the word — tap the INK",
    mode: "incongruent",
    trialCount: 26,
    requiredCorrect: 19,
    startWindowMs: 2000,
    endWindowMs: 1500,
  },
  {
    id: 4,
    name: "Rule flip",
    twist: "The rule flips can to can — watch the banner",
    mode: "mixed",
    trialCount: 30,
    requiredCorrect: 21,
    startWindowMs: 1800,
    endWindowMs: 1300,
  },
];

/* ---------------- Trial generator (unchanged mechanics) ---------------- */

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
      return { word: pick(COLORS), ink: "red", respondTo: "word", windowMs };
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

function scoreForHit(ms: number): number {
  return Math.max(20, Math.round((900 - ms) / 4));
}

/* ---------------- Scene geometry + deterministic splat art ---------------- */

const CANVAS_R = { x: 27, y: 7, w: 46, h: 36 }; // the easel canvas rect
/** Horizontal centres of the 4 answer buttons, as scene x-coords. */
const BTN_X = [12.5, 37.5, 62.5, 87.5];
/** Splat-button centres inside the tutorial demos' extended viewBox. */
const BTN_DEMO_X = [14, 38, 62, 86];

/** Framer sets style-transforms; pin the origin to the viewBox origin so
 *  translate/scale/rotate compose predictably in SVG user units. */
const ORIGIN0: CSSProperties = {
  transformOrigin: "0px 0px",
  transformBox: "view-box",
};

/** Deterministic PRNG so splat shapes are stable module-scope art (SSR-safe —
 *  no Math.random at module scope). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An irregular paint-splat blob: spiky ring smoothed with quadratics. */
function makeSplatPath(rng: () => number, r: number): string {
  const n = 12;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = r * (i % 2 === 0 ? 0.52 + rng() * 0.22 : 0.9 + rng() * 0.5);
    pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  const mid = (p: [number, number], q: [number, number]): [number, number] => [
    (p[0] + q[0]) / 2,
    (p[1] + q[1]) / 2,
  ];
  const f = (v: number) => v.toFixed(2);
  const m0 = mid(pts[0], pts[1]);
  let d = `M ${f(m0[0])} ${f(m0[1])} `;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    const m = mid(pts[i % n], pts[(i + 1) % n]);
    d += `Q ${f(p[0])} ${f(p[1])} ${f(m[0])} ${f(m[1])} `;
  }
  return d + "Z";
}

const SPLAT_PATHS: string[] = [];
const SPLAT_DROPS: Array<Array<[number, number, number]>> = [];
for (let s = 0; s < 4; s++) {
  const rng = mulberry32(101 + s * 37);
  SPLAT_PATHS.push(makeSplatPath(rng, 10));
  const drops: Array<[number, number, number]> = [];
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    const dist = 11 + rng() * 3.5;
    drops.push([Math.cos(a) * dist, Math.sin(a) * dist, 0.8 + rng() * 0.9]);
  }
  SPLAT_DROPS.push(drops);
}

type CanvasSplat = {
  id: number;
  x: number;
  y: number;
  size: number;
  rot: number;
  color: Color;
  shape: number;
  born: number; // performance.now() when thrown; 0 = pre-settled (demos)
  fromX: number;
  fromY: number;
};

type FloorSplat = {
  id: number;
  x: number;
  y: number;
  size: number;
  rot: number;
  color: Color;
  shape: number;
  born: number;
  fromX: number;
};

type Ping = {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: "ok" | "bad" | "warn";
  born: number;
};

type Stimulus =
  | { kind: "swatch"; ink: Color }
  | { kind: "word"; word: string; ink: Color | null };

/** Pre-painted canvas for the final tutorial step (deterministic). */
const GOAL_SPLATS: CanvasSplat[] = (() => {
  const rng = mulberry32(2024);
  return Array.from({ length: 18 }, (_, i) => ({
    id: i + 1,
    x: CANVAS_R.x + 5 + rng() * (CANVAS_R.w - 10),
    y: CANVAS_R.y + 5 + rng() * (CANVAS_R.h - 10),
    size: 3.4 + rng() * 2.8,
    rot: rng() * 360,
    color: COLORS[i % 4],
    shape: i % 4,
    born: 0,
    fromX: 0,
    fromY: 0,
  }));
})();

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
  const [streak, setStreak] = useState(0);

  // Paint studio scene state — canvas fills up over the whole session.
  const [canvasSplats, setCanvasSplats] = useState<CanvasSplat[]>([]);
  const [floorSplats, setFloorSplats] = useState<FloorSplat[]>([]);
  const [pings, setPings] = useState<Ping[]>([]);
  const [canShake, setCanShake] = useState(0);

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
  const advanceTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const startAtRef = useRef(0);
  const respondedRef = useRef(false);
  const endedRef = useRef(false);
  const trialRef = useRef<Trial | null>(null);
  const streakRef = useRef(0);
  const bestStreakRef = useRef(0);
  const pingsRef = useRef<Ping[]>([]);
  const splatIdRef = useRef(0);
  const prevRespondRef = useRef<RespondTo | null>(null);

  const currentLevel = LEVELS[levelIdx];

  const clearTimers = () => {
    for (const ref of [
      responseTimerRef,
      interStimulusTimerRef,
      advanceTimerRef,
      feedbackTimerRef,
    ]) {
      if (ref.current !== null) {
        window.clearTimeout(ref.current);
        ref.current = null;
      }
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

  const addPing = (x: number, y: number, text: string, tone: Ping["tone"]) => {
    const now = performance.now();
    const ping: Ping = { id: ++splatIdRef.current, x, y, text, tone, born: now };
    pingsRef.current = [
      ...pingsRef.current.filter((p) => now - p.born < PING_LIFE_MS),
      ping,
    ];
    setPings(pingsRef.current);
  };

  const addCanvasSplat = (color: Color, fromX: number) => {
    const x = CANVAS_R.x + 5 + Math.random() * (CANVAS_R.w - 10);
    const y = CANVAS_R.y + 5 + Math.random() * (CANVAS_R.h - 10);
    const splat: CanvasSplat = {
      id: ++splatIdRef.current,
      x,
      y,
      size: 3.4 + Math.random() * 2.8,
      rot: Math.random() * 360,
      color,
      shape: Math.floor(Math.random() * 4),
      born: performance.now(),
      fromX,
      fromY: 84,
    };
    setCanvasSplats((prev) => [...prev.slice(-(MAX_CANVAS_SPLATS - 1)), splat]);
    return { x, y };
  };

  const addFloorSplat = (color: Color, fromX: number) => {
    const jitter = (Math.random() - 0.5) * 14;
    const x = Math.max(9, Math.min(91, fromX + jitter));
    const splat: FloorSplat = {
      id: ++splatIdRef.current,
      x,
      y: 70.5 + Math.random() * 5.5,
      size: 3 + Math.random() * 2,
      rot: Math.random() * 360,
      color,
      shape: Math.floor(Math.random() * 4),
      born: performance.now(),
      fromX,
    };
    setFloorSplats((prev) => [...prev.slice(-(MAX_FLOOR_SPLATS - 1)), splat]);
  };

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
      streakRef.current += 1;
      bestStreakRef.current = Math.max(bestStreakRef.current, streakRef.current);
    } else {
      streakRef.current = 0;
      if (result.kind === "wrong") setFalseAlarms((n) => n + 1);
    }
    setStreak(streakRef.current);
    setLastResult(result);
    if (feedbackTimerRef.current !== null)
      window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(
      () => setLastResult(null),
      INTER_STIMULUS_MS + 260
    );
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
          advanceTimerRef.current = window.setTimeout(() => end(true), 1100);
        } else {
          advanceTimerRef.current = window.setTimeout(
            () => startLevel(nextIdx),
            1100
          );
        }
      } else {
        end(false);
      }
      return;
    }
    const t = buildTrial(lvl, i);
    // A rule flip on the mixed level gets a haptic nudge so it never sneaks by.
    if (lvl.mode === "mixed" && prevRespondRef.current !== null &&
        prevRespondRef.current !== t.respondTo) {
      haptic.tap();
    }
    prevRespondRef.current = t.respondTo;
    trialRef.current = t;
    respondedRef.current = false;
    setTrial(t);
    startAtRef.current = performance.now();

    responseTimerRef.current = window.setTimeout(() => {
      if (respondedRef.current || endedRef.current) return;
      evaluate({ kind: "miss", pts: 0 });
      addPing(50, 47, "too slow", "warn");
      trialIdxRef.current += 1;
      setTrialIdx(trialIdxRef.current);
      trialRef.current = null;
      setTrial(null);
      interStimulusTimerRef.current = window.setTimeout(
        armNext,
        INTER_STIMULUS_MS
      );
    }, t.windowMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      prevRespondRef.current = null;
      setTrial(null);
      setPhase("playing");
      clearTimers();
      interStimulusTimerRef.current = window.setTimeout(armNext, 500);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [armNext]
  );

  const handleTap = (choice: Color, btnIdx: number) => {
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
    const fromX = BTN_X[btnIdx];
    if (choice === answer) {
      haptic.success();
      const pts = scoreForHit(ms);
      const target = addCanvasSplat(choice, fromX);
      addPing(target.x, Math.max(11, target.y - 5), `+${pts}`, "ok");
      evaluate({ kind: "hit", ms, pts });
    } else {
      haptic.error();
      setCanShake((n) => n + 1);
      addFloorSplat(choice, fromX);
      addPing(50, 47, `${FALSE_ALARM_PENALTY}`, "bad");
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
      // prune expired score pings while we're here (no extra timer needed)
      if (pingsRef.current.length > 0) {
        const now = performance.now();
        const kept = pingsRef.current.filter(
          (p) => now - p.born < PING_LIFE_MS
        );
        if (kept.length !== pingsRef.current.length) {
          pingsRef.current = kept;
          setPings(kept);
        }
      }
      if (left <= 0) end(false);
    }, 200);
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
    setCanvasSplats([]);
    setFloorSplats([]);
    pingsRef.current = [];
    setPings([]);
    setCanShake(0);
    streakRef.current = 0;
    bestStreakRef.current = 0;
    setStreak(0);
    prevRespondRef.current = null;
    endedRef.current = false;
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  /* ---------------- Tutorial (auto-playing animated demos) ---------------- */

  const tutorialSteps: TutorialStep[] = [
    {
      caption:
        "The paint can names a colour. Tap the matching splat to throw paint on the canvas.",
      stage: (
        <DemoTrialStage
          idPrefix="demoA"
          word="GREEN"
          ink="green"
          answerIdx={1}
          pts={64}
        />
      ),
      auto: 4200,
    },
    {
      caption:
        "Tricky can! The word says RED but the ink is BLUE. Tap the ink — blue.",
      stage: (
        <DemoTrialStage
          idPrefix="demoB"
          word="RED"
          ink="blue"
          answerIdx={2}
          trapIdx={0}
          pts={58}
        />
      ),
      auto: 4600,
    },
    {
      caption:
        "Level 4 flips the rule: brush = tap the INK, bubble = tap what the word SAYS.",
      stage: <DemoFlipStage />,
      auto: 5600,
    },
    {
      caption:
        "Fast answers score more. Fill your canvas before the timer runs out!",
      stage: <DemoGoalStage />,
    },
  ];

  /* ---------------- Render ---------------- */

  const sceneRing =
    lastResult?.kind === "hit"
      ? "ring-2 ring-emerald-400"
      : lastResult?.kind === "wrong"
      ? "ring-2 ring-rose-400"
      : lastResult?.kind === "miss"
      ? "ring-2 ring-amber-400"
      : "ring-1 ring-amber-900/15 dark:ring-slate-700";

  const stimulus: Stimulus | null = trial
    ? currentLevel.mode === "swatchOnly"
      ? { kind: "swatch", ink: trial.ink }
      : {
          kind: "word",
          word: COLOR_LABEL[trial.word ?? trial.ink],
          ink: currentLevel.mode === "wordNeutral" ? null : trial.ink,
        }
    : null;

  const stimulusProps = trial
    ? {
        "data-testid": "stimulus",
        "data-ink": trial.ink,
        "data-word": trial.word ?? "",
        "data-respond-to": trial.respondTo,
        "data-answer": correctAnswer(trial),
      }
    : undefined;

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four levels in one 3-minute session, painted one can at a time.
          Levels 1–2 warm up with colour swatches and plain words. Level 3 is
          the classic Stroop conflict — the word fights the ink, and the INK
          wins. Level 4 flips the rule can to can: brush means ink, speech
          bubble means word. Every correct tap splats paint onto your canvas.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startSession} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-3">
          <GameHUD
            levelTotal={LEVELS.length}
            levelCurrent={levelIdx + 1}
            levelsCleared={clearedRef.current}
            score={score}
            timeLeft={timeLeft}
            sessionSeconds={SESSION_SECONDS}
            extra={
              streak >= 3 ? (
                <span className="chip" data-testid="streak">
                  🔥 {streak}
                </span>
              ) : undefined
            }
          />

          <div className="mx-auto w-full max-w-lg space-y-2">
            <RuleBanner level={currentLevel} trial={trial} />

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
                nextLabel={LEVELS[lastCleared]?.twist}
              />
            ) : (
              <div data-testid="stage" className="no-select space-y-2">
                <StudioScene
                  idPrefix="studio"
                  stimulus={stimulus}
                  stimulusProps={stimulusProps}
                  popKey={`${levelIdx}-${trialIdx}`}
                  canvasSplats={canvasSplats}
                  floorSplats={floorSplats}
                  pings={pings}
                  shake={canShake}
                  className={sceneRing}
                />
                <div className="grid grid-cols-4 gap-2">
                  {COLORS.map((c, i) => (
                    <SplatButton key={c} color={c} index={i} onTap={handleTap} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${totalHits} splats on canvas · ${falseAlarms} on the floor · best streak ${bestStreakRef.current}`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Rule banner ---------------- */

function levelRespond(level: Level): RespondTo {
  return level.mode === "wordNeutral" ? "word" : "ink";
}

function RuleBanner({ level, trial }: { level: Level; trial: Trial | null }) {
  const mixed = level.mode === "mixed";
  const respondTo: RespondTo | null = trial
    ? trial.respondTo
    : mixed
    ? null
    : levelRespond(level);
  const label =
    respondTo === null
      ? "Watch the rule…"
      : respondTo === "word"
      ? "Tap what the word SAYS"
      : level.mode === "swatchOnly"
      ? "Tap the paint COLOUR"
      : "Tap the INK colour";
  const cls =
    respondTo === null
      ? "from-slate-500 to-slate-600"
      : respondTo === "word"
      ? "from-sky-500 to-indigo-500"
      : "from-violet-500 to-fuchsia-500";
  return (
    <div
      data-testid="rule"
      data-rule={respondTo ?? "wait"}
      className="relative"
      style={{ perspective: 600 }}
    >
      <div className="grid">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={respondTo ?? "wait"}
            initial={{ rotateX: -90, opacity: 0, scale: 0.92 }}
            animate={{ rotateX: 0, opacity: 1, scale: 1 }}
            exit={{ rotateX: 90, opacity: 0, scale: 0.92 }}
            transition={spring.snappy}
            className={`col-start-1 row-start-1 flex min-h-[3.25rem] w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r ${cls} px-4 py-2 text-white shadow-soft`}
          >
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/25"
            >
              {respondTo === "word" ? (
                <BubbleIcon className="h-5 w-5" />
              ) : respondTo === "ink" ? (
                <BrushIcon className="h-5 w-5" />
              ) : (
                <span className="text-sm font-black">?</span>
              )}
            </span>
            <span className="text-lg font-black leading-tight sm:text-xl">
              {label}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>
      {mixed && (
        <span className="absolute -top-1.5 right-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-950 shadow">
          flips!
        </span>
      )}
    </div>
  );
}

function BrushIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.7 3.3a2 2 0 0 0-2.8 0L9.6 11.6l2.8 2.8 8.3-8.3a2 2 0 0 0 0-2.8z" />
      <path d="M8.6 12.8c-1.9.2-3.4 1.7-3.6 3.6-.1 1.3-.7 2.3-1.7 3 1.2.6 2.6 1 3.7.9a4.5 4.5 0 0 0 4.2-4.7l-2.6-2.8z" />
    </svg>
  );
}

function BubbleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 3c-5 0-9 3.2-9 7.2 0 2.3 1.3 4.3 3.4 5.6-.1 1-.5 2.1-1.4 3.2 1.7-.2 3.1-.8 4.1-1.5.9.2 1.9.4 2.9.4 5 0 9-3.2 9-7.2S17 3 12 3z" />
    </svg>
  );
}

/* ---------------- Splat art ---------------- */

function SplatShape({
  color,
  shape,
  size,
}: {
  color: Color;
  shape: number;
  size: number;
}) {
  const k = size / 10;
  const idx = ((shape % 4) + 4) % 4;
  return (
    <g transform={`scale(${k})`}>
      <path
        d={SPLAT_PATHS[idx]}
        fill={COLOR_HEX[color]}
        stroke={COLOR_DARK[color]}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {SPLAT_DROPS[idx].map((d, i) => (
        <circle key={i} cx={d[0]} cy={d[1]} r={d[2]} fill={COLOR_HEX[color]} />
      ))}
      <path
        d={SPLAT_PATHS[idx]}
        fill="#ffffff"
        opacity={0.16}
        transform="translate(-1.1 -1.3) scale(0.55)"
      />
    </g>
  );
}

function SplatButton({
  color,
  index,
  onTap,
}: {
  color: Color;
  index: number;
  onTap: (c: Color, i: number) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Choose ${color}`}
      data-testid="choice"
      data-choice-color={color}
      onPointerDown={() => onTap(color, index)}
      // Keyboard activation only (detail === 0); pointer taps already fired
      // on pointerdown for sub-100ms feedback and must not double-submit.
      onClick={(e) => {
        if (e.detail === 0) onTap(color, index);
      }}
      className="flex min-h-[76px] touch-manipulation flex-col items-center justify-center gap-0.5 rounded-2xl bg-white/90 py-1.5 shadow-soft ring-1 ring-slate-200 transition-transform duration-75 active:scale-90 dark:bg-slate-800/90 dark:ring-slate-700"
    >
      <svg viewBox="-15 -15 30 30" className="h-12 w-12 sm:h-14 sm:w-14" aria-hidden>
        <SplatShape color={color} shape={index} size={10} />
      </svg>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {color}
      </span>
    </button>
  );
}

/* ---------------- The studio scene ---------------- */

function StudioDefs({ idPrefix }: { idPrefix: string }) {
  return (
    <defs>
      <linearGradient id={`${idPrefix}Wall`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fdf3e2" />
        <stop offset="100%" stopColor="#f3dcb6" />
      </linearGradient>
      <linearGradient id={`${idPrefix}Floor`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#d2a26c" />
        <stop offset="100%" stopColor="#9c6b3d" />
      </linearGradient>
      <linearGradient id={`${idPrefix}CanvasG`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#f1ebdd" />
      </linearGradient>
      <linearGradient id={`${idPrefix}Can`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#a7adb9" />
        <stop offset="35%" stopColor="#eef1f5" />
        <stop offset="100%" stopColor="#8f96a3" />
      </linearGradient>
      <radialGradient id={`${idPrefix}Glow`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%" stopColor="#fff6da" stopOpacity="0.9" />
        <stop offset="100%" stopColor="#fff6da" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${idPrefix}Vig`} cx="0.5" cy="0.45" r="0.8">
        <stop offset="62%" stopColor="#4a2f12" stopOpacity="0" />
        <stop offset="100%" stopColor="#4a2f12" stopOpacity="0.34" />
      </radialGradient>
      <clipPath id={`${idPrefix}CanvasClip`}>
        <rect
          x={CANVAS_R.x + 0.8}
          y={CANVAS_R.y + 0.8}
          width={CANVAS_R.w - 1.6}
          height={CANVAS_R.h - 1.6}
          rx={0.6}
        />
      </clipPath>
    </defs>
  );
}

function StudioBackdrop({ idPrefix, vbH }: { idPrefix: string; vbH: number }) {
  const plankYs = [63.5, 69, 75.5, 83, 90].filter((y) => y < vbH - 1);
  return (
    <g>
      {/* wall + floor */}
      <rect width="100" height="58" fill={`url(#${idPrefix}Wall)`} />
      <rect y="58" width="100" height={vbH - 58} fill={`url(#${idPrefix}Floor)`} />
      {/* drifting warm window light on the wall — idle motion */}
      <motion.ellipse
        cx={30}
        cy={20}
        rx={26}
        ry={14}
        fill={`url(#${idPrefix}Glow)`}
        initial={false}
        animate={{ x: [0, 9, 0], opacity: [0.3, 0.55, 0.3] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        style={ORIGIN0}
        pointerEvents="none"
      />
      {/* floorboards */}
      <g stroke="#7c4f24" strokeWidth="0.35" opacity="0.28">
        {plankYs.map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} />
        ))}
        <line x1="22" y1="59" x2="20" y2={vbH} />
        <line x1="50" y1="59" x2="50" y2={vbH} />
        <line x1="78" y1="59" x2="80" y2={vbH} />
      </g>
      {/* baseboard */}
      <rect y="56" width="100" height="2.2" fill="#ecd3a4" />
      <line x1="0" y1="58.2" x2="100" y2="58.2" stroke="#c9a568" strokeWidth="0.4" />
      {/* framed sketch on the wall */}
      <g>
        <rect x="6" y="11" width="14" height="11" rx="0.8" fill="#fffdf6" stroke="#b07a45" strokeWidth="1" />
        <circle cx="10.5" cy="14.5" r="1.6" fill="#f2c14e" />
        <path d="M7.5 20.5 Q 11 15.5 14 19 Q 16 16.5 18.5 20.5 Z" fill="#7aa66a" />
      </g>
      {/* hanging palette */}
      <motion.g
        initial={false}
        animate={{ rotate: [-3, 3, -3] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "89px 9px", transformBox: "view-box" } as CSSProperties}
      >
        <line x1="89" y1="9" x2="89" y2="13" stroke="#8a5c33" strokeWidth="0.5" />
        <ellipse cx="89" cy="18" rx="6.4" ry="4.8" fill="#d9a05b" stroke="#a4682b" strokeWidth="0.5" />
        <circle cx="91.6" cy="19.5" r="1.2" fill="#f6e7cd" />
        <circle cx="86.6" cy="16.4" r="1" fill={COLOR_HEX.red} />
        <circle cx="89.4" cy="15.7" r="1" fill={COLOR_HEX.blue} />
        <circle cx="87" cy="19.2" r="1" fill={COLOR_HEX.yellow} />
      </motion.g>
      {/* drop cloth under the easel, with old faded stains */}
      <ellipse cx="50" cy="70" rx="34" ry="6.8" fill="#efe4cc" opacity="0.9" />
      <g opacity="0.3">
        <ellipse cx="38" cy="69.5" rx="2.4" ry="1.1" fill="#c05e5e" />
        <ellipse cx="58" cy="72.5" rx="2" ry="0.9" fill="#5d7fc4" />
        <ellipse cx="46" cy="73.5" rx="1.6" ry="0.8" fill="#7aa66a" />
        <ellipse cx="63" cy="68.8" rx="1.4" ry="0.7" fill="#c9a83f" />
      </g>
      {/* jar of brushes */}
      <g>
        <line x1="10.5" y1="62.5" x2="9.4" y2="53.5" stroke="#b07a45" strokeWidth="1" strokeLinecap="round" />
        <circle cx="9.4" cy="53" r="1" fill={COLOR_HEX.red} />
        <line x1="13" y1="62.5" x2="13" y2="51.8" stroke="#a4682b" strokeWidth="1" strokeLinecap="round" />
        <circle cx="13" cy="51.4" r="1" fill={COLOR_HEX.blue} />
        <line x1="15.5" y1="62.5" x2="16.8" y2="54" stroke="#b07a45" strokeWidth="1" strokeLinecap="round" />
        <circle cx="16.9" cy="53.5" r="1" fill={COLOR_HEX.green} />
        <rect x="8.5" y="61.5" width="9" height="8.5" rx="1" fill="#dbe7f0" opacity="0.78" stroke="#9db2c0" strokeWidth="0.4" />
      </g>
    </g>
  );
}

function PaintCan({
  stimulus,
  stimulusProps,
  popKey,
  shake,
  idPrefix,
}: {
  stimulus: Stimulus | null;
  stimulusProps?: Record<string, string>;
  popKey?: string | number;
  shake: number;
  idPrefix: string;
}) {
  const wordSize = (w: string) => (w.length >= 6 ? 5.8 : w.length === 5 ? 6.6 : 7.6);
  return (
    <motion.g
      key={`shake-${shake}`}
      style={ORIGIN0}
      initial={false}
      animate={shake > 0 ? { x: [0, -2.4, 2.4, -1.4, 1.4, 0] } : { x: 0 }}
      transition={{ duration: 0.35, ease: "easeInOut" }}
    >
      {/* cast shadow */}
      <ellipse cx="50" cy="71.2" rx="17.5" ry="2.4" fill="#3a2506" opacity="0.18" />
      {/* wire handle */}
      <path d="M32 50.5 Q 50 40 68 50.5" fill="none" stroke="#6b7280" strokeWidth="1.1" strokeLinecap="round" />
      {/* body */}
      <rect x="31" y="50.5" width="38" height="20.5" rx="2" fill={`url(#${idPrefix}Can)`} stroke="#798090" strokeWidth="0.5" />
      {/* rim */}
      <ellipse cx="50" cy="50.8" rx="19" ry="3.1" fill="#d8dce3" stroke="#838a97" strokeWidth="0.5" />
      <ellipse cx="50" cy="50.8" rx="15.8" ry="2.3" fill="#eef0f4" />
      {/* paint drips down the side */}
      <rect x="34" y="52.8" width="1.7" height="4.6" rx="0.85" fill={COLOR_HEX.red} opacity="0.9" />
      <rect x="64.2" y="52.4" width="1.7" height="3.6" rx="0.85" fill={COLOR_HEX.blue} opacity="0.9" />
      {/* label */}
      <rect x="34" y="55.5" width="32" height="13" rx="1.6" fill="#fffdf6" stroke="#d9cdb2" strokeWidth="0.5" />
      <text
        x="50"
        y="57.7"
        textAnchor="middle"
        fontSize="1.9"
        fontWeight={600}
        letterSpacing="0.35"
        fill="#a39c8b"
      >
        iBRAIN PAINT CO.
      </text>
      <line x1="36" y1="58.8" x2="64" y2="58.8" stroke="#e7ddc6" strokeWidth="0.35" />
      {stimulus ? (
        <motion.g
          key={popKey}
          {...(stimulusProps ?? {})}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={spring.snappy}
          style={
            {
              transformOrigin: "50px 62.6px",
              transformBox: "view-box",
            } as CSSProperties
          }
        >
          {stimulus.kind === "swatch" ? (
            <g>
              <rect
                x="40"
                y="58.8"
                width="20"
                height="7.6"
                rx="1.6"
                fill={COLOR_HEX[stimulus.ink]}
                stroke={COLOR_DARK[stimulus.ink]}
                strokeWidth="0.5"
              />
              <rect x="41.5" y="59.8" width="7" height="2" rx="1" fill="#ffffff" opacity="0.35" />
            </g>
          ) : (
            <text
              x="50"
              y="62.9"
              textAnchor="middle"
              dominantBaseline="central"
              fontWeight={900}
              fontSize={wordSize(stimulus.word)}
              letterSpacing="0.2"
              fill={stimulus.ink ? COLOR_HEX[stimulus.ink] : "#3f4a5a"}
            >
              {stimulus.word}
            </text>
          )}
        </motion.g>
      ) : (
        <motion.circle
          cx="50"
          cy="62.6"
          r="1.2"
          fill="#d8cdb4"
          initial={false}
          animate={{ opacity: [0.3, 0.85, 0.3] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </motion.g>
  );
}

function CanvasSplatSettled({ s }: { s: CanvasSplat }) {
  return (
    <g transform={`translate(${s.x} ${s.y}) rotate(${s.rot})`}>
      <SplatShape color={s.color} shape={s.shape} size={s.size} />
    </g>
  );
}

function CanvasSplatFlying({ s }: { s: CanvasSplat }) {
  return (
    <motion.g
      style={ORIGIN0}
      initial={{ x: s.fromX, y: s.fromY, scale: 0.3, rotate: s.rot - 150, opacity: 0.9 }}
      animate={{ x: s.x, y: s.y, scale: 1, rotate: s.rot, opacity: 1 }}
      transition={{ duration: 0.42, ease: [0.22, 0.9, 0.32, 1] }}
      pointerEvents="none"
    >
      <SplatShape color={s.color} shape={s.shape} size={s.size} />
    </motion.g>
  );
}

function FloorSplatSettled({ s }: { s: FloorSplat }) {
  return (
    <g transform={`translate(${s.x} ${s.y}) scale(1 0.4)`}>
      <g transform={`rotate(${s.rot})`}>
        <SplatShape color={s.color} shape={s.shape} size={s.size} />
      </g>
    </g>
  );
}

function FloorSplatFlying({ s }: { s: FloorSplat }) {
  return (
    <motion.g
      style={ORIGIN0}
      initial={{ x: s.fromX, y: s.y - 26, opacity: 0.95, scaleY: 1 }}
      animate={{ x: s.x, y: s.y, opacity: 1, scaleY: 0.4 }}
      transition={{ duration: 0.38, ease: "easeIn" }}
      pointerEvents="none"
    >
      <g transform={`rotate(${s.rot})`}>
        <SplatShape color={s.color} shape={s.shape} size={s.size} />
      </g>
    </motion.g>
  );
}

function PingGlyph({ ping }: { ping: Ping }) {
  const w = 7 + ping.text.length * 3.1;
  const [bg, edge] =
    ping.tone === "ok"
      ? ["#10b981", "#047857"]
      : ping.tone === "bad"
      ? ["#f43f5e", "#be123c"]
      : ["#f59e0b", "#b45309"];
  return (
    <g transform={`translate(${ping.x} ${ping.y})`} pointerEvents="none">
      <motion.g
        style={ORIGIN0}
        initial={{ y: 3, scale: 0.5, opacity: 0 }}
        animate={{ y: -9, scale: 1, opacity: [0, 1, 1, 0] }}
        transition={{ duration: 0.9, times: [0, 0.15, 0.62, 1], ease: "easeOut" }}
      >
        <rect x={-w / 2} y={-4} width={w} height={8} rx={4} fill={bg} stroke={edge} strokeWidth={0.4} />
        <text
          x={0}
          y={0.2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={4.3}
          fontWeight={900}
          fill="#ffffff"
        >
          {ping.text}
        </text>
      </motion.g>
    </g>
  );
}

function StudioScene({
  idPrefix,
  vbH = 80,
  stimulus,
  stimulusProps,
  popKey,
  canvasSplats,
  floorSplats,
  pings,
  shake = 0,
  className = "",
  children,
}: {
  idPrefix: string;
  vbH?: number;
  stimulus: Stimulus | null;
  stimulusProps?: Record<string, string>;
  popKey?: string | number;
  canvasSplats: CanvasSplat[];
  floorSplats: FloorSplat[];
  pings: Ping[];
  shake?: number;
  className?: string;
  children?: ReactNode;
}) {
  // The scene never renders during the SSR'd intro phase, but guard anyway.
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  const settled = canvasSplats.filter((s) => now - s.born >= FLY_MS);
  const flying = canvasSplats.filter((s) => now - s.born < FLY_MS);
  const floorSettled = floorSplats.filter((s) => now - s.born >= FLOOR_FLY_MS);
  const floorFlying = floorSplats.filter((s) => now - s.born < FLOOR_FLY_MS);
  return (
    <div
      className={
        "relative mx-auto w-full overflow-hidden rounded-3xl shadow-soft transition-all duration-150 " +
        className
      }
      style={{ aspectRatio: `100 / ${vbH}`, background: "#f6e7cd" }}
    >
      <svg
        viewBox={`0 0 100 ${vbH}`}
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <StudioDefs idPrefix={idPrefix} />

        <StudioBackdrop idPrefix={idPrefix} vbH={vbH} />

        {/* evening-studio dimmer: the backdrop deepens in dark mode while the
            easel, can and paint stay saturated on top */}
        <rect
          width="100"
          height={vbH}
          fill="#131028"
          className="pointer-events-none opacity-0 transition-opacity duration-300 dark:opacity-50"
        />

        {/* easel legs (A-frame) */}
        <g stroke="#9c6b3f" strokeWidth="2.2" strokeLinecap="round">
          <line x1="44" y1="4" x2="31" y2="69.5" />
          <line x1="56" y1="4" x2="69" y2="69.5" />
        </g>
        <line x1="50" y1="44" x2="50" y2="70" stroke="#8a5c33" strokeWidth="1.8" strokeLinecap="round" />

        {/* the canvas — fills with paint over the session */}
        <rect x={CANVAS_R.x + 1.2} y={CANVAS_R.y + 1.4} width={CANVAS_R.w} height={CANVAS_R.h} fill="#3a2506" opacity="0.14" />
        <rect
          x={CANVAS_R.x}
          y={CANVAS_R.y}
          width={CANVAS_R.w}
          height={CANVAS_R.h}
          fill={`url(#${idPrefix}CanvasG)`}
          stroke="#cfc6b4"
          strokeWidth="0.6"
        />
        <rect
          x={CANVAS_R.x + 2}
          y={CANVAS_R.y + 2}
          width={CANVAS_R.w - 4}
          height={CANVAS_R.h - 4}
          fill="none"
          stroke="#e7e0d0"
          strokeWidth="0.4"
        />
        <g clipPath={`url(#${idPrefix}CanvasClip)`}>
          {settled.map((s) => (
            <CanvasSplatSettled key={s.id} s={s} />
          ))}
        </g>

        {/* easel tray + top clamp */}
        <rect x="28" y="43.4" width="44" height="2.3" rx="0.8" fill="#b07a45" stroke="#8a5c33" strokeWidth="0.4" />
        <rect x="47.4" y="3.2" width="5.2" height="3.2" rx="0.8" fill="#b07a45" stroke="#8a5c33" strokeWidth="0.4" />

        {/* the paint can carrying the stimulus */}
        <PaintCan
          stimulus={stimulus}
          stimulusProps={stimulusProps}
          popKey={popKey}
          shake={shake}
          idPrefix={idPrefix}
        />

        {/* wrong answers splodge onto the floor */}
        <g>
          {floorSettled.map((s) => (
            <FloorSplatSettled key={s.id} s={s} />
          ))}
        </g>

        {/* airborne paint — always on top of the props */}
        <g>
          {floorFlying.map((s) => (
            <FloorSplatFlying key={s.id} s={s} />
          ))}
          {flying.map((s) => (
            <CanvasSplatFlying key={s.id} s={s} />
          ))}
        </g>

        {children}

        {/* floating score pings */}
        <g>
          {pings.map((p) => (
            <PingGlyph key={p.id} ping={p} />
          ))}
        </g>

        <rect width="100" height={vbH} fill={`url(#${idPrefix}Vig)`} pointerEvents="none" />
      </svg>
    </div>
  );
}

/* ---------------- Tutorial demos (same SVG pieces, self-playing) ---------------- */

function DemoSplatRow() {
  return (
    <g>
      {COLORS.map((c, i) => (
        <g key={c}>
          <rect
            x={BTN_DEMO_X[i] - 9.5}
            y={80.8}
            width={19}
            height={12.4}
            rx={2.4}
            fill="#ffffff"
            opacity={0.92}
            stroke="#cbd5e1"
            strokeWidth={0.4}
          />
          <g transform={`translate(${BTN_DEMO_X[i]} 87)`}>
            <SplatShape color={c} shape={i} size={4.6} />
          </g>
        </g>
      ))}
    </g>
  );
}

function DemoFinger({ tx, ty, dur }: { tx: number; ty: number; dur: number }) {
  return (
    <g pointerEvents="none">
      <motion.g
        style={ORIGIN0}
        initial={false}
        animate={{
          x: [tx + 26, tx, tx, tx, tx + 26],
          y: [ty + 16, ty + 1, ty + 1, ty + 1, ty + 16],
          opacity: [0, 1, 1, 1, 0],
          scale: [1, 1, 0.82, 1, 1],
        }}
        transition={{
          duration: dur,
          times: [0, 0.3, 0.45, 0.55, 0.8],
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <circle r={3.4} fill="#ffffff" opacity={0.92} stroke="#64748b" strokeWidth={0.5} />
        <circle r={1.4} fill="#94a3b8" opacity={0.8} />
      </motion.g>
      <motion.circle
        cx={tx}
        cy={ty}
        r={4.5}
        fill="none"
        stroke="#0ea5e9"
        strokeWidth={0.7}
        initial={false}
        animate={{ scale: [0.4, 0.4, 1.7, 0.4], opacity: [0, 0, 0.8, 0] }}
        transition={{ duration: dur, times: [0, 0.45, 0.6, 0.75], repeat: Infinity }}
        style={
          {
            transformOrigin: `${tx}px ${ty}px`,
            transformBox: "view-box",
          } as CSSProperties
        }
      />
    </g>
  );
}

function DemoTrialStage({
  idPrefix,
  word,
  ink,
  answerIdx,
  trapIdx,
  pts,
}: {
  idPrefix: string;
  word: string;
  ink: Color;
  answerIdx: number;
  trapIdx?: number;
  pts: number;
}) {
  const bx = BTN_DEMO_X[answerIdx];
  const by = 87;
  const DUR = 4;
  return (
    <div className="mx-auto w-full max-w-sm">
      <StudioScene
        idPrefix={idPrefix}
        vbH={94}
        stimulus={{ kind: "word", word, ink }}
        canvasSplats={[]}
        floorSplats={[]}
        pings={[]}
        className="ring-1 ring-amber-900/15 dark:ring-slate-700"
      >
        <DemoSplatRow />
        {trapIdx !== undefined && (
          <motion.g
            initial={false}
            animate={{ opacity: [0, 0.9, 0.9, 0, 0] }}
            transition={{ duration: DUR, times: [0, 0.18, 0.42, 0.55, 1], repeat: Infinity }}
            pointerEvents="none"
          >
            <circle
              cx={BTN_DEMO_X[trapIdx]}
              cy={87}
              r={7.6}
              fill="none"
              stroke="#f43f5e"
              strokeWidth={0.8}
              strokeDasharray="2 1.6"
            />
            <text
              x={BTN_DEMO_X[trapIdx]}
              y={77.6}
              textAnchor="middle"
              fontSize={4.2}
              fontWeight={900}
              fill="#f43f5e"
            >
              ✕
            </text>
          </motion.g>
        )}
        {/* the splat flying from the tapped button onto the canvas */}
        <motion.g
          style={ORIGIN0}
          initial={false}
          animate={{
            x: [bx, bx, 50, 50, 50],
            y: [by, by, 24, 24, 24],
            scale: [0.35, 0.35, 1, 1, 1],
            rotate: [0, 0, 40, 40, 40],
            opacity: [0, 0, 1, 1, 1],
          }}
          transition={{ duration: DUR, times: [0, 0.5, 0.64, 0.9, 1], repeat: Infinity, ease: "easeOut" }}
          pointerEvents="none"
        >
          <SplatShape color={ink} shape={answerIdx} size={5.4} />
        </motion.g>
        {/* score ping after the splat lands */}
        <g transform="translate(50 15)" pointerEvents="none">
          <motion.g
            style={ORIGIN0}
            initial={false}
            animate={{ opacity: [0, 0, 0, 1, 0], y: [0, 0, 0, -5, -8] }}
            transition={{ duration: DUR, times: [0, 0.6, 0.64, 0.82, 1], repeat: Infinity }}
          >
            <rect x={-9} y={-4} width={18} height={8} rx={4} fill="#10b981" stroke="#047857" strokeWidth={0.4} />
            <text x={0} y={0.2} textAnchor="middle" dominantBaseline="central" fontSize={4.4} fontWeight={900} fill="#ffffff">
              +{pts}
            </text>
          </motion.g>
        </g>
        <DemoFinger tx={bx} ty={by} dur={DUR} />
      </StudioScene>
    </div>
  );
}

function DemoFlipStage() {
  const DUR = 5.4;
  const times = [0, 0.44, 0.52, 0.94, 1];
  return (
    <div className="mx-auto w-full max-w-sm space-y-2">
      <div className="relative" style={{ perspective: 500 }}>
        <div className="grid">
          <motion.div
            initial={false}
            animate={{ opacity: [1, 1, 0, 0, 1], rotateX: [0, 0, -90, -90, 0] }}
            transition={{ duration: DUR, times, repeat: Infinity }}
            className="col-start-1 row-start-1 flex min-h-[3rem] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-white shadow-soft"
          >
            <BrushIcon className="h-5 w-5" />
            <span className="font-black">Tap the INK colour</span>
          </motion.div>
          <motion.div
            initial={false}
            animate={{ opacity: [0, 0, 1, 1, 0], rotateX: [90, 90, 0, 0, 90] }}
            transition={{ duration: DUR, times, repeat: Infinity }}
            className="col-start-1 row-start-1 flex min-h-[3rem] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2 text-white shadow-soft"
          >
            <BubbleIcon className="h-5 w-5" />
            <span className="font-black">Tap what the word SAYS</span>
          </motion.div>
        </div>
      </div>
      <StudioScene
        idPrefix="demoFlip"
        vbH={94}
        stimulus={{ kind: "word", word: "BLUE", ink: "yellow" }}
        canvasSplats={[]}
        floorSplats={[]}
        pings={[]}
        className="ring-1 ring-amber-900/15 dark:ring-slate-700"
      >
        <DemoSplatRow />
        {/* the correct splat swaps as the rule flips: ink=yellow ⟷ word=blue */}
        <motion.circle
          initial={false}
          cx={BTN_DEMO_X[3]}
          cy={87}
          r={8}
          fill="none"
          stroke="#a855f7"
          strokeWidth={1}
          animate={{ opacity: [1, 1, 0, 0, 1] }}
          transition={{ duration: DUR, times, repeat: Infinity }}
        />
        <motion.circle
          initial={false}
          cx={BTN_DEMO_X[2]}
          cy={87}
          r={8}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth={1}
          animate={{ opacity: [0, 0, 1, 1, 0] }}
          transition={{ duration: DUR, times, repeat: Infinity }}
        />
      </StudioScene>
    </div>
  );
}

function DemoGoalStage() {
  return (
    <div className="mx-auto w-full max-w-sm">
      <StudioScene
        idPrefix="demoGoal"
        stimulus={{ kind: "swatch", ink: "red" }}
        canvasSplats={GOAL_SPLATS}
        floorSplats={[]}
        pings={[]}
        className="ring-1 ring-amber-900/15 dark:ring-slate-700"
      />
    </div>
  );
}

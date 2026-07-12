import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
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

type Side = "left" | "right";
type Answer = Side | "equal";

/** One crate face: what's painted on it and what it's actually worth. */
type SideSpec = { label: string; value: number; expr: boolean };

type Trial = { id: number; left: SideSpec; right: SideSpec; truth: Answer };

/** The resolved state of the current trial once the player (or clock) acts. */
type Reveal = {
  truth: Answer;
  picked: Answer | null; // null = timed out
  ok: boolean;
  timeout: boolean;
};

type Ping = {
  id: number;
  x: number; // svg coords (viewBox 0 0 100 78)
  y: number;
  text: string;
  ok: boolean;
  born: number;
};

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  twist: string;
  trials: number;
  required: number;
  /** Fraction of trials where both sides weigh the same. */
  equalRate: number;
  /** Per-trial answer window in ms (level 4 only); null = untimed. */
  window: number | null;
  lo: number;
  hi: number;
  minDiff: number;
  maxDiff: number;
  /** How many sides hide an expression: 0, 1 or 2. */
  exprSides: 0 | 1 | 2;
};

const SESSION_SECONDS = 180; // 3-minute session
const CORRECT_BASE = 15;
const SPEED_MAX = 10; // full bonus under ~0.5s, gone by 3s
const LEVEL_CLEAR_BONUS = 40;
const PING_LIFE_MS = 900;
const NEXT_OK_MS = 700; // beam tips, produce lands, next crates
const NEXT_BAD_MS = 1050; // long enough to read the resolved values
const TILT_DEG = 13;
const IDLE_SWAY = 1.4;

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Fruit stand",
    twist: "Fruit stand — plain single digits",
    trials: 12,
    required: 8,
    equalRate: 0,
    window: null,
    lo: 1,
    hi: 9,
    minDiff: 2,
    maxDiff: 8,
    exprSides: 0,
  },
  {
    id: 2,
    name: "Equal weights",
    twist: "Equal weights — ties appear, tap Equal",
    trials: 12,
    required: 9,
    equalRate: 0.3,
    window: null,
    lo: 6,
    hi: 19,
    minDiff: 1,
    maxDiff: 5,
    exprSides: 0,
  },
  {
    id: 3,
    name: "Do the math",
    twist: "Do the math — sums hide in the crates",
    trials: 13,
    required: 9,
    equalRate: 0.2,
    window: null,
    lo: 5,
    hi: 20,
    minDiff: 1,
    maxDiff: 3,
    exprSides: 1,
  },
  {
    id: 4,
    name: "Master trader",
    twist: "Master trader — two sums on a 5-second clock",
    trials: 14,
    required: 10,
    equalRate: 0.2,
    window: 5000,
    lo: 6,
    hi: 24,
    minDiff: 1,
    maxDiff: 3,
    exprSides: 2,
  },
];

/* ---------------- trial generation ---------------- */

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function numberSide(v: number): SideSpec {
  return { label: String(v), value: v, expr: false };
}

/** Dress a value up as a small expression: a+b, a−b or a×b. */
function exprSide(v: number): SideSpec {
  const forms: ("add" | "sub" | "mul")[] = [];
  if (v >= 4) forms.push("add");
  if (v <= 18) forms.push("sub");
  const factors: [number, number][] = [];
  for (let a = 2; a * a <= v; a++) {
    if (v % a === 0 && v / a <= 9) factors.push([a, v / a]);
  }
  if (factors.length > 0) forms.push("mul");
  const form = forms[Math.floor(Math.random() * forms.length)] ?? "add";
  if (form === "mul") {
    const [a, b] = factors[Math.floor(Math.random() * factors.length)];
    return {
      label: Math.random() < 0.5 ? `${a}×${b}` : `${b}×${a}`,
      value: v,
      expr: true,
    };
  }
  if (form === "sub") {
    const a = v + randInt(2, 9);
    return { label: `${a}−${a - v}`, value: v, expr: true };
  }
  const a = randInt(Math.max(1, v - 12), Math.min(12, v - 1));
  return { label: `${a}+${v - a}`, value: v, expr: true };
}

function pickPair(lvl: Level): [number, number] {
  for (let i = 0; i < 60; i++) {
    const a = randInt(lvl.lo, lvl.hi);
    const b = randInt(lvl.lo, lvl.hi);
    const d = Math.abs(a - b);
    if (d >= lvl.minDiff && d <= lvl.maxDiff) return [a, b];
  }
  return [lvl.lo, Math.min(lvl.hi, lvl.lo + lvl.minDiff)];
}

function makeTrials(lvl: Level, startId: number): Trial[] {
  const out: Trial[] = [];
  const equalCount = Math.round(lvl.trials * lvl.equalRate);
  const equalsAt = new Set<number>();
  while (equalsAt.size < equalCount) equalsAt.add(randInt(1, lvl.trials - 1));
  for (let i = 0; i < lvl.trials; i++) {
    let lv: number;
    let rv: number;
    if (equalsAt.has(i)) {
      lv = rv = randInt(lvl.lo, lvl.hi);
    } else {
      [lv, rv] = pickPair(lvl);
    }
    let leftExpr = false;
    let rightExpr = false;
    if (lvl.exprSides === 1) {
      if (Math.random() < 0.5) leftExpr = true;
      else rightExpr = true;
    } else if (lvl.exprSides === 2) {
      leftExpr = rightExpr = true;
    }
    out.push({
      id: startId + i,
      left: leftExpr ? exprSide(lv) : numberSide(lv),
      right: rightExpr ? exprSide(rv) : numberSide(rv),
      truth: lv === rv ? "equal" : lv > rv ? "left" : "right",
    });
  }
  return out;
}

/* ---------------- scale geometry helpers ---------------- */

const PIVOT_X = 50;
const PIVOT_Y = 22;
const HANG_X: Record<Side, number> = { left: 20, right: 80 };
const SIDES: readonly Side[] = ["left", "right"] as const;

const tiltFor = (truth: Answer): number =>
  truth === "left" ? -TILT_DEG : truth === "right" ? TILT_DEG : 0;

/** Where a +N ping should float for each answer, in svg coords. */
const pingPos = (a: Answer): { x: number; y: number } =>
  a === "left"
    ? { x: 20, y: 42 }
    : a === "right"
    ? { x: 80, y: 42 }
    : { x: 50, y: 26 };

/** Scalloped awning edge, built once — deterministic, so SSR-safe. */
const AWNING_PATH = (() => {
  let d = "M0 0 H100 V9";
  for (let x = 100; x > 0; x -= 12.5) {
    d += ` A6.25 6.4 0 0 1 ${x - 12.5} 9`;
  }
  return d + " Z";
})();

const labelFontSize = (label: string): number =>
  label.length <= 2 ? 6.6 : label.length === 3 ? 5.4 : label.length === 4 ? 4.8 : 4.2;

/* ================= main component ================= */

export default function QuickCompare() {
  const game = getGame("compare");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [trialNum, setTrialNum] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [pings, setPings] = useState<Ping[]>([]);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);

  const phaseRef = useRef<Phase>("intro");
  const levelIdxRef = useRef(0);
  const trialsRef = useRef<Trial[]>([]);
  const trialRef = useRef<Trial | null>(null);
  const trialNumRef = useRef(0);
  const trialSeqRef = useRef(0); // unique trial ids across retries/levels
  const correctRef = useRef(0);
  const totalCorrectRef = useRef(0);
  const lockedRef = useRef(false);
  const retryRef = useRef(false);
  const trialStartRef = useRef(0);
  const trialTimeoutRef = useRef<number | null>(null);
  const scoreRef = useRef(0);
  const levelPointsRef = useRef(0);
  const clearedRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const timeoutsRef = useRef<number[]>([]);
  const pingIdRef = useRef(0);
  const answerRef = useRef<(a: Answer) => void>(() => {});

  const setPhaseSafe = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const stopTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  const clearTrialTimeout = () => {
    if (trialTimeoutRef.current !== null) {
      window.clearTimeout(trialTimeoutRef.current);
      trialTimeoutRef.current = null;
    }
  };

  const later = (fn: () => void, ms: number) => {
    timeoutsRef.current.push(window.setTimeout(fn, ms));
  };

  useEffect(
    () => () => {
      stopTick();
      clearTrialTimeout();
      timeoutsRef.current.forEach((t) => window.clearTimeout(t));
    },
    []
  );

  const addPing = (pos: { x: number; y: number }, text: string, ok: boolean) => {
    const ping: Ping = {
      id: ++pingIdRef.current,
      x: pos.x,
      y: pos.y,
      text,
      ok,
      born: Date.now(),
    };
    setPings((prev) => [...prev, ping]);
  };

  const finishGame = (clearedAll: boolean) => {
    if (endedRef.current) return;
    endedRef.current = true;
    stopTick();
    clearTrialTimeout();
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
    const { isBest: best } = recordPlay("compare", final);
    setFinalScore(final);
    setIsBest(best);
    setPhaseSafe("done");
  };

  const startTrial = (i: number) => {
    const lvl = LEVELS[levelIdxRef.current];
    const t = trialsRef.current[i];
    trialRef.current = t;
    trialNumRef.current = i;
    setTrial(t);
    setTrialNum(i);
    lockedRef.current = false;
    setReveal(null);
    trialStartRef.current = performance.now();
    clearTrialTimeout();
    if (lvl.window !== null) {
      trialTimeoutRef.current = window.setTimeout(onTimeout, lvl.window);
    }
  };

  const beginLevelTrials = (idx: number) => {
    const lvl = LEVELS[idx];
    trialsRef.current = makeTrials(lvl, trialSeqRef.current);
    trialSeqRef.current += lvl.trials;
    correctRef.current = 0;
    setCorrectCount(0);
    startTrial(0);
  };

  const startLevel = (idx: number) => {
    levelIdxRef.current = idx;
    setLevelIdx(idx);
    levelPointsRef.current = 0;
    setPings([]);
    retryRef.current = false;
    setRetryMsg(null);
    setPhaseSafe("playing");
    beginLevelTrials(idx);
  };

  const advanceLevel = () => {
    clearTrialTimeout();
    const lvl = LEVELS[levelIdxRef.current];
    scoreRef.current += LEVEL_CLEAR_BONUS;
    levelPointsRef.current += LEVEL_CLEAR_BONUS;
    setScore(scoreRef.current);
    clearedRef.current += 1;
    setLastCleared(lvl.id);
    setLastLevelScore(levelPointsRef.current);
    setPhaseSafe("levelDone");
    const nextIdx = levelIdxRef.current + 1;
    later(() => {
      if (endedRef.current) return;
      if (nextIdx >= LEVELS.length) finishGame(true);
      else startLevel(nextIdx);
    }, 1150);
  };

  const nextTrial = () => {
    if (endedRef.current || phaseRef.current !== "playing") return;
    const lvl = LEVELS[levelIdxRef.current];
    const n = trialNumRef.current + 1;
    if (n >= lvl.trials) {
      if (correctRef.current >= lvl.required) {
        advanceLevel();
        return;
      }
      // not enough correct: fresh crates, same stall — never a dead end
      retryRef.current = true;
      setRetryMsg(`Almost! Get ${lvl.required} right — fresh crates coming.`);
      later(() => {
        if (endedRef.current || phaseRef.current !== "playing") return;
        retryRef.current = false;
        setRetryMsg(null);
        beginLevelTrials(levelIdxRef.current);
      }, 1500);
      return;
    }
    startTrial(n);
  };

  const onTimeout = () => {
    if (
      endedRef.current ||
      lockedRef.current ||
      retryRef.current ||
      phaseRef.current !== "playing"
    )
      return;
    const t = trialRef.current;
    if (!t) return;
    lockedRef.current = true;
    haptic.error();
    setReveal({ truth: t.truth, picked: null, ok: false, timeout: true });
    addPing({ x: 50, y: 26 }, "too slow", false);
    later(nextTrial, NEXT_BAD_MS);
  };

  const answer = (pick: Answer) => {
    if (endedRef.current || phaseRef.current !== "playing") return;
    if (lockedRef.current || retryRef.current) return;
    const t = trialRef.current;
    const lvl = LEVELS[levelIdxRef.current];
    if (!t) return;
    if (pick === "equal" && lvl.equalRate === 0) return; // no ties on level 1
    lockedRef.current = true;
    clearTrialTimeout();
    const rt = performance.now() - trialStartRef.current;
    const ok = pick === t.truth;
    setReveal({ truth: t.truth, picked: pick, ok, timeout: false });
    if (ok) {
      haptic.success();
      const bonus = Math.max(
        0,
        Math.min(SPEED_MAX, Math.round((3000 - rt) / 250))
      );
      const pts = CORRECT_BASE + bonus;
      scoreRef.current += pts;
      levelPointsRef.current += pts;
      correctRef.current += 1;
      totalCorrectRef.current += 1;
      setCorrectCount(correctRef.current);
      setScore(scoreRef.current);
      addPing(pingPos(t.truth), `+${pts}`, true);
      later(nextTrial, NEXT_OK_MS);
    } else {
      haptic.error();
      addPing(pingPos(pick), "miss", false);
      later(nextTrial, NEXT_BAD_MS);
    }
  };

  useEffect(() => {
    answerRef.current = answer;
  });

  // Arrow keys pick a pan; "=" claims a tie.
  useEffect(() => {
    if (phase !== "playing") return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        answerRef.current("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        answerRef.current("right");
      } else if (e.key === "=") {
        e.preventDefault();
        answerRef.current("equal");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [phase]);

  const begin = () => {
    timeoutsRef.current.forEach((t) => window.clearTimeout(t));
    timeoutsRef.current = [];
    clearTrialTimeout();
    scoreRef.current = 0;
    setScore(0);
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    correctRef.current = 0;
    totalCorrectRef.current = 0;
    trialSeqRef.current = 0;
    lockedRef.current = false;
    retryRef.current = false;
    endedRef.current = false;
    setCorrectCount(0);
    setTrial(null);
    setReveal(null);
    setPings([]);
    setRetryMsg(null);
    setLevelIdx(0);
    levelIdxRef.current = 0;
    setTimeLeft(SESSION_SECONDS);
    setPhaseSafe(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhaseSafe("countdown");
  };

  const afterCountdown = () => {
    deadlineRef.current = Date.now() + SESSION_SECONDS * 1000;
    setTimeLeft(SESSION_SECONDS);
    stopTick();
    sessionTickRef.current = window.setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000)
      );
      setTimeLeft(left);
      setPings((prev) => {
        const now = Date.now();
        const keep = prev.filter((p) => now - p.born < PING_LIFE_MS + 150);
        return keep.length === prev.length ? prev : keep;
      });
      if (left <= 0) finishGame(false);
    }, 200);
    startLevel(0);
  };

  const lvl = LEVELS[levelIdx];
  const hasEqual = lvl.equalRate > 0;

  const equalState: "off" | "idle" | "ok" | "bad" = !hasEqual
    ? "off"
    : reveal && reveal.picked === "equal"
    ? reveal.ok
      ? "ok"
      : "bad"
    : "idle";

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Two crates, one scale — tap the pan holding the bigger number.",
      stage: <DemoScale mode="pan" />,
      auto: 4000,
    },
    {
      caption: "Both sides weigh the same? Tap the Equal plate under the scale.",
      stage: <DemoScale mode="equal" />,
      auto: 4000,
    },
    {
      caption: "Some crates hide sums — 3+9 weighs 12, so it beats 11.",
      stage: <DemoScale mode="expr" />,
      auto: 4000,
    },
    {
      caption: "Level 4 is timed — answer before the bar runs out. Ready?",
      stage: <DemoScale mode="timer" />,
    },
  ];

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four market stalls in one 3-minute session. Two crates swing onto the
          scale — tap the pan you think is heavier, and the beam tips to show
          the truth. Level 2 adds ties (tap Equal), level 3 hides little sums
          in the crates, and level 4 puts two sums on a 5-second clock. Wrong
          guesses never subtract points — fast right answers earn extra.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={afterCountdown} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-3">
          <GameHUD
            levelTotal={LEVELS.length}
            levelCurrent={levelIdx + 1}
            levelsCleared={clearedRef.current}
            score={score}
            timeLeft={timeLeft}
            sessionSeconds={SESSION_SECONDS}
          />

          <div className="flex items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-900/95 px-3 py-1.5 text-sm font-bold text-amber-50 shadow-soft ring-1 ring-amber-500/40"
              data-testid="need"
            >
              <span aria-hidden className="text-emerald-300">
                ✓
              </span>
              <span className="tabular-nums">{correctCount}</span>
              <span className="text-xs font-semibold text-amber-300/90">
                / need {lvl.required}
              </span>
            </span>
            <span
              className="text-xs text-slate-500 dark:text-slate-400"
              data-testid="progress"
            >
              {lvl.name} · crate {Math.min(trialNum + 1, lvl.trials)}/
              {lvl.trials}
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
            <>
              <div
                data-testid="compare-stage"
                className="relative mx-auto aspect-[100/78] w-full max-w-xl overflow-hidden rounded-3xl shadow-soft ring-1 ring-amber-900/25 dark:ring-amber-950"
                style={{ background: "#8a4d1f" }}
              >
                {trial && (
                  <MarketScene
                    left={trial.left}
                    right={trial.right}
                    crateKey={trial.id}
                    reveal={reveal}
                    showChips={false}
                    onPan={(side) => answer(side)}
                  />
                )}

                {/* dusk dimmer so the stall looks intentional in dark mode */}
                <div className="pointer-events-none absolute inset-0 hidden bg-[#1a0d02]/25 dark:block" />

                {/* level-4 answer window */}
                {lvl.window !== null && trial && (
                  <div className="absolute inset-x-6 top-[16.5%] h-1.5 overflow-hidden rounded-full bg-black/20">
                    {!reveal && (
                      <motion.div
                        key={trial.id}
                        className="h-full origin-left rounded-full bg-gradient-to-r from-amber-300 to-rose-500"
                        initial={{ scaleX: 1 }}
                        animate={{ scaleX: 0 }}
                        transition={{
                          duration: lvl.window / 1000,
                          ease: "linear",
                        }}
                      />
                    )}
                  </div>
                )}

                {/* floating score pings */}
                <div className="pointer-events-none absolute inset-0 z-10">
                  {pings.map((p) => (
                    <div
                      key={p.id}
                      className="absolute"
                      style={{
                        left: `${p.x}%`,
                        top: `${(p.y / 78) * 100}%`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <motion.div
                        initial={{ opacity: 0, y: 2, scale: 0.6 }}
                        animate={{
                          opacity: [0, 1, 1, 0],
                          y: -22,
                          scale: [0.6, 1.12, 1, 1],
                        }}
                        transition={{
                          duration: PING_LIFE_MS / 1000,
                          times: [0, 0.18, 0.7, 1],
                        }}
                      >
                        <span
                          className={
                            "whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-black shadow-soft ring-1 " +
                            (p.ok
                              ? "bg-emerald-500 text-white ring-emerald-300"
                              : "bg-rose-500 text-white ring-rose-300")
                          }
                        >
                          {p.text}
                        </span>
                      </motion.div>
                    </div>
                  ))}
                </div>

                {/* retry banner when a stall needs another pass */}
                {retryMsg && (
                  <div className="absolute inset-0 z-20 grid place-items-center bg-black/30 backdrop-blur-[2px]">
                    <motion.div
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 340, damping: 22 }}
                      className="mx-6 rounded-2xl bg-white px-4 py-2.5 text-center text-sm font-bold text-slate-900 shadow-soft dark:bg-slate-900 dark:text-white"
                    >
                      {retryMsg}
                    </motion.div>
                  </div>
                )}

                <EqualButton
                  state={equalState}
                  interactive
                  onPress={() => answer("equal")}
                />
              </div>

              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                Tap the heavier pan
                {hasEqual ? " — or Equal when they balance" : ""}. Keys: ← →
                {hasEqual ? " =" : ""}
              </p>
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
          detail={`${clearedRef.current} / ${LEVELS.length} stalls · ${totalCorrectRef.current} correct`}
        />
      )}
    </GameShell>
  );
}

/* ================= the market scene ================= */

function MarketScene({
  left,
  right,
  crateKey,
  reveal,
  showChips,
  onPan,
  ghost,
}: {
  left: SideSpec;
  right: SideSpec;
  crateKey: number | string;
  reveal: Reveal | null;
  /** Also resolve expressions on CORRECT answers (used by tutorial demos). */
  showChips: boolean;
  onPan?: (side: Side) => void;
  ghost?: { x: number; y: number; tap: boolean } | null;
}) {
  const tilt = reveal ? tiltFor(reveal.truth) : 0;
  const produceSides: Side[] =
    reveal && reveal.ok
      ? reveal.truth === "equal"
        ? ["left", "right"]
        : [reveal.truth]
      : [];
  const chipsOn = !!reveal && (showChips || !reveal.ok);
  const flashSide: Side | null =
    reveal && !reveal.ok && (reveal.picked === "left" || reveal.picked === "right")
      ? reveal.picked
      : null;

  const tiltSpring = {
    type: "spring" as const,
    stiffness: 150,
    damping: 10,
    mass: 0.8,
  };
  const swayTransition = {
    duration: 3.8,
    repeat: Infinity,
    ease: "easeInOut" as const,
  };

  return (
    <svg
      viewBox="0 0 100 78"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-label="Market scale"
    >
      <MarketDefs />

      {/* wall + morning light */}
      <rect width="100" height="60" fill="url(#qcWall)" />
      <ellipse cx="50" cy="6" rx="56" ry="30" fill="url(#qcGlow)" />

      {/* awning */}
      <path d={AWNING_PATH} transform="translate(0 1.4)" fill="#7c2d12" opacity="0.28" />
      <g clipPath="url(#qcAwningClip)">
        {Array.from({ length: 8 }, (_, i) => (
          <rect
            key={i}
            x={i * 12.5}
            y={0}
            width={12.5}
            height={16.5}
            fill={i % 2 === 0 ? "#e2574c" : "#fff3d9"}
          />
        ))}
        <rect width="100" height="16.5" fill="url(#qcAwningShade)" />
      </g>
      <rect x="0" y="0" width="100" height="1" fill="#7c2d12" opacity="0.55" />

      {/* counter */}
      <rect x="0" y="60" width="100" height="18" fill="url(#qcWood)" />
      <rect x="0" y="60" width="100" height="2.2" fill="#e0a35c" />
      <rect x="0" y="62.2" width="100" height="0.7" fill="#6f3a14" opacity="0.5" />
      <g stroke="#6f3a14" strokeWidth="0.4" opacity="0.35">
        <line x1="0" y1="68.5" x2="100" y2="68.5" />
        <line x1="0" y1="73.5" x2="100" y2="73.5" />
        <line x1="17" y1="63" x2="17" y2="78" />
        <line x1="41" y1="63" x2="41" y2="78" />
        <line x1="67" y1="63" x2="67" y2="78" />
        <line x1="88" y1="63" x2="88" y2="78" />
      </g>

      {/* fruit baskets on the counter corners */}
      <g>
        <circle cx="6.6" cy="57.4" r="1.8" fill="#fb923c" stroke="#c2570a" strokeWidth="0.3" />
        <circle cx="10" cy="57" r="1.8" fill="#fb923c" stroke="#c2570a" strokeWidth="0.3" />
        <circle cx="8.3" cy="55.2" r="1.8" fill="#fdba74" stroke="#c2570a" strokeWidth="0.3" />
        <path d="M3.5 57 H13.2 L11.9 61.6 H4.8 Z" fill="url(#qcBasket)" stroke="#6f3a14" strokeWidth="0.4" />
        <path d="M4.3 59.2 H12.5 M4.7 60.6 H12.1" stroke="#6f3a14" strokeWidth="0.3" opacity="0.5" fill="none" />
      </g>
      <g>
        <circle cx="90" cy="57.4" r="1.8" fill="#ef4444" stroke="#991b1b" strokeWidth="0.3" />
        <circle cx="93.4" cy="57" r="1.8" fill="#ef4444" stroke="#991b1b" strokeWidth="0.3" />
        <circle cx="91.7" cy="55.2" r="1.8" fill="#f87171" stroke="#991b1b" strokeWidth="0.3" />
        <path d="M86.9 57 H96.6 L95.3 61.6 H88.2 Z" fill="url(#qcBasket)" stroke="#6f3a14" strokeWidth="0.4" />
        <path d="M87.7 59.2 H95.9 M88.1 60.6 H95.5" stroke="#6f3a14" strokeWidth="0.3" opacity="0.5" fill="none" />
      </g>

      {/* scale post + balance tick */}
      <path d="M45.6 62 L54.4 62 L52.4 56.4 L47.6 56.4 Z" fill="#78350f" stroke="#5b2c0c" strokeWidth="0.3" />
      <rect x="48.9" y="21" width="2.2" height="36" rx="1" fill="url(#qcPost)" stroke="#5b2c0c" strokeWidth="0.3" />
      <path d="M48.9 12.9 L51.1 12.9 L50 14.9 Z" fill="#fbbf24" stroke="#92400e" strokeWidth="0.25" />

      {/* beam + pans: outer sway loop, inner truth tilt; pans counter-rotate
          inside so they always hang plumb from the moving beam ends */}
      <motion.g
        style={{ transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px` }}
        animate={{ rotate: [-IDLE_SWAY, IDLE_SWAY, -IDLE_SWAY] }}
        transition={swayTransition}
      >
        <motion.g
          style={{ transformOrigin: `${PIVOT_X}px ${PIVOT_Y}px` }}
          initial={false}
          animate={{ rotate: tilt }}
          transition={tiltSpring}
        >
          {/* pointer needle (tilts with the beam, meets the tick when level) */}
          <path d="M48.8 15.6 L51.2 15.6 L50 21.4 Z" fill="#78350f" />
          {/* the beam */}
          <rect x="19" y="20.9" width="62" height="2.2" rx="1.1" fill="url(#qcBeam)" stroke="#5b2c0c" strokeWidth="0.3" />
          <circle cx="20" cy="22" r="1.2" fill="#713f12" />
          <circle cx="80" cy="22" r="1.2" fill="#713f12" />

          {SIDES.map((side) => {
            const hx = HANG_X[side];
            const spec = side === "left" ? left : right;
            return (
              <motion.g
                key={side}
                style={{ transformOrigin: `${hx}px ${PIVOT_Y}px` }}
                initial={false}
                animate={{ rotate: -tilt }}
                transition={tiltSpring}
              >
                <motion.g
                  style={{ transformOrigin: `${hx}px ${PIVOT_Y}px` }}
                  animate={{ rotate: [IDLE_SWAY, -IDLE_SWAY, IDLE_SWAY] }}
                  transition={swayTransition}
                >
                  <HangAssembly
                    side={side}
                    hx={hx}
                    spec={spec}
                    crateKey={crateKey}
                    produce={produceSides.includes(side)}
                    flash={flashSide === side}
                    chip={chipsOn}
                    onPan={onPan}
                  />
                </motion.g>
              </motion.g>
            );
          })}
        </motion.g>
      </motion.g>

      {/* static pivot cap over the beam */}
      <circle cx={PIVOT_X} cy={PIVOT_Y} r="1.6" fill="#fbbf24" stroke="#713f12" strokeWidth="0.4" />
      <circle cx={PIVOT_X - 0.4} cy={PIVOT_Y - 0.4} r="0.45" fill="#fff7e0" />

      {/* balanced! badge on equal reveals */}
      {reveal && reveal.truth === "equal" && (
        <motion.g
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 16 }}
          style={{ transformOrigin: "50px 10.5px" }}
        >
          <circle cx="50" cy="10.5" r="3.6" fill="#10b981" stroke="#ecfdf5" strokeWidth="0.5" />
          <text
            x="50"
            y="10.8"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="4.4"
            fontWeight="900"
            fill="#ffffff"
          >
            =
          </text>
        </motion.g>
      )}

      {/* tutorial ghost finger */}
      {ghost && (
        <motion.g
          initial={false}
          animate={{ x: ghost.x, y: ghost.y }}
          transition={{ type: "spring", stiffness: 110, damping: 15 }}
        >
          <motion.circle
            r={5.2}
            fill="rgba(255,255,255,0.3)"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={0.5}
            animate={{ scale: ghost.tap ? [1, 0.7, 1] : 1 }}
            transition={{ duration: 0.45 }}
          />
          <circle r={1.5} fill="rgba(255,255,255,0.95)" />
        </motion.g>
      )}
    </svg>
  );
}

/* ---------------- one hanging pan + crate ---------------- */

const PRODUCE_OFFSETS = [-6, -2, 2.4, 6.2];

function HangAssembly({
  side,
  hx,
  spec,
  crateKey,
  produce,
  flash,
  chip,
  onPan,
}: {
  side: Side;
  hx: number;
  spec: SideSpec;
  crateKey: number | string;
  produce: boolean;
  flash: boolean;
  chip: boolean;
  onPan?: (side: Side) => void;
}) {
  const chipText = spec.expr ? `${spec.label}=${spec.value}` : String(spec.value);
  const chipW = chipText.length * 2.1 + 3.6;
  return (
    <g>
      {/* strings + hook */}
      <g stroke="#6b3410" strokeWidth="0.45" fill="none">
        <line x1={hx} y1={22} x2={hx - 12} y2={39} />
        <line x1={hx} y1={22} x2={hx + 12} y2={39} />
      </g>
      <circle cx={hx} cy={22} r="0.9" fill="#4a2408" />

      {/* crate swings in per trial */}
      <motion.g
        key={`${crateKey}-${side}`}
        initial={{ opacity: 0, y: -9 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 17 }}
      >
        <rect
          x={hx - 9.5}
          y={26}
          width={19}
          height={14}
          rx={1}
          fill="url(#qcCrate)"
          stroke="#8a4d1f"
          strokeWidth="0.5"
        />
        <line x1={hx - 9.5} y1={30.5} x2={hx + 9.5} y2={30.5} stroke="#8a4d1f" strokeWidth="0.35" opacity="0.6" />
        <line x1={hx - 9.5} y1={35.5} x2={hx + 9.5} y2={35.5} stroke="#8a4d1f" strokeWidth="0.35" opacity="0.6" />
        <rect x={hx - 9.5} y={26} width={1.6} height={14} fill="#8a4d1f" opacity="0.35" />
        <rect x={hx + 7.9} y={26} width={1.6} height={14} fill="#8a4d1f" opacity="0.35" />
        {/* painted price tag */}
        <rect
          x={hx - 8}
          y={28.6}
          width={16}
          height={8.8}
          rx={1.4}
          fill="#fff7e0"
          stroke="#b45309"
          strokeWidth="0.4"
        />
        <text
          x={hx}
          y={33.2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={labelFontSize(spec.label)}
          fontWeight="900"
          fill="#7c2d12"
        >
          {spec.label}
        </text>
      </motion.g>

      {/* brass pan */}
      <path
        d={`M ${hx - 13} 39 Q ${hx} 48 ${hx + 13} 39 Q ${hx} 43.5 ${hx - 13} 39 Z`}
        fill="url(#qcPan)"
        stroke="#6b3410"
        strokeWidth="0.4"
      />
      <path
        d={`M ${hx - 13} 39 Q ${hx} 43.5 ${hx + 13} 39`}
        fill="none"
        stroke="#f6c453"
        strokeWidth="0.45"
        opacity="0.8"
      />

      {/* produce bounces into the winning pan */}
      {produce &&
        PRODUCE_OFFSETS.map((dx, i) => (
          <motion.g
            key={i}
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: "spring",
              stiffness: 320,
              damping: 13,
              delay: 0.045 * i,
            }}
          >
            <circle
              cx={hx + dx}
              cy={42.6 - (i % 2) * 1.1}
              r={2.1}
              fill={i % 2 === 0 ? "#ef4444" : "#fb923c"}
              stroke={i % 2 === 0 ? "#991b1b" : "#c2570a"}
              strokeWidth="0.3"
            />
            {i % 2 === 0 && (
              <ellipse
                cx={hx + dx + 0.8}
                cy={40.1}
                rx={0.9}
                ry={0.45}
                fill="#4ade80"
                transform={`rotate(-28 ${hx + dx + 0.8} 40.1)`}
              />
            )}
          </motion.g>
        ))}

      {/* resolved values after a wrong pick / timeout */}
      {chip && (
        <motion.g
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <rect
            x={hx - chipW / 2}
            y={22.8}
            width={chipW}
            height={5.2}
            rx={2.6}
            fill="#fffbeb"
            stroke="#b45309"
            strokeWidth="0.35"
          />
          <text
            x={hx}
            y={25.5}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="3.4"
            fontWeight="800"
            fill="#7c2d12"
          >
            {chipText}
          </text>
        </motion.g>
      )}

      {/* red flash on a wrong pick */}
      {flash && (
        <motion.rect
          x={hx - 16.5}
          y={19}
          width={33}
          height={34.5}
          rx={4}
          fill="#f43f5e"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.45, 0.2, 0] }}
          transition={{ duration: 0.6, times: [0, 0.2, 0.6, 1] }}
          pointerEvents="none"
        />
      )}

      {/* generous invisible hit area — the whole pan is the button */}
      <rect
        data-testid={onPan ? (side === "left" ? "side-left" : "side-right") : undefined}
        x={hx - 16.5}
        y={19}
        width={33}
        height={34.5}
        rx={4}
        fill="transparent"
        role={onPan ? "button" : undefined}
        aria-label={`${side === "left" ? "Left" : "Right"} pan: ${spec.label}`}
        style={{ cursor: onPan ? "pointer" : "default" }}
        onPointerDown={onPan ? () => onPan(side) : undefined}
      />
    </g>
  );
}

/* ---------------- shared defs ---------------- */

function MarketDefs() {
  return (
    <defs>
      <linearGradient id="qcWall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fff6e3" />
        <stop offset="100%" stopColor="#f8cd90" />
      </linearGradient>
      <radialGradient id="qcGlow" cx="0.5" cy="0.35" r="0.75">
        <stop offset="0%" stopColor="#fffdf5" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#fffdf5" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="qcAwningShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.25" />
        <stop offset="70%" stopColor="#7c2d12" stopOpacity="0" />
        <stop offset="100%" stopColor="#7c2d12" stopOpacity="0.22" />
      </linearGradient>
      <linearGradient id="qcWood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#b06a28" />
        <stop offset="100%" stopColor="#7c3f12" />
      </linearGradient>
      <linearGradient id="qcPost" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#a16207" />
        <stop offset="50%" stopColor="#ca8a04" />
        <stop offset="100%" stopColor="#713f12" />
      </linearGradient>
      <linearGradient id="qcBeam" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ca8a04" />
        <stop offset="100%" stopColor="#713f12" />
      </linearGradient>
      <linearGradient id="qcPan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#d97706" />
        <stop offset="100%" stopColor="#8a4508" />
      </linearGradient>
      <linearGradient id="qcCrate" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#dfa25b" />
        <stop offset="100%" stopColor="#b06a28" />
      </linearGradient>
      <linearGradient id="qcBasket" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#c07a3a" />
        <stop offset="100%" stopColor="#8a4d1f" />
      </linearGradient>
      <clipPath id="qcAwningClip">
        <path d={AWNING_PATH} />
      </clipPath>
    </defs>
  );
}

/* ---------------- the Equal plate ---------------- */

function EqualButton({
  state,
  interactive,
  onPress,
}: {
  state: "off" | "idle" | "ok" | "bad";
  interactive: boolean;
  onPress?: () => void;
}) {
  const look =
    state === "ok"
      ? "bg-emerald-500 text-white ring-emerald-200"
      : state === "bad"
      ? "bg-rose-500 text-white ring-rose-200"
      : state === "off"
      ? "bg-amber-100/50 text-amber-900/40 ring-amber-800/20"
      : "bg-gradient-to-b from-amber-200 to-amber-400 text-amber-950 ring-amber-700/50 active:scale-95";
  return (
    <button
      type="button"
      data-testid={interactive ? "btn-equal" : undefined}
      disabled={!interactive || state === "off"}
      onPointerDown={interactive ? onPress : undefined}
      onClick={interactive ? onPress : undefined}
      aria-label="Equal — both sides weigh the same"
      className={
        "absolute bottom-2 left-1/2 z-10 flex min-h-[44px] -translate-x-1/2 select-none items-center gap-1.5 rounded-full px-5 text-sm font-black shadow-soft ring-2 transition-transform " +
        look +
        (interactive ? "" : " pointer-events-none")
      }
    >
      <span aria-hidden className="text-lg leading-none">
        =
      </span>
      Equal
    </button>
  );
}

/* ---------------- tutorial demos ---------------- */

type DemoMode = "pan" | "equal" | "expr" | "timer";

const DEMO_SPECS: Record<
  DemoMode,
  { left: SideSpec; right: SideSpec; truth: Answer; showChips: boolean; pts: number }
> = {
  pan: {
    left: { label: "3", value: 3, expr: false },
    right: { label: "9", value: 9, expr: false },
    truth: "right",
    showChips: false,
    pts: 23,
  },
  equal: {
    left: { label: "12", value: 12, expr: false },
    right: { label: "12", value: 12, expr: false },
    truth: "equal",
    showChips: false,
    pts: 21,
  },
  expr: {
    left: { label: "3+9", value: 12, expr: true },
    right: { label: "11", value: 11, expr: false },
    truth: "left",
    showChips: true,
    pts: 22,
  },
  timer: {
    left: { label: "2×7", value: 14, expr: true },
    right: { label: "9+4", value: 13, expr: true },
    truth: "left",
    showChips: true,
    pts: 25,
  },
};

/** A looping, self-playing mini market: ghost finger drifts to the answer,
 *  taps, the beam tips (or balances), produce bounces, then fresh crates. */
function DemoScale({ mode }: { mode: DemoMode }) {
  // beat 0: crates swing in · 1: finger approaches · 2: tap + reveal · 3: hold
  const [beat, setBeat] = useState(0);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setBeat((b) => {
        if (b >= 3) {
          setCycle((c) => c + 1);
          return 0;
        }
        return b + 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const spec = DEMO_SPECS[mode];
  const reveal: Reveal | null =
    beat >= 2
      ? { truth: spec.truth, picked: spec.truth, ok: true, timeout: false }
      : null;
  const target =
    spec.truth === "equal"
      ? { x: 50, y: 70 }
      : { x: HANG_X[spec.truth as Side], y: 40 };
  const ghost =
    beat === 0
      ? { x: 50, y: 52, tap: false }
      : { x: target.x, y: target.y, tap: beat === 2 };
  const pos = pingPos(spec.truth);

  return (
    <div
      className="relative mx-auto aspect-[100/78] w-full max-w-sm overflow-hidden rounded-3xl shadow-soft ring-1 ring-amber-900/25 dark:ring-amber-950"
      style={{ background: "#8a4d1f" }}
    >
      <MarketScene
        left={spec.left}
        right={spec.right}
        crateKey={cycle}
        reveal={reveal}
        showChips={spec.showChips}
        ghost={ghost}
      />
      <div className="pointer-events-none absolute inset-0 hidden bg-[#1a0d02]/25 dark:block" />

      {mode === "timer" && (
        <div className="absolute inset-x-6 top-[16.5%] h-1.5 overflow-hidden rounded-full bg-black/20">
          <motion.div
            key={cycle}
            className="h-full origin-left rounded-full bg-gradient-to-r from-amber-300 to-rose-500"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: 4, ease: "linear" }}
          />
        </div>
      )}

      {reveal && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${pos.x}%`,
            top: `${(pos.y / 78) * 100}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 2, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0.9], y: -20, scale: [0.6, 1.12, 1, 1] }}
            transition={{ duration: 1.4, times: [0, 0.15, 0.75, 1] }}
          >
            <span className="whitespace-nowrap rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-black text-white shadow-soft ring-1 ring-emerald-300">
              +{spec.pts}
            </span>
          </motion.div>
        </div>
      )}

      <EqualButton
        state={mode === "equal" && beat >= 2 ? "ok" : "idle"}
        interactive={false}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useStore } from "@/store/useStore";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

/* ---------------- Tuning ---------------- */

const SESSION_SECONDS = 180; // 3-minute session
const POINTS_HIT = 14;
const POINTS_CORRECT_REJECT = 2;
const POINTS_FALSE_ALARM = -6;
const LEVEL_CLEAR_BONUS = 50;
const PING_LIFE_MS = 950;
const REVEAL_MS = 700;

type AnimalKind = "cat" | "dog" | "rabbit" | "duck" | "pig" | "frog";
const KINDS: AnimalKind[] = ["cat", "dog", "rabbit", "duck", "pig", "frog"];

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  /** Twist copy shown on the LevelComplete card. */
  twist: string;
  n: 1 | 2 | 3;
  total: number;
  intervalMs: number;
  /** Exact number of match steps generated in the sequence. */
  targets: number;
  /** Minimum hits required to clear the level. */
  hitsToClear: number;
  /** From level 2 the parade history hides inside crates. */
  hide: boolean;
};

const LEVELS: Level[] = [
  {
    id: 1,
    name: "1-back · animals visible",
    twist: "1-back — the last animal stays visible",
    n: 1,
    total: 13,
    intervalMs: 2600,
    targets: 5,
    hitsToClear: 3,
    hide: false,
  },
  {
    id: 2,
    name: "2-back · animals hide",
    twist: "2-back — animals hide in crates",
    n: 2,
    total: 17,
    intervalMs: 2200,
    targets: 5,
    hitsToClear: 3,
    hide: true,
  },
  {
    id: 3,
    name: "3-back",
    twist: "3-back — three crates deep",
    n: 3,
    total: 19,
    intervalMs: 2000,
    targets: 6,
    hitsToClear: 3,
    hide: true,
  },
  {
    id: 4,
    name: "3-back · faster",
    twist: "3-back — the parade speeds up",
    n: 3,
    total: 21,
    intervalMs: 1650,
    targets: 6,
    hitsToClear: 4,
    hide: true,
  },
];

/* ---------------- Sequence generation ---------------- */

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Build a parade with exactly `targetCount` matches; the first match lands
 *  within the first three evaluable steps so early success comes fast. */
function genSequence(total: number, n: number, targetCount: number): AnimalKind[] {
  const evaluable: number[] = [];
  for (let i = n; i < total; i++) evaluable.push(i);
  const early = evaluable[Math.floor(Math.random() * Math.min(3, evaluable.length))];
  const rest = shuffle(evaluable.filter((i) => i !== early));
  const targets = new Set<number>([early, ...rest.slice(0, Math.max(0, targetCount - 1))]);
  const seq: AnimalKind[] = [];
  for (let i = 0; i < total; i++) {
    if (i >= n && targets.has(i)) {
      seq.push(seq[i - n]);
      continue;
    }
    let k = KINDS[Math.floor(Math.random() * KINDS.length)];
    if (i >= n && k === seq[i - n]) {
      k = KINDS[(KINDS.indexOf(k) + 1) % KINDS.length];
    }
    seq.push(k);
  }
  return seq;
}

/* ---------------- Scene geometry ---------------- */

/** x of the spotlight (offset 0) and the 1/2/3-back history slots. */
const SLOT_X = [74, 52, 33, 14.5];
const FEET_Y = 45;

type SceneAnimal = {
  /** Absolute step index — stable key while the animal shuffles left. */
  key: number;
  kind: AnimalKind;
  /** 0 = spotlight, 1..3 = steps back. */
  offset: number;
  hidden: boolean;
};

type Reveal = { offset: number; ok: boolean } | null;

type Ping = {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: "ok" | "bad" | "warn";
  born: number;
};

/* ================================================================
   Main component
   ================================================================ */

export default function NBack() {
  const game = getGame("nback");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [seq, setSeq] = useState<AnimalKind[]>([]);
  const [stepIdx, setStepIdx] = useState(-1);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [falseAlarms, setFalseAlarms] = useState(0);
  const [reveal, setReveal] = useState<Reveal>(null);
  const [pings, setPings] = useState<Ping[]>([]);
  const [faFlash, setFaFlash] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<"hit" | "fa" | "miss" | null>(null);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);

  const scoreRef = useRef(0);
  const clearedRef = useRef(0);
  const levelPointsRef = useRef(0);
  const levelHitsRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const stepTimerRef = useRef<number | null>(null);
  const transitionRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const seqRef = useRef<AnimalKind[]>([]);
  const stepIdxRef = useRef(-1);
  const levelIdxRef = useRef(0);
  const respondedRef = useRef<boolean[]>([]);
  const pingIdRef = useRef(0);
  const endedRef = useRef(false);

  const currentLevel = LEVELS[levelIdx];

  const clearStepTimer = () => {
    if (stepTimerRef.current !== null) {
      window.clearTimeout(stepTimerRef.current);
      stepTimerRef.current = null;
    }
  };
  const stopSessionTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };
  const clearTransientTimers = () => {
    if (transitionRef.current !== null) {
      window.clearTimeout(transitionRef.current);
      transitionRef.current = null;
    }
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  };

  useEffect(
    () => () => {
      clearStepTimer();
      stopSessionTick();
      clearTransientTimers();
    },
    []
  );

  const end = useCallback(
    (clearedAll: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearStepTimer();
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
      const { isBest: best } = recordPlay("nback", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  const addPing = (x: number, y: number, text: string, tone: Ping["tone"]) => {
    const now = performance.now();
    const ping: Ping = { id: ++pingIdRef.current, x, y, text, tone, born: now };
    setPings((prev) => [...prev.filter((p) => now - p.born < PING_LIFE_MS), ping]);
  };

  const advance = useCallback(() => {
    const i = stepIdxRef.current;
    const lvl = LEVELS[levelIdxRef.current];
    // Evaluate the step that just ended for misses / correct rejections —
    // hits and false alarms were already scored the instant the player tapped.
    if (i >= lvl.n) {
      const s = seqRef.current;
      const isTarget = s[i] === s[i - lvl.n];
      const responded = respondedRef.current[i] === true;
      if (isTarget && !responded) {
        setMisses((m) => m + 1);
        setLastFeedback("miss");
        addPing(SLOT_X[lvl.n], 22, "missed", "warn");
        if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = window.setTimeout(() => setLastFeedback(null), 380);
      } else if (!isTarget && !responded) {
        scoreRef.current += POINTS_CORRECT_REJECT;
        levelPointsRef.current += POINTS_CORRECT_REJECT;
        setScore(scoreRef.current);
      }
    }
    setReveal(null);
    setPings((prev) => prev.filter((p) => performance.now() - p.born < PING_LIFE_MS));

    const next = i + 1;
    if (next >= lvl.total) {
      clearStepTimer();
      if (levelHitsRef.current >= lvl.hitsToClear) {
        scoreRef.current += LEVEL_CLEAR_BONUS;
        levelPointsRef.current += LEVEL_CLEAR_BONUS;
        setScore(scoreRef.current);
        clearedRef.current += 1;
        setLastCleared(lvl.id);
        setLastLevelScore(levelPointsRef.current);
        setPhase("levelDone");
        const nextIdx = levelIdxRef.current + 1;
        if (nextIdx >= LEVELS.length) {
          transitionRef.current = window.setTimeout(() => end(true), 1100);
        } else {
          transitionRef.current = window.setTimeout(() => startLevel(nextIdx), 1100);
        }
      } else {
        // not enough matches — the parade is over
        end(false);
      }
      return;
    }
    stepIdxRef.current = next;
    setStepIdx(next);
    stepTimerRef.current = window.setTimeout(advance, lvl.intervalMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end]);

  const startLevel = useCallback(
    (idx: number) => {
      const lvl = LEVELS[idx];
      const s = genSequence(lvl.total, lvl.n, lvl.targets);
      setLevelIdx(idx);
      levelIdxRef.current = idx;
      setSeq(s);
      seqRef.current = s;
      respondedRef.current = new Array(lvl.total).fill(false);
      levelPointsRef.current = 0;
      levelHitsRef.current = 0;
      stepIdxRef.current = 0;
      setStepIdx(0);
      setReveal(null);
      setPings([]);
      setPhase("playing");
      clearStepTimer();
      stepTimerRef.current = window.setTimeout(advance, lvl.intervalMs);
    },
    [advance]
  );

  const begin = () => {
    setScore(0);
    scoreRef.current = 0;
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    levelHitsRef.current = 0;
    setHits(0);
    setMisses(0);
    setFalseAlarms(0);
    setLevelIdx(0);
    levelIdxRef.current = 0;
    setStepIdx(-1);
    stepIdxRef.current = -1;
    setReveal(null);
    setPings([]);
    setFaFlash(0);
    setTimeLeft(SESSION_SECONDS);
    endedRef.current = false;
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
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

  /** Instant verdict on tap: hits and false alarms answer within one frame. */
  const onMatch = useCallback(() => {
    if (phase !== "playing") return;
    const i = stepIdxRef.current;
    const lvl = LEVELS[levelIdxRef.current];
    if (i < lvl.n) return;
    if (respondedRef.current[i]) return;
    respondedRef.current[i] = true;
    const s = seqRef.current;
    const isTarget = s[i] === s[i - lvl.n];
    if (isTarget) {
      haptic.success();
      scoreRef.current += POINTS_HIT;
      levelPointsRef.current += POINTS_HIT;
      levelHitsRef.current += 1;
      setHits((h) => h + 1);
      setScore(scoreRef.current);
      addPing(SLOT_X[0], 25, `+${POINTS_HIT}`, "ok");
      setReveal({ offset: lvl.n, ok: true });
      setLastFeedback("hit");
    } else {
      haptic.error();
      scoreRef.current = Math.max(0, scoreRef.current + POINTS_FALSE_ALARM);
      levelPointsRef.current += POINTS_FALSE_ALARM;
      setFalseAlarms((f) => f + 1);
      setScore(scoreRef.current);
      addPing(SLOT_X[0], 25, `${POINTS_FALSE_ALARM}`, "bad");
      setReveal({ offset: lvl.n, ok: false });
      setFaFlash((k) => k + 1);
      setLastFeedback("fa");
    }
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
    revealTimerRef.current = window.setTimeout(() => setReveal(null), REVEAL_MS);
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setLastFeedback(null), 380);
  }, [phase]);

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

  /* ---------- Derived render data ---------- */

  const current =
    stepIdx >= 0 && stepIdx < currentLevel.total ? seq[stepIdx] : null;

  const animals: SceneAnimal[] = useMemo(() => {
    if (stepIdx < 0) return [];
    const list: SceneAnimal[] = [];
    for (let i = Math.max(0, stepIdx - 3); i <= stepIdx; i++) {
      const offset = stepIdx - i;
      list.push({
        key: i,
        kind: seq[i],
        offset,
        hidden: currentLevel.hide && offset > 0,
      });
    }
    return list;
  }, [stepIdx, seq, currentLevel.hide]);

  const progress = useMemo(
    () => Math.max(0, Math.min(1, (stepIdx + 1) / currentLevel.total)),
    [stepIdx, currentLevel.total]
  );

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Animals walk on stage one by one — past ones slide down the line.",
      stage: <DemoWalk />,
      auto: 4000,
    },
    {
      caption: "Spotlight animal same as the glowing 1-back spot? Tap Match!",
      stage: <DemoMatch n={1} hide={false} />,
      auto: 4000,
    },
    {
      caption: "From level 2 the passing animals hide in crates — remember who's inside.",
      stage: <DemoMatch n={2} hide />,
      auto: 4000,
    },
    {
      caption: "No match? Just wait. Wrong taps cost a few points. Space works too.",
      stage: <DemoButton />,
    },
  ];

  const stageRing =
    lastFeedback === "hit"
      ? "ring-emerald-400/80"
      : lastFeedback === "fa"
      ? "ring-rose-400/80"
      : lastFeedback === "miss"
      ? "ring-amber-400/80"
      : "ring-indigo-950/40 dark:ring-indigo-950";

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four parade levels in one 3-minute session. Each animal stops in the
          spotlight while the ones before it ride the conveyor into the
          history spots. Tap Match (or press space) when the spotlight animal
          is the same as the one on the glowing “N back” spot. Level 1 keeps
          the past animals visible; from level 2 they hide inside crates, so
          your memory does the work.
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
          />

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold">{currentLevel.name}</span>
            <span data-testid="progress">
              step {Math.min(stepIdx + 1, currentLevel.total)} / {currentLevel.total} · {hits} matches
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <motion.div
              className="h-full bg-gradient-to-r from-brand-500 to-accent-teal"
              animate={{ width: `${progress * 100}%` }}
              transition={{ ease: "linear", duration: 0.2 }}
            />
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
                data-testid="stage"
                data-current={current ?? ""}
                data-n={currentLevel.n}
                className={
                  "relative overflow-hidden rounded-3xl ring-2 transition-colors duration-150 " +
                  stageRing
                }
              >
                <ParadeScene
                  idPrefix="ap"
                  n={currentLevel.n}
                  animals={animals}
                  reveal={reveal}
                  pings={pings}
                  watching={stepIdx < currentLevel.n}
                />
                <AnimatePresence>
                  {faFlash > 0 && lastFeedback === "fa" && (
                    <motion.div
                      key={faFlash}
                      className="pointer-events-none absolute inset-0 rounded-3xl bg-rose-500/25"
                      initial={{ opacity: 0.6 }}
                      animate={{ opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.4 }}
                    />
                  )}
                </AnimatePresence>
              </div>

              <motion.button
                type="button"
                onClick={onMatch}
                data-testid="match-btn"
                whileTap={{ scale: 0.97 }}
                className="btn-primary w-full min-h-[56px] text-lg disabled:opacity-50"
                aria-label={`Press if the spotlight animal matches ${currentLevel.n} back`}
                disabled={stepIdx < currentLevel.n}
              >
                Match{" "}
                <span className="ml-1 hidden rounded-md bg-white/20 px-1.5 py-0.5 text-xs font-bold sm:inline">
                  space
                </span>
              </motion.button>
              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                {stepIdx < currentLevel.n
                  ? `Just watch the first ${currentLevel.n} animal${currentLevel.n === 1 ? "" : "s"} — nothing to compare yet.`
                  : `Same animal as the “${currentLevel.n} back” spot → Match. Need ${currentLevel.hitsToClear} to clear.`}
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
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${hits} matches · ${misses} missed · ${falseAlarms} false alarms`}
        />
      )}
    </GameShell>
  );
}

/* ================================================================
   The parade scene
   ================================================================ */

const styleOrigin = (origin: string): React.CSSProperties =>
  ({ transformBox: "fill-box", transformOrigin: origin } as React.CSSProperties);

/** Deterministic decorative data — module scope, no Math.random (SSR-safe). */
const STARS: { x: number; y: number; r: number; dur: number; delay: number }[] = [
  { x: 6, y: 6, r: 0.55, dur: 2.6, delay: 0 },
  { x: 16, y: 12, r: 0.4, dur: 3.4, delay: 0.6 },
  { x: 29, y: 5, r: 0.5, dur: 2.9, delay: 1.1 },
  { x: 41, y: 14, r: 0.35, dur: 3.8, delay: 0.3 },
  { x: 55, y: 7, r: 0.5, dur: 2.4, delay: 1.5 },
  { x: 63, y: 15, r: 0.35, dur: 3.1, delay: 0.9 },
  { x: 88, y: 6, r: 0.55, dur: 2.7, delay: 0.2 },
  { x: 95, y: 13, r: 0.4, dur: 3.5, delay: 1.3 },
];

const FLAG_COLORS = ["#fb7185", "#facc15", "#34d399", "#38bdf8", "#f472b6"];

function swagPoint(t: number, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number) {
  const mt = 1 - t;
  return {
    x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
    y: mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
  };
}

const BUNTING: { x: number; y: number; c: string }[] = (() => {
  const flags: { x: number; y: number; c: string }[] = [];
  const swags: [number, number, number, number, number, number][] = [
    [-2, 2, 25, 12, 51, 3],
    [51, 3, 76, 12, 102, 2],
  ];
  let ci = 0;
  for (const [x0, y0, cx, cy, x1, y1] of swags) {
    for (let i = 1; i <= 5; i++) {
      const p = swagPoint(i / 6, x0, y0, cx, cy, x1, y1);
      flags.push({ x: p.x, y: p.y, c: FLAG_COLORS[ci++ % FLAG_COLORS.length] });
    }
  }
  return flags;
})();

function ParadeScene({
  idPrefix,
  n,
  animals,
  reveal,
  pings,
  watching,
  extras,
}: {
  idPrefix: string;
  n: number;
  animals: SceneAnimal[];
  reveal: Reveal;
  pings: Ping[];
  watching?: boolean;
  extras?: React.ReactNode;
}) {
  return (
    <div
      className="relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl"
      style={{ background: "#171243" }}
    >
      <svg viewBox="0 0 100 58" className="block h-auto w-full" role="img" aria-label="Animal parade">
        <defs>
          <linearGradient id={`${idPrefix}Sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#221c66" />
            <stop offset="62%" stopColor="#41369e" />
            <stop offset="100%" stopColor="#6d5fd0" />
          </linearGradient>
          <linearGradient id={`${idPrefix}Beam`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff7cf" stopOpacity="0.03" />
            <stop offset="100%" stopColor="#ffe9a3" stopOpacity="0.35" />
          </linearGradient>
          <linearGradient id={`${idPrefix}Floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2c2570" />
            <stop offset="100%" stopColor="#171243" />
          </linearGradient>
          <radialGradient id={`${idPrefix}Glow`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#ffe9a3" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffe9a3" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* sky */}
        <rect width="100" height="44" fill={`url(#${idPrefix}Sky)`} />
        <g>
          {STARS.map((s, i) => (
            <motion.circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#e9e4ff"
              animate={{ opacity: [0.25, 0.9, 0.25] }}
              transition={{ duration: s.dur, repeat: Infinity, ease: "easeInOut", delay: s.delay }}
            />
          ))}
        </g>

        {/* distant circus tent + crowd bumps on the horizon */}
        <g fill="#241d68">
          <rect x="7" y="34.5" width="15" height="9.5" rx="0.6" />
          <polygon points="5,35 14.5,25.5 24,35" />
          <line x1="14.5" y1="25.5" x2="14.5" y2="23" stroke="#241d68" strokeWidth="0.5" />
          <polygon points="14.5,23 18.5,24 14.5,25.2" fill="#fb7185" />
          <ellipse cx="34" cy="44" rx="5" ry="2.6" />
          <ellipse cx="43" cy="44.4" rx="4" ry="2" />
          <ellipse cx="93" cy="44" rx="6" ry="2.8" />
        </g>
        <g stroke="#3d3490" strokeWidth="0.5">
          <line x1="10.5" y1="35.5" x2="10.5" y2="43.5" />
          <line x1="14.5" y1="35.5" x2="14.5" y2="43.5" />
          <line x1="18.5" y1="35.5" x2="18.5" y2="43.5" />
        </g>

        {/* bunting */}
        <g>
          <path d="M -2 2 Q 25 12 51 3" fill="none" stroke="#8b83c9" strokeWidth="0.4" />
          <path d="M 51 3 Q 76 12 102 2" fill="none" stroke="#8b83c9" strokeWidth="0.4" />
          {BUNTING.map((f, i) => (
            <polygon
              key={i}
              points={`${f.x - 1.5},${f.y} ${f.x + 1.5},${f.y} ${f.x},${f.y + 2.7}`}
              fill={f.c}
              opacity="0.9"
            />
          ))}
        </g>

        {/* floor */}
        <rect y="44" width="100" height="14" fill={`url(#${idPrefix}Floor)`} />

        {/* conveyor belt */}
        <rect x="-2" y="41.2" width="104" height="8.4" rx="2.2" fill="#241e5e" stroke="#4b3fa0" strokeWidth="0.35" />
        <line x1="0" y1="42.7" x2="100" y2="42.7" stroke="#6d5fd0" strokeWidth="0.35" opacity="0.55" />
        <ConveyorChevrons />

        {/* spotlight beam + pool of light */}
        <polygon points="67,0 81,0 89,46.5 59,46.5" fill={`url(#${idPrefix}Beam)`} pointerEvents="none" />
        <ellipse cx={SLOT_X[0]} cy={FEET_Y + 0.8} rx="13" ry="3.6" fill={`url(#${idPrefix}Glow)`} />

        {/* slot marks + labels */}
        {[1, 2, 3].map((k) => (
          <SlotMark key={k} k={k} active={k === n} />
        ))}
        <g>
          <rect x={SLOT_X[0] - 5.5} y={51} width="11" height="4.4" rx="2.2" fill="#0f0c33" opacity="0.8" />
          <text
            x={SLOT_X[0]}
            y={53.2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="2.6"
            fontWeight="800"
            fill="#fde68a"
          >
            NOW
          </text>
        </g>

        {/* actors */}
        <AnimatePresence initial={false}>
          {animals.map((a) => (
            <AnimalActor key={a.key} a={a} reveal={reveal} />
          ))}
        </AnimatePresence>

        {/* watch hint during the first n steps */}
        {watching && (
          <motion.text
            x={SLOT_X[0]}
            y={22}
            textAnchor="middle"
            fontSize="3.4"
            fontWeight="800"
            fill="#e9e4ff"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            just watch…
          </motion.text>
        )}

        {/* floating score pings */}
        <g pointerEvents="none">
          {pings.map((p) => (
            <PingGlyph key={p.id} p={p} />
          ))}
        </g>

        {extras}
      </svg>
    </div>
  );
}

function ConveyorChevrons() {
  const xs: number[] = [];
  for (let x = -12; x <= 112; x += 8) xs.push(x);
  return (
    <motion.g
      opacity={0.4}
      animate={{ x: [0, -8] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
    >
      {xs.map((x) => (
        <path
          key={x}
          d={`M ${x} 43.6 l 2.6 1.8 l -2.6 1.8`}
          stroke="#8b83c9"
          strokeWidth="0.5"
          fill="none"
        />
      ))}
    </motion.g>
  );
}

/** History slot podium — the N-back one glows gold and carries the label. */
function SlotMark({ k, active }: { k: number; active: boolean }) {
  const x = SLOT_X[k];
  return (
    <g>
      <ellipse cx={x} cy={FEET_Y + 0.8} rx="7" ry="1.9" fill="#0f0c33" opacity="0.5" />
      {active && (
        <motion.ellipse
          cx={x}
          cy={FEET_Y + 0.8}
          rx="7.8"
          ry="2.3"
          fill="none"
          stroke="#fbbf24"
          strokeWidth="0.7"
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {active ? (
        <g>
          <rect x={x - 7} y={51} width="14" height="4.4" rx="2.2" fill="#0f0c33" opacity="0.85" stroke="#fbbf24" strokeWidth="0.3" />
          <text
            x={x}
            y={53.2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="2.6"
            fontWeight="800"
            fill="#fde68a"
          >
            {k} BACK
          </text>
        </g>
      ) : (
        <text
          x={x}
          y={53.2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="2.4"
          fontWeight="700"
          fill="#8b83c9"
          opacity="0.8"
        >
          {k} back
        </text>
      )}
    </g>
  );
}

/* ---------------- Actors ---------------- */

function AnimalActor({ a, reveal }: { a: SceneAnimal; reveal: Reveal }) {
  const x = SLOT_X[Math.min(a.offset, 3)];
  const revealed = reveal !== null && reveal.offset === a.offset && a.offset > 0;
  return (
    <motion.g
      initial={{ x: 106, opacity: 1 }}
      animate={{ x, opacity: a.offset >= 3 ? 0.7 : 1 }}
      exit={{ x: -4, opacity: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 26 }}
    >
      <motion.g
        style={styleOrigin("50% 100%")}
        animate={{ scale: a.offset === 0 ? 1 : 0.88 }}
        transition={{ duration: 0.3 }}
      >
        <g transform={`translate(0 ${FEET_Y})`}>
          <ellipse cx="0" cy="0.9" rx="5.6" ry="1.4" fill="#0f0c33" opacity="0.4" />
          <IdleBounce seed={a.key}>
            <AnimalArt kind={a.kind} />
          </IdleBounce>
          {a.hidden && (
            <motion.g
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: revealed ? 0.12 : 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
              style={styleOrigin("50% 100%")}
            >
              <CrateArt />
            </motion.g>
          )}
          {revealed && (
            <motion.ellipse
              cx="0"
              cy="0.9"
              rx="7"
              ry="2"
              fill="none"
              stroke={reveal.ok ? "#34d399" : "#fb7185"}
              strokeWidth="0.8"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{ duration: REVEAL_MS / 1000, times: [0, 0.2, 0.8, 1] }}
            />
          )}
        </g>
      </motion.g>
    </motion.g>
  );
}

function IdleBounce({ seed, children }: { seed: number; children: React.ReactNode }) {
  const dur = 1.3 + (seed % 4) * 0.17;
  return (
    <motion.g
      animate={{ y: [0, -0.7, 0] }}
      transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.g>
  );
}

/* ---------------- Animal art ----------------
   Drawn in local space: feet on y=0, up is -y. One blob style for all six. */

const ANIMAL_COLORS: Record<AnimalKind, { body: string; dark: string; belly: string }> = {
  cat: { body: "#fb923c", dark: "#c2410c", belly: "#fed7aa" },
  dog: { body: "#c08a52", dark: "#7c4f24", belly: "#e8c9a0" },
  rabbit: { body: "#cbd5e1", dark: "#64748b", belly: "#f1f5f9" },
  duck: { body: "#fde047", dark: "#ca8a04", belly: "#fef9c3" },
  pig: { body: "#f9a8d4", dark: "#db2777", belly: "#fbcfe8" },
  frog: { body: "#4ade80", dark: "#15803d", belly: "#bbf7d0" },
};

function AnimalArt({ kind }: { kind: AnimalKind }) {
  const c = ANIMAL_COLORS[kind];
  const squat = kind === "frog";
  const bodyCy = squat ? -5.8 : -6.6;
  const bodyRx = squat ? 5.9 : 5.3;
  const bodyRy = squat ? 4.6 : 5.2;
  return (
    <g>
      {/* legs */}
      <rect x={-3.4} y={-3} width={2.1} height={3.3} rx={1} fill={c.dark} />
      <rect x={1.3} y={-3} width={2.1} height={3.3} rx={1} fill={c.dark} />
      {kind === "duck" && (
        <g fill="#fb923c">
          <polygon points="-4.2,0.3 -0.8,0.3 -2.4,1.5" />
          <polygon points="0.7,0.3 4.1,0.3 2.4,1.5" />
        </g>
      )}

      {/* ears behind the body */}
      {kind === "cat" && (
        <g>
          <path d="M -4.4 -9.6 L -3.3 -13.7 L -1.4 -10.6 Z" fill={c.body} stroke={c.dark} strokeWidth="0.35" />
          <path d="M 4.4 -9.6 L 3.3 -13.7 L 1.4 -10.6 Z" fill={c.body} stroke={c.dark} strokeWidth="0.35" />
          <path d="M -3.7 -10.5 L -3.3 -12.5 L -2.4 -10.9 Z" fill="#fda4af" />
          <path d="M 3.7 -10.5 L 3.3 -12.5 L 2.4 -10.9 Z" fill="#fda4af" />
        </g>
      )}
      {kind === "rabbit" && (
        <g>
          <ellipse cx={-1.9} cy={-13} rx={1.3} ry={3.7} fill={c.body} stroke={c.dark} strokeWidth="0.35" transform="rotate(-8 -1.9 -13)" />
          <ellipse cx={1.9} cy={-13} rx={1.3} ry={3.7} fill={c.body} stroke={c.dark} strokeWidth="0.35" transform="rotate(8 1.9 -13)" />
          <ellipse cx={-1.9} cy={-12.7} rx={0.6} ry={2.4} fill="#fbcfe8" transform="rotate(-8 -1.9 -12.7)" />
          <ellipse cx={1.9} cy={-12.7} rx={0.6} ry={2.4} fill="#fbcfe8" transform="rotate(8 1.9 -12.7)" />
        </g>
      )}
      {kind === "pig" && (
        <g>
          <path d="M -4.6 -9.8 L -3.6 -13.1 L -1.7 -10.7 Z" fill={c.body} stroke={c.dark} strokeWidth="0.35" />
          <path d="M 4.6 -9.8 L 3.6 -13.1 L 1.7 -10.7 Z" fill={c.body} stroke={c.dark} strokeWidth="0.35" />
        </g>
      )}

      {/* body blob + belly */}
      <ellipse cx={0} cy={bodyCy} rx={bodyRx} ry={bodyRy} fill={c.body} stroke={c.dark} strokeWidth="0.4" />
      <ellipse cx={0} cy={bodyCy + 1.7} rx={bodyRx * 0.6} ry={bodyRy * 0.52} fill={c.belly} opacity="0.9" />

      {/* dog's floppy ears hang over the body */}
      {kind === "dog" && (
        <g fill="#8a5a2b" stroke={c.dark} strokeWidth="0.3">
          <ellipse cx={-4.4} cy={-8.6} rx={1.5} ry={2.9} transform="rotate(24 -4.4 -8.6)" />
          <ellipse cx={4.4} cy={-8.6} rx={1.5} ry={2.9} transform="rotate(-24 4.4 -8.6)" />
        </g>
      )}
      {/* duck's wing bumps + head tuft */}
      {kind === "duck" && (
        <g>
          <ellipse cx={-4.6} cy={-6} rx={1.2} ry={2.1} fill="#facc15" stroke={c.dark} strokeWidth="0.3" transform="rotate(14 -4.6 -6)" />
          <ellipse cx={4.6} cy={-6} rx={1.2} ry={2.1} fill="#facc15" stroke={c.dark} strokeWidth="0.3" transform="rotate(-14 4.6 -6)" />
          <path d="M -0.8 -11.5 Q -0.2 -13.2 0.7 -11.7" fill="none" stroke={c.dark} strokeWidth="0.4" strokeLinecap="round" />
        </g>
      )}

      {/* eyes */}
      {kind === "frog" ? (
        <g>
          <circle cx={-2.7} cy={-10.4} r={1.6} fill={c.body} stroke={c.dark} strokeWidth="0.35" />
          <circle cx={2.7} cy={-10.4} r={1.6} fill={c.body} stroke={c.dark} strokeWidth="0.35" />
          <circle cx={-2.7} cy={-10.6} r={0.95} fill="#ffffff" />
          <circle cx={2.7} cy={-10.6} r={0.95} fill="#ffffff" />
          <circle cx={-2.5} cy={-10.6} r={0.5} fill="#1e1b4b" />
          <circle cx={2.9} cy={-10.6} r={0.5} fill="#1e1b4b" />
        </g>
      ) : (
        <g>
          <circle cx={-1.9} cy={-8.2} r={1.05} fill="#ffffff" />
          <circle cx={1.9} cy={-8.2} r={1.05} fill="#ffffff" />
          <circle cx={-1.75} cy={-8.25} r={0.5} fill="#1e1b4b" />
          <circle cx={2.05} cy={-8.25} r={0.5} fill="#1e1b4b" />
        </g>
      )}

      {/* faces */}
      {kind === "cat" && (
        <g>
          <path d="M -0.55 -7.2 L 0.55 -7.2 L 0 -6.5 Z" fill={c.dark} />
          <path d="M 0 -6.5 Q 0.9 -5.7 1.8 -6.4" fill="none" stroke={c.dark} strokeWidth="0.3" strokeLinecap="round" />
          <path d="M 0 -6.5 Q -0.9 -5.7 -1.8 -6.4" fill="none" stroke={c.dark} strokeWidth="0.3" strokeLinecap="round" />
          <g stroke={c.dark} strokeWidth="0.25" opacity="0.7">
            <line x1="2.8" y1="-7" x2="5.2" y2="-7.4" />
            <line x1="2.8" y1="-6.4" x2="5.2" y2="-6.2" />
            <line x1="-2.8" y1="-7" x2="-5.2" y2="-7.4" />
            <line x1="-2.8" y1="-6.4" x2="-5.2" y2="-6.2" />
          </g>
        </g>
      )}
      {kind === "dog" && (
        <g>
          <ellipse cx={0} cy={-6.6} rx={2.4} ry={1.8} fill={c.belly} />
          <ellipse cx={0} cy={-7.4} rx={0.9} ry={0.7} fill="#3b2a17" />
          <path d="M 0 -6.7 L 0 -6 M 0 -6 Q 0.9 -5.2 1.7 -5.9 M 0 -6 Q -0.9 -5.2 -1.7 -5.9" fill="none" stroke="#3b2a17" strokeWidth="0.3" strokeLinecap="round" />
        </g>
      )}
      {kind === "rabbit" && (
        <g>
          <path d="M -0.5 -7.3 L 0.5 -7.3 L 0 -6.7 Z" fill="#f472b6" />
          <rect x={-0.9} y={-6.7} width={1.8} height={1.7} rx={0.3} fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.2" />
          <line x1="0" y1="-6.7" x2="0" y2="-5" stroke="#cbd5e1" strokeWidth="0.25" />
        </g>
      )}
      {kind === "duck" && (
        <ellipse cx={0} cy={-7.1} rx={2} ry={1.1} fill="#fb923c" stroke="#c2410c" strokeWidth="0.3" />
      )}
      {kind === "pig" && (
        <g>
          <ellipse cx={0} cy={-7} rx={2.1} ry={1.5} fill="#f472b6" stroke={c.dark} strokeWidth="0.35" />
          <ellipse cx={-0.7} cy={-7} rx={0.3} ry={0.5} fill={c.dark} />
          <ellipse cx={0.7} cy={-7} rx={0.3} ry={0.5} fill={c.dark} />
        </g>
      )}
      {kind === "frog" && (
        <path d="M -2.8 -4.9 Q 0 -3.2 2.8 -4.9" fill="none" stroke={c.dark} strokeWidth="0.45" strokeLinecap="round" />
      )}

      {/* blush */}
      {kind !== "pig" && (
        <g fill="#fb7185" opacity="0.35">
          <circle cx={-3.2} cy={squat ? -5.6 : -6.3} r={0.75} />
          <circle cx={3.2} cy={squat ? -5.6 : -6.3} r={0.75} />
        </g>
      )}
    </g>
  );
}

/** Wooden crate the history animals hide inside from level 2. */
function CrateArt() {
  return (
    <g>
      <rect x={-6} y={-11.8} width={12} height={11.8} rx={0.8} fill="#b3813f" stroke="#6b4318" strokeWidth="0.5" />
      <rect x={-6} y={-11.8} width={12} height={2.6} rx={0.8} fill="#caa05c" />
      <rect x={-6} y={-2.6} width={12} height={2.6} fill="#93672c" opacity="0.85" />
      <line x1="-6" y1="-9.2" x2="6" y2="-9.2" stroke="#6b4318" strokeWidth="0.35" />
      <line x1="-6" y1="-2.6" x2="6" y2="-2.6" stroke="#6b4318" strokeWidth="0.35" />
      <rect x={-6} y={-11.8} width={1.5} height={11.8} fill="#93672c" opacity="0.6" />
      <rect x={4.5} y={-11.8} width={1.5} height={11.8} fill="#93672c" opacity="0.6" />
      <g fill="#6b4318">
        <circle cx={-5.2} cy={-11} r={0.28} />
        <circle cx={5.2} cy={-11} r={0.28} />
        <circle cx={-5.2} cy={-0.9} r={0.28} />
        <circle cx={5.2} cy={-0.9} r={0.28} />
      </g>
      <g fill="#3f2a12">
        <circle cx={-2} cy={-10.5} r={0.4} />
        <circle cx={0} cy={-10.5} r={0.4} />
        <circle cx={2} cy={-10.5} r={0.4} />
      </g>
      <text
        x={0}
        y={-5.6}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="5"
        fontWeight="900"
        fill="#fef3c7"
      >
        ?
      </text>
    </g>
  );
}

/* ---------------- Floating score pings ---------------- */

function PingGlyph({ p }: { p: Ping }) {
  const color = p.tone === "ok" ? "#10b981" : p.tone === "bad" ? "#f43f5e" : "#f59e0b";
  const edge = p.tone === "ok" ? "#047857" : p.tone === "bad" ? "#be123c" : "#b45309";
  const w = 6.5 + p.text.length * 2.7;
  return (
    <g>
      <motion.circle
        cx={p.x}
        cy={p.y + 6}
        r={2}
        fill="none"
        stroke={color}
        strokeWidth="0.7"
        style={styleOrigin("50% 50%")}
        initial={{ opacity: 0.8, scale: 0.4 }}
        animate={{ opacity: 0, scale: 3.4 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      <motion.g
        initial={{ opacity: 0, y: 0, scale: 0.6 }}
        animate={{ opacity: [0, 1, 1, 0], y: -9, scale: [0.6, 1.15, 1, 1] }}
        transition={{ duration: PING_LIFE_MS / 1000, times: [0, 0.15, 0.72, 1] }}
      >
        <rect x={p.x - w / 2} y={p.y - 3.2} width={w} height={6.4} rx={3.2} fill={color} stroke={edge} strokeWidth="0.4" />
        <text
          x={p.x}
          y={p.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="3.6"
          fontWeight="900"
          fill="#ffffff"
        >
          {p.text}
        </text>
      </motion.g>
    </g>
  );
}

/* ---------------- Tutorial ghost arrow ---------------- */

/** Dashed arrow arcing from the spotlight animal back to the N-back slot,
 *  followed by a green flash on the slot — "compare these two". */
function GhostArrow({ n }: { n: number }) {
  const x0 = SLOT_X[0] - 3;
  const x1 = SLOT_X[n] + 3;
  const midX = (x0 + x1) / 2;
  const d = `M ${x0} 27 Q ${midX} ${10 - n} ${x1} 27`;
  return (
    <g pointerEvents="none">
      <motion.path
        d={d}
        fill="none"
        stroke="#fde68a"
        strokeWidth="0.9"
        strokeLinecap="round"
        strokeDasharray="2 1.4"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
      />
      <motion.polygon
        points={`${x1 - 1.5},${25.8} ${x1 + 1.5},${25.8} ${x1},${28.6}`}
        fill="#fde68a"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.65, duration: 0.15 }}
      />
      <motion.ellipse
        cx={SLOT_X[n]}
        cy={FEET_Y + 0.8}
        rx="7.6"
        ry="2.2"
        fill="none"
        stroke="#34d399"
        strokeWidth="0.9"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ delay: 0.8, duration: 1, times: [0, 0.2, 0.7, 1] }}
      />
    </g>
  );
}

/* ================================================================
   Tutorial demos — same SVG pieces, auto-playing
   ================================================================ */

const WALK_SEQ: AnimalKind[] = ["cat", "duck", "frog", "rabbit", "pig", "dog"];

function DemoWalk() {
  const [step, setStep] = useState(2);
  useEffect(() => {
    const id = window.setInterval(() => setStep((s) => s + 1), 1400);
    return () => window.clearInterval(id);
  }, []);
  const animals: SceneAnimal[] = [];
  for (let i = Math.max(0, step - 3); i <= step; i++) {
    animals.push({
      key: i,
      kind: WALK_SEQ[i % WALK_SEQ.length],
      offset: step - i,
      hidden: false,
    });
  }
  return (
    <ParadeScene idPrefix="dw" n={1} animals={animals} reveal={null} pings={[]} />
  );
}

/** Static tableau with a repeating "compare → match!" animation cycle. */
function DemoMatch({ n, hide }: { n: 1 | 2; hide: boolean }) {
  const [cycle, setCycle] = useState(0);
  const [fired, setFired] = useState(false);
  useEffect(() => {
    const iv = window.setInterval(() => setCycle((c) => c + 1), 3200);
    return () => window.clearInterval(iv);
  }, []);
  useEffect(() => {
    setFired(false);
    const t = window.setTimeout(() => setFired(true), 950);
    return () => window.clearTimeout(t);
  }, [cycle]);

  const animals: SceneAnimal[] =
    n === 1
      ? [
          { key: 0, kind: "cat", offset: 2, hidden: false },
          { key: 1, kind: "duck", offset: 1, hidden: false },
          { key: 2, kind: "duck", offset: 0, hidden: false },
        ]
      : [
          { key: 0, kind: "pig", offset: 2, hidden: hide },
          { key: 1, kind: "cat", offset: 1, hidden: hide },
          { key: 2, kind: "pig", offset: 0, hidden: false },
        ];

  return (
    <div className="space-y-2">
      <ParadeScene
        idPrefix={`dm${n}`}
        n={n}
        animals={animals}
        reveal={fired && hide ? { offset: n, ok: true } : null}
        pings={[]}
        extras={
          <g key={cycle}>
            <GhostArrow n={n} />
            {fired && (
              <PingGlyph
                p={{ id: cycle, x: SLOT_X[0], y: 24, text: `+${POINTS_HIT}`, tone: "ok", born: 0 }}
              />
            )}
          </g>
        }
      />
      <p className="text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        {hide
          ? "The crate two back hides the same pig → Match!"
          : "Duck now, duck one back → Match!"}
      </p>
    </div>
  );
}

function DemoButton() {
  const animals: SceneAnimal[] = [
    { key: 0, kind: "rabbit", offset: 1, hidden: false },
    { key: 1, kind: "frog", offset: 0, hidden: false },
  ];
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <ParadeScene idPrefix="db" n={1} animals={animals} reveal={null} pings={[]} />
      <div className="relative">
        <div
          className="btn-primary pointer-events-none w-full min-h-[52px] text-lg opacity-95"
          aria-hidden
        >
          Match
        </div>
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 ring-2 ring-white"
          animate={{ scale: [0, 1, 0.85, 0], opacity: [0, 0.9, 0.9, 0] }}
          transition={{ duration: 1.7, repeat: Infinity, repeatDelay: 0.5, ease: "easeInOut" }}
          aria-hidden
        />
      </div>
      <div className="flex justify-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
          match tapped +{POINTS_HIT}
        </span>
        <span className="rounded-full bg-rose-100 px-3 py-1 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
          wrong tap {POINTS_FALSE_ALARM}
        </span>
      </div>
    </div>
  );
}

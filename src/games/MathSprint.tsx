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

type Op = "+" | "-" | "×" | "÷";

type Problem = {
  a: number;
  b: number;
  op: Op;
  answer: number;
  text: string;
  choices: number[]; // only populated for choice-mode levels
};

type InputMode = "choice" | "typed";

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  /** The one new mechanic this level introduces — shown between levels. */
  twist: string;
  requiredCorrect: number;
  inputMode: InputMode;
  points: number; // per correct answer
  make: () => Omit<Problem, "choices">;
};

const SESSION_SECONDS = 180; // 3-minute session
const WRONG_PENALTY_S = 3;
const LEVEL_CLEAR_BONUS = 10;

/* ------------------------------------------------------------------ *
 *  Scoring — tuned to the 240-pt anchor in src/lib/scoring.ts:
 *  L1 5×6 + L2 5×7 + L3 6×9 + L4 6×11 = 185 correct pts
 *  + 4 × 10 clear bonus = 225
 *  + ~15–20 s early-finish bonus for a strong-but-human run ≈ 240–245.
 * ------------------------------------------------------------------ */

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function reversedDigits(n: number): number {
  const s = String(Math.abs(n));
  const r = s.split("").reverse().join("");
  return parseInt(r, 10); // drops leading zeros
}

/** Build 4 unique choices (correct + 3 close distractors). */
function buildChoices(correct: number): number[] {
  const pool = new Set<number>();
  pool.add(correct);

  // Swapped-digits: meaningful when answer has 2+ digits and reverse differs
  if (correct >= 10) {
    const swapped = reversedDigits(correct);
    if (swapped !== correct && swapped >= 0) pool.add(swapped);
  }

  const offsets = [1, -1, 2, -2, 10, -10, 3, -3, 11, -11, 20, -20];
  for (const o of offsets) {
    if (pool.size >= 4) break;
    const v = correct + o;
    if (v < 0) continue;
    pool.add(v);
  }

  // fallback in pathological cases
  while (pool.size < 4) {
    pool.add(correct + pool.size + 3);
  }

  const arr = Array.from(pool).slice(0, 4);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* --------------- level problem generators --------------- */

/** L1 · Lift-off — single-digit add/sub, never negative. */
function makeSingleDigit(): Omit<Problem, "choices"> {
  const op: Op = Math.random() < 0.5 ? "+" : "-";
  let a: number, b: number;
  if (op === "+") {
    a = randInt(1, 9);
    b = randInt(1, 9);
    return { a, b, op, answer: a + b, text: `${a} + ${b}` };
  }
  a = randInt(3, 9);
  b = randInt(1, a);
  return { a, b, op, answer: a - b, text: `${a} − ${b}` };
}

/** L2 · Into the clouds — two-digit add/sub. */
function makeTwoDigit(): Omit<Problem, "choices"> {
  const op: Op = Math.random() < 0.5 ? "+" : "-";
  if (op === "+") {
    const a = randInt(11, 49);
    const b = randInt(11, 49);
    return { a, b, op, answer: a + b, text: `${a} + ${b}` };
  }
  const a = randInt(25, 99);
  const b = randInt(11, a - 1);
  return { a, b, op, answer: a - b, text: `${a} − ${b}` };
}

/** L3 · Stratosphere — multiplication & division tables. */
function makeTables(): Omit<Problem, "choices"> {
  if (Math.random() < 0.6) {
    const a = randInt(2, 12);
    const b = randInt(2, 12);
    return { a, b, op: "×", answer: a * b, text: `${a} × ${b}` };
  }
  const b = randInt(2, 12);
  const q = randInt(2, 12);
  const a = b * q;
  return { a, b, op: "÷", answer: q, text: `${a} ÷ ${b}` };
}

/** L4 · To the moon — everything mixed, typed answers. */
function makeMoonMix(): Omit<Problem, "choices"> {
  const r = Math.random();
  if (r < 0.3) {
    // bigger add/sub
    const op: Op = Math.random() < 0.5 ? "+" : "-";
    if (op === "+") {
      const a = randInt(25, 99);
      const b = randInt(25, 99);
      return { a, b, op, answer: a + b, text: `${a} + ${b}` };
    }
    const a = randInt(40, 150);
    const b = randInt(15, a - 1);
    return { a, b, op, answer: a - b, text: `${a} − ${b}` };
  }
  if (r < 0.6) {
    // 2-digit × 1-digit
    const a = randInt(12, 24);
    const b = randInt(3, 9);
    return { a, b, op: "×", answer: a * b, text: `${a} × ${b}` };
  }
  if (r < 0.8) {
    // upper times tables
    const a = randInt(6, 12);
    const b = randInt(6, 12);
    return { a, b, op: "×", answer: a * b, text: `${a} × ${b}` };
  }
  const b = randInt(3, 12);
  const q = randInt(3, 19);
  const a = b * q;
  return { a, b, op: "÷", answer: q, text: `${a} ÷ ${b}` };
}

const LEVELS: Level[] = [
  {
    id: 1,
    name: "Lift-off",
    twist: "single digits",
    requiredCorrect: 5,
    inputMode: "choice",
    points: 6,
    make: makeSingleDigit,
  },
  {
    id: 2,
    name: "Into the clouds",
    twist: "two-digit sums",
    requiredCorrect: 5,
    inputMode: "choice",
    points: 7,
    make: makeTwoDigit,
  },
  {
    id: 3,
    name: "Stratosphere",
    twist: "times tables ×÷",
    requiredCorrect: 6,
    inputMode: "choice",
    points: 9,
    make: makeTables,
  },
  {
    id: 4,
    name: "To the moon",
    twist: "type the answer",
    requiredCorrect: 6,
    inputMode: "typed",
    points: 11,
    make: makeMoonMix,
  },
];

/** Correct answers banked before each level starts (notches on the track). */
const CUM_BEFORE = [0, 5, 10, 16];
const TOTAL_NOTCHES = 22; // 5 + 5 + 6 + 6
const NOTCH = 8; // world units per notch
/** World-space y of the rocket after n correct answers (ground ≈ 200). */
const rocketWorldY = (n: number) => 190 - n * NOTCH;

type MilestoneKind = "cloud" | "plane" | "sat" | "moon";
const MILESTONES: { n: number; kind: MilestoneKind; label: string }[] = [
  { n: 5, kind: "cloud", label: "Clouds" },
  { n: 10, kind: "plane", label: "Jet stream" },
  { n: 16, kind: "sat", label: "Orbit" },
  { n: 22, kind: "moon", label: "The Moon" },
];

/** Deterministic star field near the top of the climb (SSR-safe). */
const STARS = Array.from({ length: 24 }, (_, i) => ({
  x: 3 + ((i * 37) % 94),
  y: -34 + ((i * 53) % 122),
  r: 0.35 + ((i * 29) % 10) / 16,
  dur: 1.8 + ((i * 13) % 22) / 10,
  delay: (i % 6) * 0.35,
}));

/** Deterministic cloud bank in the lower/middle sky. */
const CLOUDS = [
  { x: 66, y: 176, s: 1.15, drift: 5, dur: 11 },
  { x: 34, y: 160, s: 0.85, drift: -4, dur: 13 },
  { x: 82, y: 142, s: 1.0, drift: -6, dur: 15 },
  { x: 46, y: 126, s: 0.75, drift: 4, dur: 12 },
  { x: 74, y: 108, s: 0.6, drift: 6, dur: 14 },
  { x: 30, y: 96, s: 0.5, drift: -3, dur: 16 },
];

type Ping = { id: number; text: string; ok: boolean; dx: number };
type Reveal = { text: string; answer: number };

function makeProblemForLevel(lvl: Level): Problem {
  const base = lvl.make();
  const choices = lvl.inputMode === "choice" ? buildChoices(base.answer) : [];
  return { ...base, choices };
}

const pivot = (origin: string): React.CSSProperties =>
  ({ transformOrigin: origin, transformBox: "fill-box" } as React.CSSProperties);

export default function MathSprint() {
  const game = getGame("math");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [problem, setProblem] = useState<Problem>(() =>
    makeProblemForLevel(LEVELS[0])
  );
  const [input, setInput] = useState("");
  const [levelCorrect, setLevelCorrect] = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [score, setScore] = useState(0);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [pings, setPings] = useState<Ping[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [boostKey, setBoostKey] = useState(0);
  const [wobbleKey, setWobbleKey] = useState(0);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const [finalScore, setFinalScore] = useState(0);

  const deadlineRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scoreRef = useRef(0);
  const levelPointsRef = useRef(0);
  const clearedRef = useRef(0);
  const pingIdRef = useRef(0);
  const revealTimerRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);

  const currentLevel = LEVELS[levelIdx];
  const rocketN = CUM_BEFORE[levelIdx] + levelCorrect;

  /** setTimeout that is guaranteed to be cleaned up on unmount / restart. */
  const after = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  }, []);

  const stopTick = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  };

  useEffect(
    () => () => {
      stopTick();
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current = [];
    },
    []
  );

  const computeTimeLeft = () => {
    const ms = deadlineRef.current - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  };

  const end = useCallback(
    (clearedAllLevels: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopTick();
      let final = scoreRef.current;
      if (clearedAllLevels) {
        // early finish: remaining seconds become bonus points
        const remaining = Math.max(
          0,
          Math.floor((deadlineRef.current - Date.now()) / 1000)
        );
        final += remaining;
      }
      scoreRef.current = final;
      setScore(final);
      const { isBest: best } = recordPlay("math", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  const startLevel = useCallback(
    (idx: number) => {
      // The session can expire during the 1.1 s levelDone pause; never let a
      // queued level start resurrect a session that already ended.
      if (endedRef.current) return;
      const lvl = LEVELS[idx];
      setLevelIdx(idx);
      setLevelCorrect(0);
      levelPointsRef.current = 0;
      setProblem(makeProblemForLevel(lvl));
      setInput("");
      setPings([]);
      setReveal(null);
      setPhase("playing");
      if (lvl.inputMode === "typed") {
        after(() => inputRef.current?.focus(), 80);
      }
    },
    [after]
  );

  const begin = () => {
    // sweep anything scheduled by a previous session
    timeoutsRef.current.forEach((id) => window.clearTimeout(id));
    timeoutsRef.current = [];
    setLevelIdx(0);
    setLevelCorrect(0);
    setTotalCorrect(0);
    setWrong(0);
    setScore(0);
    scoreRef.current = 0;
    levelPointsRef.current = 0;
    clearedRef.current = 0;
    setInput("");
    setPings([]);
    setReveal(null);
    setFlash(null);
    setBoostKey(0);
    setWobbleKey(0);
    setTimeLeft(SESSION_SECONDS);
    endedRef.current = false;
    setLastCleared(0);
    setLastLevelScore(0);
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  const startSession = () => {
    deadlineRef.current = Date.now() + SESSION_SECONDS * 1000;
    setTimeLeft(SESSION_SECONDS);
    stopTick();
    tickRef.current = window.setInterval(() => {
      const left = computeTimeLeft();
      setTimeLeft(left);
      if (left <= 0) end(false);
    }, 200);
    startLevel(0);
  };

  const addPing = (text: string, ok: boolean) => {
    const id = ++pingIdRef.current;
    const dx = (Math.random() - 0.5) * 7;
    setPings((ps) => [...ps.slice(-4), { id, text, ok, dx }]);
    after(() => setPings((ps) => ps.filter((p) => p.id !== id)), 900);
  };

  const answerCorrect = () => {
    const lvl = LEVELS[levelIdx];
    const newLevelCorrect = levelCorrect + 1;
    setLevelCorrect(newLevelCorrect);
    setTotalCorrect((n) => n + 1);
    scoreRef.current += lvl.points;
    levelPointsRef.current += lvl.points;
    setScore(scoreRef.current);
    haptic.success();
    setBoostKey((k) => k + 1);
    addPing(`+${lvl.points}`, true);
    setReveal(null);
    setFlash("ok");
    after(() => setFlash(null), 220);

    if (newLevelCorrect >= lvl.requiredCorrect) {
      // milestone reached — level cleared
      scoreRef.current += LEVEL_CLEAR_BONUS;
      levelPointsRef.current += LEVEL_CLEAR_BONUS;
      setScore(scoreRef.current);
      clearedRef.current += 1;
      const nextIdx = levelIdx + 1;
      setLastCleared(lvl.id);
      setLastLevelScore(levelPointsRef.current);
      setPhase("levelDone");
      if (nextIdx >= LEVELS.length) {
        after(() => end(true), 1100);
      } else {
        after(() => startLevel(nextIdx), 1100);
      }
    } else {
      setProblem(makeProblemForLevel(lvl));
      setInput("");
      if (lvl.inputMode === "typed") {
        after(() => inputRef.current?.focus(), 30);
      }
    }
  };

  const answerWrong = () => {
    const lvl = LEVELS[levelIdx];
    setWrong((w) => w + 1);
    haptic.error();
    setWobbleKey((k) => k + 1);
    addPing(`−${WRONG_PENALTY_S}s`, false);
    setFlash("bad");
    after(() => setFlash(null), 300);

    // briefly show what the right answer was
    setReveal({ text: problem.text, answer: problem.answer });
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
    }
    revealTimerRef.current = after(() => setReveal(null), 1700);

    deadlineRef.current -= WRONG_PENALTY_S * 1000;
    const left = computeTimeLeft();
    setTimeLeft(left);
    if (left <= 0) {
      end(false);
      return;
    }
    setProblem(makeProblemForLevel(lvl));
    setInput("");
    if (lvl.inputMode === "typed") {
      after(() => inputRef.current?.focus(), 30);
    }
  };

  const onChoice = (n: number) => {
    if (phase !== "playing") return;
    if (n === problem.answer) answerCorrect();
    else answerWrong();
  };

  const onTypedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phase !== "playing") return;
    const v = input.trim();
    if (v === "") return;
    const parsed = Number(v);
    if (!Number.isFinite(parsed)) return;
    if (parsed === problem.answer) answerCorrect();
    else answerWrong();
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Tap the answer — every correct boost climbs your rocket one notch.",
      stage: <DemoBoost />,
      auto: 3600,
    },
    {
      caption:
        "Reach the milestone — cloud, plane, satellite, moon — to clear the level.",
      stage: <DemoMilestones />,
      auto: 4000,
    },
    {
      caption:
        "Wrong answers wobble the rocket, cost 3 seconds, and show the answer.",
      stage: <DemoWobble />,
      auto: 3800,
    },
    {
      caption: "Level 4: no buttons. Type the answer and press Enter.",
      stage: <DemoTyped />,
    },
  ];

  const problemKey = `${levelIdx}-${levelCorrect}-${wrong}-${problem.text}`;

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          One rocket, four stages, one 3-minute climb. Every correct answer
          boosts you up a notch: single digits at Lift-off, two-digit sums
          into the clouds, times tables through the stratosphere, then typed
          answers all the way to the moon. Wrong answers cost{" "}
          {WRONG_PENALTY_S}s — and finishing early converts leftover seconds
          into bonus points.
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
            <span>
              {currentLevel.name} · {currentLevel.twist}
            </span>
            <span data-testid="progress">
              {levelCorrect} / {currentLevel.requiredCorrect} boosts
            </span>
          </div>

          {phase === "levelDone" ? (
            <LevelComplete
              levelJustCleared={lastCleared}
              totalLevels={LEVELS.length}
              levelScore={lastLevelScore}
              nextLabel={
                LEVELS[lastCleared]
                  ? `${LEVELS[lastCleared].name} — ${LEVELS[lastCleared].twist}`
                  : undefined
              }
            />
          ) : (
            <>
              <ClimbScene
                rocketN={rocketN}
                boostKey={boostKey}
                wobbleKey={wobbleKey}
                pings={pings}
                flash={flash}
                problemText={problem.text}
                problemKey={problemKey}
                reveal={reveal}
              />

              {currentLevel.inputMode === "choice" ? (
                <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-2.5 sm:gap-3">
                  {problem.choices.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onChoice(n)}
                      data-testid="choice"
                      data-value={n}
                      className="min-h-[60px] rounded-2xl bg-white/95 text-2xl font-black tabular-nums text-slate-900 shadow-sm ring-1 ring-sky-200 transition hover:bg-sky-50 hover:ring-sky-300 active:scale-[0.97] dark:bg-slate-900 dark:text-white dark:ring-slate-700 dark:hover:bg-slate-800 sm:text-3xl"
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <form
                  onSubmit={onTypedSubmit}
                  className="mx-auto flex w-full max-w-xl gap-2"
                >
                  <input
                    ref={inputRef}
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9-]*"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Your answer"
                    aria-label="Your answer"
                    data-testid="typed-input"
                    className="min-h-[56px] w-0 flex-1 rounded-2xl bg-white px-4 text-2xl font-bold text-slate-900 ring-1 ring-sky-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-slate-900 dark:text-white dark:ring-slate-700"
                    autoFocus
                  />
                  <button type="submit" className="btn-primary min-h-[56px]">
                    Enter
                  </button>
                </form>
              )}
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
          detail={`${clearedRef.current} / ${LEVELS.length} stages · ${totalCorrect} boost${totalCorrect === 1 ? "" : "s"} · ${wrong} wobble${wrong === 1 ? "" : "s"}`}
        />
      )}
    </GameShell>
  );
}

/* ================= The climb scene ================= */

function ClimbScene({
  rocketN,
  boostKey,
  wobbleKey,
  pings,
  flash,
  problemText,
  problemKey,
  reveal,
}: {
  rocketN: number;
  boostKey: number;
  wobbleKey: number;
  pings: Ping[];
  flash: "ok" | "bad" | null;
  problemText: string;
  problemKey: string;
  reveal: Reveal | null;
}) {
  // Camera keeps the rocket at screen y=42; the world slides down as it climbs.
  const camY = 42 - rocketWorldY(rocketN);

  const cardCls =
    flash === "ok"
      ? "bg-emerald-100/95 ring-emerald-300 dark:bg-emerald-900/90 dark:ring-emerald-600"
      : flash === "bad"
      ? "bg-rose-100/95 ring-rose-300 dark:bg-rose-900/90 dark:ring-rose-600"
      : "bg-white/90 ring-white/70 dark:bg-slate-900/85 dark:ring-slate-700";

  return (
    <div
      className="relative mx-auto aspect-[100/58] w-full max-w-xl overflow-hidden rounded-3xl shadow-soft ring-1 ring-sky-900/25 dark:ring-slate-800"
      style={{ background: "#1d4ed8" }}
    >
      <svg
        viewBox="0 0 100 58"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <SkyDefs idPrefix="rc" />

        {/* -------- scrolling world -------- */}
        <motion.g
          initial={false}
          animate={{ y: camY }}
          transition={{ type: "spring", stiffness: 160, damping: 24 }}
        >
          {/* full ground → space gradient */}
          <rect x="0" y="-42" width="100" height="272" fill="url(#rcSky)" />

          {/* stars near the top of the climb */}
          <g>
            {STARS.map((s, i) => (
              <motion.circle
                key={i}
                cx={s.x}
                cy={s.y}
                r={s.r}
                fill="#f8fafc"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{
                  duration: s.dur,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: s.delay,
                }}
              />
            ))}
          </g>

          {/* the big destination moon */}
          <g transform="translate(80 8)">
            <circle r="9" fill="url(#rcMoon)" />
            <circle cx="-2.6" cy="-1.5" r="1.8" fill="#a1a1aa" opacity="0.5" />
            <circle cx="3" cy="2.5" r="1.2" fill="#a1a1aa" opacity="0.45" />
            <circle cx="1" cy="-4.5" r="0.9" fill="#a1a1aa" opacity="0.4" />
          </g>

          {/* drifting clouds */}
          <g pointerEvents="none">
            {CLOUDS.map((c, i) => (
              <g key={i} transform={`translate(${c.x} ${c.y}) scale(${c.s})`}>
                <motion.g
                  animate={{ x: [0, c.drift, 0] }}
                  transition={{
                    duration: c.dur,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  <CloudShape />
                </motion.g>
              </g>
            ))}
          </g>

          {/* a hot-air balloon bobbing in the cloud band */}
          <g transform="translate(70 162)">
            <motion.g
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              <path d="M 0 -6 C 4.4 -6 4.6 -0.6 0.9 2.6 L -0.9 2.6 C -4.6 -0.6 -4.4 -6 0 -6 Z" fill="#f472b6" />
              <path d="M 0 -6 C 1.6 -6 1.7 -0.8 0.4 2.6 L -0.4 2.6 C -1.7 -0.8 -1.6 -6 0 -6 Z" fill="#fbbf24" />
              <line x1="-0.9" y1="2.6" x2="-0.7" y2="4" stroke="#7c4f24" strokeWidth="0.3" />
              <line x1="0.9" y1="2.6" x2="0.7" y2="4" stroke="#7c4f24" strokeWidth="0.3" />
              <rect x="-1" y="4" width="2" height="1.5" rx="0.4" fill="#a16207" />
            </motion.g>
          </g>

          {/* climb track + notches */}
          <line
            x1="18"
            y1="8"
            x2="18"
            y2="196"
            stroke="#ffffff"
            strokeOpacity="0.25"
            strokeWidth="0.8"
            strokeDasharray="1.5 2.5"
          />
          {Array.from({ length: TOTAL_NOTCHES + 1 }, (_, k) => (
            <line
              key={k}
              x1="16.4"
              y1={rocketWorldY(k)}
              x2="19.6"
              y2={rocketWorldY(k)}
              stroke={k <= rocketN ? "#fbbf24" : "#ffffff"}
              strokeOpacity={k <= rocketN ? 0.95 : 0.4}
              strokeWidth="0.7"
              strokeLinecap="round"
            />
          ))}

          {/* milestone markers */}
          {MILESTONES.map((m) => {
            const wy = rocketWorldY(m.n);
            const reached = rocketN >= m.n;
            return (
              <g key={m.kind} transform={`translate(0 ${wy})`}>
                <line
                  x1="4"
                  y1="0"
                  x2="30"
                  y2="0"
                  stroke="#ffffff"
                  strokeOpacity={reached ? 0.55 : 0.28}
                  strokeWidth="0.5"
                  strokeDasharray="2 2"
                />
                <g transform="translate(9.5 -0.5)">
                  {reached && (
                    <motion.circle
                      r="5.4"
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="0.6"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: [0, 0.95, 0.5], scale: 1 }}
                      transition={{ duration: 0.7 }}
                      style={pivot("50% 50%")}
                    />
                  )}
                  <MilestoneIcon kind={m.kind} idPrefix="rc" />
                </g>
                <text
                  x="9.5"
                  y="7.2"
                  textAnchor="middle"
                  fontSize="2.8"
                  fontWeight="700"
                  fill="#ffffff"
                  opacity="0.8"
                >
                  {m.label}
                </text>
              </g>
            );
          })}

          {/* ground, hills and the launch pad */}
          <ellipse cx="30" cy="218" rx="58" ry="22" fill="url(#rcGround)" />
          <ellipse cx="82" cy="222" rx="52" ry="24" fill="#15803d" />
          <circle cx="46" cy="199.5" r="2" fill="#166534" />
          <circle cx="52" cy="200.5" r="2.6" fill="#15803d" />
          <circle cx="70" cy="199" r="2.2" fill="#166534" />
          <rect x="10.5" y="196.4" width="15" height="2.2" rx="1" fill="#64748b" />
          <rect x="12" y="198.4" width="1.6" height="3" fill="#475569" />
          <rect x="22.4" y="198.4" width="1.6" height="3" fill="#475569" />
          <rect x="26.5" y="181" width="2" height="15.6" fill="#94a3b8" />
          <line x1="26.5" y1="185" x2="23" y2="188" stroke="#94a3b8" strokeWidth="0.7" />
          <line x1="26.5" y1="190" x2="23" y2="193" stroke="#94a3b8" strokeWidth="0.7" />
        </motion.g>

        {/* -------- the rocket (camera-fixed) -------- */}
        <g
          data-testid="rocket"
          data-notch={rocketN}
          transform="translate(18 42) scale(0.8)"
        >
          <motion.g
            key={`hop-${boostKey}`}
            animate={boostKey > 0 ? { y: [0, -4, 0] } : { y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <motion.g
              key={`wob-${wobbleKey}`}
              animate={wobbleKey > 0 ? { rotate: [0, -9, 8, -5, 4, 0] } : { rotate: 0 }}
              transition={{ duration: 0.55 }}
              style={pivot("50% 45%")}
            >
              <motion.g
                animate={{ y: [0, -1.3, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
              >
                <RocketArt idPrefix="rc" />
              </motion.g>
            </motion.g>
          </motion.g>
        </g>

        {/* boost burst — exhaust ring + speed streaks */}
        {boostKey > 0 && (
          <motion.g
            key={`burst-${boostKey}`}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            pointerEvents="none"
          >
            <motion.circle
              cx="18"
              cy="52"
              r="2.6"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1"
              initial={{ scale: 0.5, opacity: 0.9 }}
              animate={{ scale: 3.4, opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              style={pivot("50% 50%")}
            />
            {[13, 18, 23].map((x, i) => (
              <motion.line
                key={x}
                x1={x}
                y1={49}
                x2={x}
                y2={54}
                stroke="#fde68a"
                strokeWidth="0.8"
                strokeLinecap="round"
                initial={{ opacity: 0.9, y: 0 }}
                animate={{ opacity: 0, y: 7 }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
              />
            ))}
          </motion.g>
        )}

        {/* floating score pings beside the rocket */}
        <g pointerEvents="none">
          {pings.map((p) => {
            const w = 7 + p.text.length * 2.7;
            return (
              <g key={p.id} transform={`translate(${21 + p.dx} 31)`}>
                <motion.g
                  initial={{ opacity: 0, y: 3, scale: 0.6 }}
                  animate={{
                    opacity: [0, 1, 1, 0],
                    y: -11,
                    scale: [0.6, 1.15, 1, 1],
                  }}
                  transition={{ duration: 0.85, times: [0, 0.15, 0.7, 1] }}
                >
                  <rect
                    x={-w / 2}
                    y={-4}
                    width={w}
                    height={8}
                    rx={4}
                    fill={p.ok ? "#10b981" : "#f43f5e"}
                    stroke={p.ok ? "#047857" : "#be123c"}
                    strokeWidth="0.4"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="4.4"
                    fontWeight="900"
                    fill="#ffffff"
                  >
                    {p.text}
                  </text>
                </motion.g>
              </g>
            );
          })}
        </g>
      </svg>

      {/* -------- problem card overlay -------- */}
      <div className="pointer-events-none absolute inset-y-0 left-[30%] right-2 flex items-center sm:right-4">
        <div
          className={
            "w-full rounded-2xl px-3 py-3 text-center shadow-soft ring-1 backdrop-blur-sm transition-colors sm:py-4 " +
            cardCls
          }
        >
          <AnimatePresence mode="wait">
            <motion.p
              key={problemKey}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.13 }}
              className="text-2xl font-black tabular-nums text-slate-900 dark:text-white sm:text-4xl"
              aria-live="polite"
              data-testid="problem"
            >
              {problemText} = ?
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      {/* -------- wrong-answer reveal -------- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <AnimatePresence>
          {reveal && (
            <motion.div
              key={`${reveal.text}=${reveal.answer}`}
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="rounded-full bg-rose-500/95 px-3.5 py-1 text-xs font-bold text-white shadow-soft sm:text-sm"
              role="status"
            >
              ✗ {reveal.text} = {reveal.answer} · −{WRONG_PENALTY_S}s
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ================= Shared SVG pieces ================= */

function SkyDefs({ idPrefix }: { idPrefix: string }) {
  return (
    <defs>
      {/* the full climb: warm ground light → sky blue → deep space */}
      <linearGradient id={`${idPrefix}Sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#020617" />
        <stop offset="18%" stopColor="#0f1e4d" />
        <stop offset="38%" stopColor="#1d4ed8" />
        <stop offset="62%" stopColor="#38bdf8" />
        <stop offset="82%" stopColor="#7dd3fc" />
        <stop offset="94%" stopColor="#fef3c7" />
        <stop offset="100%" stopColor="#fde68a" />
      </linearGradient>
      <linearGradient id={`${idPrefix}Ground`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#4ade80" />
        <stop offset="100%" stopColor="#15803d" />
      </linearGradient>
      <linearGradient id={`${idPrefix}Body`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="60%" stopColor="#e2e8f0" />
        <stop offset="100%" stopColor="#94a3b8" />
      </linearGradient>
      <linearGradient id={`${idPrefix}Flame`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="55%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#ef4444" />
      </linearGradient>
      <radialGradient id={`${idPrefix}Window`} cx="0.35" cy="0.3" r="0.9">
        <stop offset="0%" stopColor="#e0f2fe" />
        <stop offset="100%" stopColor="#38bdf8" />
      </radialGradient>
      <radialGradient id={`${idPrefix}Moon`} cx="0.35" cy="0.3" r="0.95">
        <stop offset="0%" stopColor="#fefce8" />
        <stop offset="60%" stopColor="#e4e4e7" />
        <stop offset="100%" stopColor="#a1a1aa" />
      </radialGradient>
      {/* fixed mid-sky / space bands for the tutorial demos */}
      <linearGradient id={`${idPrefix}DemoSky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1d4ed8" />
        <stop offset="60%" stopColor="#38bdf8" />
        <stop offset="100%" stopColor="#bae6fd" />
      </linearGradient>
      <linearGradient id={`${idPrefix}DemoSpace`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#020617" />
        <stop offset="45%" stopColor="#1e3a8a" />
        <stop offset="100%" stopColor="#38bdf8" />
      </linearGradient>
    </defs>
  );
}

/** The rocket, drawn around (0,0): nose at y≈−10, flame tip at y≈13. */
function RocketArt({
  idPrefix,
  flame = true,
}: {
  idPrefix: string;
  flame?: boolean;
}) {
  return (
    <g>
      {flame && (
        <motion.g
          style={pivot("50% 0%")}
          animate={{
            scaleY: [1, 1.28, 0.92, 1.2, 1],
            scaleX: [1, 0.92, 1.06, 0.95, 1],
          }}
          transition={{ duration: 0.55, repeat: Infinity, ease: "easeInOut" }}
        >
          <path
            d="M -1.6 6.4 C -1.3 9.4 -0.7 11 0 13 C 0.7 11 1.3 9.4 1.6 6.4 C 0.6 7.2 -0.6 7.2 -1.6 6.4 Z"
            fill={`url(#${idPrefix}Flame)`}
          />
          <path
            d="M -0.8 6.6 C -0.6 8.4 -0.3 9.4 0 10.6 C 0.3 9.4 0.6 8.4 0.8 6.6 C 0.3 7 -0.3 7 -0.8 6.6 Z"
            fill="#fef08a"
          />
        </motion.g>
      )}
      {/* fins */}
      <path d="M 3 0.5 C 5.4 2.5 6 4.8 6 6.6 L 3 4.8 Z" fill="#e11d48" />
      <path d="M -3 0.5 C -5.4 2.5 -6 4.8 -6 6.6 L -3 4.8 Z" fill="#be123c" />
      {/* body */}
      <path
        d="M 0 -10 C 3.4 -6.2 3.6 -1.5 3 4.6 L -3 4.6 C -3.6 -1.5 -3.4 -6.2 0 -10 Z"
        fill={`url(#${idPrefix}Body)`}
        stroke="#475569"
        strokeWidth="0.3"
      />
      {/* nose cone */}
      <path
        d="M 0 -10 C 1.9 -7.9 2.6 -6.4 2.9 -4.6 L -2.9 -4.6 C -2.6 -6.4 -1.9 -7.9 0 -10 Z"
        fill="#f43f5e"
      />
      {/* belly stripe */}
      <rect x="-3.05" y="2.7" width="6.1" height="1.4" fill="#f43f5e" opacity="0.9" />
      {/* window */}
      <circle cx="0" cy="-1.2" r="2" fill={`url(#${idPrefix}Window)`} stroke="#334155" strokeWidth="0.35" />
      <circle cx="-0.6" cy="-1.8" r="0.5" fill="#ffffff" opacity="0.85" />
      {/* nozzle */}
      <path d="M -1.9 4.6 L 1.9 4.6 L 1.4 6.5 L -1.4 6.5 Z" fill="#475569" />
    </g>
  );
}

function CloudShape() {
  return (
    <g fill="#ffffff" opacity="0.92">
      <ellipse cx="0" cy="0" rx="7" ry="2.6" />
      <ellipse cx="-4.4" cy="1" rx="4.6" ry="2" />
      <ellipse cx="4.4" cy="1" rx="4.6" ry="2.1" />
      <ellipse cx="0.5" cy="-1.9" rx="4.2" ry="2.1" />
    </g>
  );
}

function MilestoneIcon({
  kind,
  idPrefix,
}: {
  kind: MilestoneKind;
  idPrefix: string;
}) {
  if (kind === "cloud") {
    return (
      <g transform="scale(0.62)">
        <CloudShape />
      </g>
    );
  }
  if (kind === "plane") {
    return (
      <g>
        <ellipse cx="0" cy="0" rx="3.6" ry="1" fill="#f1f5f9" stroke="#64748b" strokeWidth="0.25" />
        <path d="M -0.6 0 L -2.6 2.6 L -1 2.6 L 0.8 0.4 Z" fill="#e2e8f0" />
        <path d="M -0.6 0 L -2.6 -2.6 L -1 -2.6 L 0.8 -0.4 Z" fill="#e2e8f0" />
        <path d="M -3.4 -0.2 L -4.6 -1.8 L -3.6 -1.8 L -2.6 -0.3 Z" fill="#cbd5e1" />
        <circle cx="2.4" cy="-0.2" r="0.4" fill="#38bdf8" />
      </g>
    );
  }
  if (kind === "sat") {
    return (
      <g>
        <rect x="-4.8" y="-1.2" width="3" height="2.4" rx="0.3" fill="#3b82f6" stroke="#1e40af" strokeWidth="0.25" />
        <rect x="1.8" y="-1.2" width="3" height="2.4" rx="0.3" fill="#3b82f6" stroke="#1e40af" strokeWidth="0.25" />
        <rect x="-1.3" y="-1.7" width="2.6" height="3.4" rx="0.5" fill="#cbd5e1" stroke="#64748b" strokeWidth="0.3" />
        <line x1="0" y1="-1.7" x2="0" y2="-3.2" stroke="#94a3b8" strokeWidth="0.35" />
        <circle cx="0" cy="-3.5" r="0.5" fill="#fbbf24" />
      </g>
    );
  }
  return (
    <g>
      <circle r="3.4" fill={`url(#${idPrefix}Moon)`} />
      <circle cx="-1" cy="-0.6" r="0.75" fill="#a1a1aa" opacity="0.5" />
      <circle cx="1.2" cy="1" r="0.55" fill="#a1a1aa" opacity="0.45" />
    </g>
  );
}

/* ================= Tutorial demos ================= */

function DemoFrame({
  idPrefix,
  space = false,
  children,
}: {
  idPrefix: string;
  space?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative mx-auto aspect-[100/58] w-full max-w-sm overflow-hidden rounded-3xl ring-1 ring-sky-900/25 dark:ring-slate-700"
      style={{ background: space ? "#0f1e4d" : "#38bdf8" }}
    >
      <svg viewBox="0 0 100 58" className="absolute inset-0 h-full w-full">
        <SkyDefs idPrefix={idPrefix} />
        <rect
          width="100"
          height="58"
          fill={`url(#${idPrefix}${space ? "DemoSpace" : "DemoSky"})`}
        />
        {children}
      </svg>
    </div>
  );
}

/** Step 1 — a ghost finger taps the right answer; the rocket boosts a notch. */
function DemoBoost() {
  const D = 3.4;
  return (
    <DemoFrame idPrefix="da">
      <g transform="translate(76 50)">
        <CloudShape />
      </g>
      <g transform="translate(36 52) scale(0.7)">
        <CloudShape />
      </g>

      {/* track */}
      <line x1="14" y1="6" x2="14" y2="54" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="0.8" strokeDasharray="1.5 2.5" />
      {[46, 38, 30, 22, 14].map((y) => (
        <line key={y} x1="12.6" y1={y} x2="15.4" y2={y} stroke="#ffffff" strokeOpacity="0.5" strokeWidth="0.7" strokeLinecap="round" />
      ))}

      {/* rocket hops one notch after the tap */}
      <g transform="translate(14 42) scale(0.75)">
        <motion.g
          animate={{ y: [0, 0, -10.6, -10.6] }}
          transition={{ duration: D, times: [0, 0.6, 0.74, 1], repeat: Infinity, ease: "easeOut" }}
        >
          <RocketArt idPrefix="da" />
        </motion.g>
      </g>

      {/* problem card */}
      <rect x="30" y="6" width="64" height="15" rx="4" fill="#ffffff" opacity="0.95" />
      <text x="62" y="13.7" textAnchor="middle" dominantBaseline="central" fontSize="7.5" fontWeight="900" fill="#0f172a">
        2 + 3 = ?
      </text>

      {/* answer pills */}
      {[4, 5, 6, 8].map((n, i) => (
        <g key={n}>
          <rect x={30 + i * 16.5} y="27" width="14" height="11" rx="3" fill="#ffffff" opacity="0.95" />
          <text
            x={37 + i * 16.5}
            y="32.7"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="6"
            fontWeight="900"
            fill="#0f172a"
          >
            {n}
          </text>
        </g>
      ))}
      {/* correct pill flashes green at the tap */}
      <motion.rect
        x="46.5"
        y="27"
        width="14"
        height="11"
        rx="3"
        fill="#34d399"
        animate={{ opacity: [0, 0, 0.9, 0, 0] }}
        transition={{ duration: D, times: [0, 0.58, 0.66, 0.85, 1], repeat: Infinity }}
      />

      {/* ghost finger */}
      <motion.g
        animate={{
          x: [28, 0, 0, 0, 28],
          y: [18, 0, 0, 0, 18],
          scale: [1, 1, 0.72, 1, 1],
          opacity: [0, 0.95, 0.95, 0, 0],
        }}
        transition={{ duration: D, times: [0, 0.45, 0.62, 0.82, 1], repeat: Infinity }}
      >
        <circle cx="53.5" cy="32.5" r="3.4" fill="#ffffff" opacity="0.9" stroke="#334155" strokeWidth="0.5" />
      </motion.g>

      {/* +6 ping by the rocket */}
      <motion.g
        animate={{ y: [0, 0, -9, -11], opacity: [0, 0, 1, 0] }}
        transition={{ duration: D, times: [0, 0.64, 0.84, 1], repeat: Infinity }}
      >
        <rect x="18.5" y="26" width="11" height="7.5" rx="3.75" fill="#10b981" stroke="#047857" strokeWidth="0.4" />
        <text x="24" y="29.9" textAnchor="middle" dominantBaseline="central" fontSize="4.4" fontWeight="900" fill="#ffffff">
          +6
        </text>
      </motion.g>
    </DemoFrame>
  );
}

/** Step 2 — the four milestones stacked on the climb track. */
function DemoMilestones() {
  return (
    <DemoFrame idPrefix="db" space>
      <line x1="20" y1="4" x2="20" y2="56" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="0.8" strokeDasharray="1.5 2.5" />
      {(
        [
          { y: 44, kind: "cloud", label: "Level 1 · Clouds" },
          { y: 32, kind: "plane", label: "Level 2 · Jet stream" },
          { y: 20, kind: "sat", label: "Level 3 · Orbit" },
          { y: 8, kind: "moon", label: "Level 4 · The Moon" },
        ] as { y: number; kind: MilestoneKind; label: string }[]
      ).map((m) => (
        <g key={m.kind} transform={`translate(0 ${m.y})`}>
          <line x1="12" y1="0" x2="30" y2="0" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.5" strokeDasharray="2 2" />
          <g transform="translate(12 -0.5)">
            <MilestoneIcon kind={m.kind} idPrefix="db" />
          </g>
          <text x="33" y="0.2" dominantBaseline="central" fontSize="3.6" fontWeight="700" fill="#ffffff" opacity="0.9">
            {m.label}
          </text>
        </g>
      ))}
      {/* rocket climbing past the milestones */}
      <g transform="translate(20 54) scale(0.72)">
        <motion.g
          animate={{ y: [0, -66], opacity: [1, 1, 1, 0] }}
          transition={{
            duration: 4,
            times: [0, 0.5, 0.92, 1],
            repeat: Infinity,
            ease: "linear",
          }}
        >
          <RocketArt idPrefix="db" />
        </motion.g>
      </g>
    </DemoFrame>
  );
}

/** Step 3 — a wrong answer: wobble, −3 s, and the correct answer revealed. */
function DemoWobble() {
  const D = 3.6;
  return (
    <DemoFrame idPrefix="dc">
      <g transform="translate(80 46)">
        <CloudShape />
      </g>
      <g transform="translate(40 54) scale(0.8)">
        <CloudShape />
      </g>

      {/* problem card with a wrong pick flashing red */}
      <rect x="36" y="6" width="58" height="14" rx="4" fill="#ffffff" opacity="0.95" />
      <text x="65" y="13.2" textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="900" fill="#0f172a">
        6 × 7 = ?
      </text>
      <motion.rect
        x="36"
        y="6"
        width="58"
        height="14"
        rx="4"
        fill="#f43f5e"
        animate={{ opacity: [0, 0, 0.55, 0, 0] }}
        transition={{ duration: D, times: [0, 0.28, 0.36, 0.55, 1], repeat: Infinity }}
      />

      {/* wobbling rocket */}
      <g transform="translate(18 38) scale(0.85)">
        <motion.g
          animate={{ rotate: [0, 0, -9, 8, -5, 4, 0, 0] }}
          transition={{
            duration: D,
            times: [0, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 1],
            repeat: Infinity,
          }}
          style={pivot("50% 45%")}
        >
          <RocketArt idPrefix="dc" />
        </motion.g>
      </g>

      {/* −3s ping */}
      <motion.g
        animate={{ y: [0, 0, -8, -10], opacity: [0, 0, 1, 0] }}
        transition={{ duration: D, times: [0, 0.3, 0.55, 0.75], repeat: Infinity }}
      >
        <rect x="24" y="23" width="13" height="7.5" rx="3.75" fill="#f43f5e" stroke="#be123c" strokeWidth="0.4" />
        <text x="30.5" y="26.9" textAnchor="middle" dominantBaseline="central" fontSize="4.2" fontWeight="900" fill="#ffffff">
          −3s
        </text>
      </motion.g>

      {/* the reveal chip */}
      <motion.g
        animate={{ opacity: [0, 0, 1, 1, 0] }}
        transition={{ duration: D, times: [0, 0.4, 0.5, 0.88, 1], repeat: Infinity }}
      >
        <rect x="42" y="42" width="46" height="9.5" rx="4.75" fill="#f43f5e" opacity="0.95" />
        <text x="65" y="47" textAnchor="middle" dominantBaseline="central" fontSize="4.6" fontWeight="800" fill="#ffffff">
          ✗ 6 × 7 = 42
        </text>
      </motion.g>
    </DemoFrame>
  );
}

/** Step 4 — level 4 is typed input. */
function DemoTyped() {
  return (
    <div className="mx-auto max-w-sm space-y-3">
      <DemoFrame idPrefix="dd" space>
        <motion.circle cx="20" cy="10" r="0.7" fill="#f8fafc" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2, repeat: Infinity }} />
        <motion.circle cx="60" cy="6" r="0.5" fill="#f8fafc" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2.6, repeat: Infinity }} />
        <motion.circle cx="88" cy="14" r="0.6" fill="#f8fafc" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2.2, repeat: Infinity }} />
        <g transform="translate(84 10)">
          <circle r="6" fill="url(#ddMoon)" />
          <circle cx="-1.6" cy="-1" r="1.1" fill="#a1a1aa" opacity="0.5" />
          <circle cx="2" cy="1.6" r="0.8" fill="#a1a1aa" opacity="0.45" />
        </g>
        <g transform="translate(16 40) scale(0.8)">
          <motion.g animate={{ y: [0, -2, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
            <RocketArt idPrefix="dd" />
          </motion.g>
        </g>
        <rect x="34" y="14" width="58" height="15" rx="4" fill="#ffffff" opacity="0.95" />
        <text x="63" y="21.7" textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="900" fill="#0f172a">
          23 × 7 = ?
        </text>
      </DemoFrame>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-2xl bg-white px-4 py-3 text-2xl font-bold text-slate-900 ring-1 ring-sky-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700">
          161
        </div>
        <div className="rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white">
          Enter
        </div>
      </div>
    </div>
  );
}

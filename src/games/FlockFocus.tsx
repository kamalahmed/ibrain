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
import { useStore } from "@/store/useStore";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

type Dir = "L" | "R";
type Outcome = "correct" | "wrong" | "miss" | null;

type Trial = {
  id: number;
  centerDir: Dir;
  flankDir: Dir;
  fromLeft: boolean;
  windowMs: number;
  born: number; // Date.now() at spawn — the response window starts here
};

type Ping = { id: number; text: string; tone: "ok" | "bad"; born: number };

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  /** Named twist announced on the LevelComplete card. */
  twist: string;
  birds: 5 | 7;
  windowMs: number;
  /** Probability the flanking birds face AGAINST the centre bird. */
  incongruentP: number;
  /** Correct answers required to clear the level. */
  need: number;
  /** Trial budget per pass — run out and the flock circles back. */
  trials: number;
  wind: boolean;
};

const SESSION_SECONDS = 180; // 3-minute session
const BASE_PTS = 8;
const SPEED_PTS = 8; // extra points scale with time left in the window
const LEVEL_CLEAR_BONUS = 45;
const PING_LIFE_MS = 900;
const NEXT_TRIAL_MS = 640; // gap after an answer while the flock flies off
const LEVEL_DONE_MS = 1250;

const LEVELS: Level[] = [
  {
    id: 1,
    name: "All together",
    twist: "Traitor flankers — friends may point the wrong way",
    birds: 5,
    windowMs: 3000,
    incongruentP: 0,
    need: 10,
    trials: 14,
    wind: false,
  },
  {
    id: 2,
    name: "Traitor flankers",
    twist: "Bigger flock — 7 birds, tighter 2s window",
    birds: 5,
    windowMs: 2400,
    incongruentP: 0.5,
    need: 11,
    trials: 16,
    wind: false,
  },
  {
    id: 3,
    name: "Bigger flock",
    twist: "Gusty skies — birds bob in the wind, 1.6s window",
    birds: 7,
    windowMs: 2000,
    incongruentP: 0.6,
    need: 12,
    trials: 17,
    wind: false,
  },
  {
    id: 4,
    name: "Gusty skies",
    twist: "",
    birds: 7,
    windowMs: 1600,
    incongruentP: 0.65,
    need: 12,
    trials: 18,
    wind: true,
  },
];

/** Streak combo: x2 after 3 in a row, x3 after 6. */
function multFor(streak: number): number {
  if (streak >= 6) return 3;
  if (streak >= 3) return 2;
  return 1;
}

/** Bird plumage per level — the flock changes species as the skies get harder. */
const LEVEL_BIRDS: { belly: string; body: string; deep: string; wing: string }[] = [
  { belly: "#e0f2fe", body: "#7dd3fc", deep: "#0284c7", wing: "#075985" }, // bluebird
  { belly: "#ffe4e6", body: "#fda4af", deep: "#e11d48", wing: "#9f1239" }, // robin
  { belly: "#ede9fe", body: "#c4b5fd", deep: "#7c3aed", wing: "#5b21b6" }, // violet swallow
  { belly: "#fef3c7", body: "#fcd34d", deep: "#d97706", wing: "#92400e" }, // goldfinch
];

/** V-formation offsets around the centre bird (scene units). */
function formationOffsets(count: number): { x: number; y: number }[] {
  const c = Math.floor(count / 2);
  const gap = count >= 7 ? 9.4 : 11.5;
  return Array.from({ length: count }, (_, i) => ({
    x: (i - c) * gap,
    y: Math.abs(i - c) * 3.1 - 1,
  }));
}

function makeTrial(lvl: Level, id: number): Trial {
  const centerDir: Dir = Math.random() < 0.5 ? "L" : "R";
  const incongruent = Math.random() < lvl.incongruentP;
  const flankDir: Dir = incongruent ? (centerDir === "L" ? "R" : "L") : centerDir;
  return {
    id,
    centerDir,
    flankDir,
    fromLeft: Math.random() < 0.5,
    windowMs: lvl.windowMs,
    born: Date.now(),
  };
}

export default function FlockFocus() {
  const game = getGame("flock");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [streak, setStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [trialIdx, setTrialIdx] = useState(0);
  const [pings, setPings] = useState<Ping[]>([]);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);

  const phaseRef = useRef<Phase>("intro");
  const levelIdxRef = useRef(0);
  const trialRef = useRef<Trial | null>(null);
  const outcomeRef = useRef<Outcome>(null);
  const scoreRef = useRef(0);
  const levelPointsRef = useRef(0);
  const clearedRef = useRef(0);
  const streakRef = useRef(0);
  const bestStreakRef = useRef(0);
  const correctRef = useRef(0);
  const trialIdxRef = useRef(0);
  const hitsRef = useRef(0);
  const wrongsRef = useRef(0);
  const missesRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const windowTimerRef = useRef<number | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const trialIdRef = useRef(0);
  const pingIdRef = useRef(0);
  const endedRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };
  const stopWindowTimer = () => {
    if (windowTimerRef.current !== null) {
      window.clearTimeout(windowTimerRef.current);
      windowTimerRef.current = null;
    }
  };
  const later = (fn: () => void, ms: number) => {
    timeoutsRef.current.push(window.setTimeout(fn, ms));
  };

  useEffect(
    () => () => {
      stopTick();
      stopWindowTimer();
      timeoutsRef.current.forEach((t) => window.clearTimeout(t));
    },
    []
  );

  const addPing = (text: string, tone: Ping["tone"]) => {
    const p: Ping = { id: ++pingIdRef.current, text, tone, born: Date.now() };
    setPings((prev) => [...prev, p]);
  };

  const finishGame = useCallback(
    (clearedAll: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopTick();
      stopWindowTimer();
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
      const { isBest: best } = recordPlay("flock", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  /** Spawn the next formation. All game logic reads refs, so the delayed
   *  callbacks that call this never act on stale state. */
  function spawnTrial() {
    if (endedRef.current || phaseRef.current !== "playing") return;
    const lvl = LEVELS[levelIdxRef.current];
    const t = makeTrial(lvl, ++trialIdRef.current);
    trialRef.current = t;
    outcomeRef.current = null;
    setTrial(t);
    setOutcome(null);
    stopWindowTimer();
    windowTimerRef.current = window.setTimeout(
      () => resolveMiss(t.id),
      lvl.windowMs
    );
  }

  function resolveMiss(id: number) {
    if (endedRef.current || phaseRef.current !== "playing") return;
    if (trialRef.current?.id !== id || outcomeRef.current !== null) return;
    windowTimerRef.current = null;
    haptic.error();
    streakRef.current = 0;
    setStreak(0);
    missesRef.current += 1;
    addPing("Too slow", "bad");
    outcomeRef.current = "miss";
    setOutcome("miss");
    later(nextStep, NEXT_TRIAL_MS);
  }

  function nextStep() {
    if (endedRef.current || phaseRef.current !== "playing") return;
    const lvl = LEVELS[levelIdxRef.current];
    trialIdxRef.current += 1;
    const trialsLeft = lvl.trials - trialIdxRef.current;
    if (lvl.need - correctRef.current > trialsLeft) {
      // this pass can no longer clear — the flock circles back for another go
      trialIdxRef.current = 0;
      correctRef.current = 0;
      setCorrectCount(0);
      setRetryNote(`Circling back — get ${lvl.need} right to clear`);
      later(() => setRetryNote(null), 1900);
    }
    setTrialIdx(trialIdxRef.current);
    spawnTrial();
  }

  function clearLevel() {
    if (endedRef.current || phaseRef.current !== "playing") return;
    stopWindowTimer();
    const lvl = LEVELS[levelIdxRef.current];
    scoreRef.current += LEVEL_CLEAR_BONUS;
    levelPointsRef.current += LEVEL_CLEAR_BONUS;
    setScore(scoreRef.current);
    clearedRef.current += 1;
    setLastCleared(lvl.id);
    setLastLevelScore(levelPointsRef.current);
    trialRef.current = null;
    setTrial(null);
    setPhase("levelDone");
    const nextIdx = levelIdxRef.current + 1;
    later(() => {
      if (endedRef.current) return;
      if (nextIdx >= LEVELS.length) finishGame(true);
      else startLevel(nextIdx);
    }, LEVEL_DONE_MS);
  }

  function startLevel(idx: number) {
    if (endedRef.current) return;
    levelIdxRef.current = idx;
    setLevelIdx(idx);
    correctRef.current = 0;
    setCorrectCount(0);
    trialIdxRef.current = 0;
    setTrialIdx(0);
    levelPointsRef.current = 0;
    setRetryNote(null);
    setPings([]);
    trialRef.current = null;
    setTrial(null);
    outcomeRef.current = null;
    setOutcome(null);
    setPhase("playing");
    phaseRef.current = "playing"; // spawn below runs before the effect fires
    later(spawnTrial, 320);
  }

  const answer = useCallback((dir: Dir) => {
    if (endedRef.current || phaseRef.current !== "playing") return;
    const t = trialRef.current;
    if (!t || outcomeRef.current !== null) return;
    stopWindowTimer();
    const lvl = LEVELS[levelIdxRef.current];
    if (dir === t.centerDir) {
      const elapsed = Date.now() - t.born;
      const frac = Math.max(0, Math.min(1, 1 - elapsed / lvl.windowMs));
      streakRef.current += 1;
      if (streakRef.current > bestStreakRef.current)
        bestStreakRef.current = streakRef.current;
      setStreak(streakRef.current);
      const mult = multFor(streakRef.current);
      const pts = (BASE_PTS + Math.round(SPEED_PTS * frac)) * mult;
      scoreRef.current += pts;
      levelPointsRef.current += pts;
      setScore(scoreRef.current);
      correctRef.current += 1;
      setCorrectCount(correctRef.current);
      hitsRef.current += 1;
      haptic.success();
      addPing(mult > 1 ? `+${pts} ×${mult}` : `+${pts}`, "ok");
      outcomeRef.current = "correct";
      setOutcome("correct");
      if (correctRef.current >= lvl.need) later(clearLevel, 600);
      else later(nextStep, NEXT_TRIAL_MS);
    } else {
      haptic.error();
      streakRef.current = 0;
      setStreak(0);
      wrongsRef.current += 1;
      addPing("Wrong way", "bad");
      outcomeRef.current = "wrong";
      setOutcome("wrong");
      later(nextStep, NEXT_TRIAL_MS + 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrow keys answer too
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        answer("L");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        answer("R");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, answer]);

  const begin = () => {
    timeoutsRef.current.forEach((t) => window.clearTimeout(t));
    timeoutsRef.current = [];
    stopWindowTimer();
    endedRef.current = false;
    scoreRef.current = 0;
    setScore(0);
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    streakRef.current = 0;
    setStreak(0);
    bestStreakRef.current = 0;
    hitsRef.current = 0;
    wrongsRef.current = 0;
    missesRef.current = 0;
    levelIdxRef.current = 0;
    setLevelIdx(0);
    trialRef.current = null;
    setTrial(null);
    outcomeRef.current = null;
    setOutcome(null);
    setPings([]);
    setRetryNote(null);
    setTimeLeft(SESSION_SECONDS);
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
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
      // prune expired score pings
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
  const mult = multFor(streak);

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "A flock glides in. Answer the way the MIDDLE bird faces.",
      stage: <DemoFlock mode="congruent" />,
      auto: 4200,
    },
    {
      caption: "Watch ONLY the middle bird — its friends may face the wrong way!",
      stage: <DemoFlock mode="incongruent" />,
      auto: 4600,
    },
    {
      caption: "Tap Left or Right (arrow keys work too). Faster answers score more.",
      stage: <DemoFlock mode="buttons" />,
    },
  ];

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four skies in one 3-minute session. A small flock flies to centre
          stage — tap Left or Right for the direction the CENTRE bird faces.
          Level 1 is friendly (every bird agrees, 3 seconds to answer); later
          the flanking birds turn traitor, the flock grows to 7, and gusty
          skies shrink the window. Streaks build a ×2 / ×3 combo.
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
            extra={
              mult >= 2 ? (
                <motion.span
                  key={`m${mult}`}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="chip bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800"
                  data-testid="combo"
                >
                  ×{mult} streak
                </motion.span>
              ) : undefined
            }
          />

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold">{lvl.name}</span>
            <span data-testid="progress">
              {correctCount} / {lvl.need} correct · trial{" "}
              {Math.min(trialIdx + 1, lvl.trials)}/{lvl.trials}
            </span>
          </div>

          {phase === "levelDone" ? (
            <LevelComplete
              levelJustCleared={lastCleared}
              totalLevels={LEVELS.length}
              levelScore={lastLevelScore}
              nextLabel={LEVELS[lastCleared - 1]?.twist || undefined}
            />
          ) : (
            <>
              <SkyStage
                trial={trial}
                outcome={outcome}
                level={lvl}
                pings={pings}
                retryNote={retryNote}
              />
              <AnswerButtons onAnswer={answer} />
              <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                Wrong answers never cost points — they just reset your streak.
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
          detail={`${clearedRef.current} / ${LEVELS.length} levels · ${hitsRef.current} correct · best streak ${bestStreakRef.current}`}
        />
      )}
    </GameShell>
  );
}

/* ---------------- Sky stage (the scene) ---------------- */

function SkyStage({
  trial,
  outcome,
  level,
  pings,
  retryNote,
}: {
  trial: Trial | null;
  outcome: Outcome;
  level: Level;
  pings: Ping[];
  retryNote: string | null;
}) {
  return (
    <div
      data-testid="flock-stage"
      className="relative mx-auto aspect-[8/5] w-full max-w-xl overflow-hidden rounded-3xl bg-gradient-to-b from-sky-400 via-sky-300 to-sky-100 shadow-soft ring-1 ring-sky-300/70 dark:from-sky-950 dark:via-sky-800 dark:to-indigo-900 dark:ring-sky-500/30"
    >
      <SkyScene idPrefix="flock">
        {trial && (
          <Flock
            key={trial.id}
            trial={trial}
            outcome={outcome}
            level={level}
            idPrefix="flock"
          />
        )}
      </SkyScene>

      {/* response-window bar */}
      {trial && outcome === null && (
        <div className="absolute inset-x-4 bottom-2.5 h-1.5 overflow-hidden rounded-full bg-white/30 dark:bg-white/15">
          <motion.div
            key={trial.id}
            className="h-full rounded-full bg-white/90"
            initial={{ width: "100%" }}
            animate={{ width: "0%" }}
            transition={{ duration: trial.windowMs / 1000, ease: "linear" }}
          />
        </div>
      )}

      {/* wrong-answer red flash */}
      <AnimatePresence>
        {outcome === "wrong" && (
          <motion.div
            className="pointer-events-none absolute inset-0 bg-rose-500"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.32, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
          />
        )}
      </AnimatePresence>

      {/* circling-back note */}
      <AnimatePresence>
        {retryNote && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none absolute inset-x-0 top-3 flex justify-center"
          >
            <span className="rounded-full bg-slate-900/80 px-3 py-1.5 text-xs font-bold text-white shadow-soft">
              {retryNote}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* floating score pings */}
      <div className="pointer-events-none absolute inset-0">
        {pings.map((p) => (
          <div
            key={p.id}
            className="absolute left-1/2 top-[34%]"
            style={{
              marginLeft: ((p.id % 3) - 1) * 22,
              transform: "translateX(-50%)",
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.6 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: -26,
                scale: [0.6, 1.12, 1, 1],
              }}
              transition={{
                duration: PING_LIFE_MS / 1000,
                times: [0, 0.18, 0.7, 1],
              }}
            >
              <span
                className={
                  "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-black text-white shadow-soft ring-1 " +
                  (p.tone === "ok"
                    ? "bg-emerald-500 ring-emerald-300"
                    : "bg-rose-500 ring-rose-300")
                }
              >
                {p.text}
              </span>
            </motion.div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- The flock (one trial's formation) ---------------- */

function Flock({
  trial,
  outcome,
  level,
  idPrefix,
}: {
  trial: Trial;
  outcome: Outcome;
  level: Level;
  idPrefix: string;
}) {
  const offsets = formationOffsets(level.birds);
  const centerIdx = Math.floor(level.birds / 2);
  const exitX = trial.centerDir === "R" ? 95 : -95;
  const tone = (level.id - 1) % LEVEL_BIRDS.length;

  const anim =
    outcome === "correct"
      ? { x: exitX, y: -14, opacity: 1 }
      : outcome === "miss"
      ? { x: exitX, y: 9, opacity: 0.45 }
      : outcome === "wrong"
      ? { x: 0, y: 0, opacity: 0 }
      : { x: 0, y: 0, opacity: 1 };
  const transition =
    outcome === "correct" || outcome === "miss"
      ? { duration: 0.55, ease: "easeIn" as const }
      : outcome === "wrong"
      ? { delay: 0.32, duration: 0.26 }
      : { duration: 0.45, ease: "easeOut" as const };

  return (
    <motion.g
      initial={{ x: trial.fromLeft ? -85 : 85, y: -5, opacity: 1 }}
      animate={anim}
      transition={transition}
    >
      {offsets.map((o, i) => {
        const isCenter = i === centerIdx;
        const dir = isCenter ? trial.centerDir : trial.flankDir;
        const s = isCenter ? 5.4 : 4.2;
        return (
          <g key={i} transform={`translate(${50 + o.x} ${30 + o.y})`}>
            {isCenter && <Halo s={s} />}
            {/* gentle hover bob; gusts on level 4 */}
            <motion.g
              animate={{ y: level.wind ? [0, -2.4, 1.5, 0] : [0, -0.9, 0] }}
              transition={{
                duration: level.wind ? 1.6 : 2.6,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.14,
              }}
            >
              {/* centre bird shakes on a wrong answer */}
              <motion.g
                animate={
                  isCenter && outcome === "wrong"
                    ? { x: [0, -2.4, 2.4, -1.6, 1.6, 0] }
                    : { x: 0 }
                }
                transition={{ duration: 0.4 }}
              >
                <g transform={`scale(${dir === "L" ? -1 : 1} 1)`}>
                  <Bird
                    s={s}
                    tone={tone}
                    idPrefix={idPrefix}
                    flapDelay={i * 0.09}
                    excited={outcome === "correct"}
                  />
                </g>
              </motion.g>
            </motion.g>
          </g>
        );
      })}
    </motion.g>
  );
}

/** Faint pulsing halo that marks the centre bird. */
function Halo({ s, strong = false }: { s: number; strong?: boolean }) {
  return (
    <>
      <motion.circle
        r={s * 2.15}
        fill="#ffffff"
        animate={{ opacity: strong ? [0.2, 0.42, 0.2] : [0.13, 0.28, 0.13] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <circle
        r={s * 2.15}
        fill="none"
        stroke="#ffffff"
        strokeWidth={0.35}
        opacity={strong ? 0.75 : 0.45}
      />
    </>
  );
}

/* ---------------- One bird (reusable SVG) ---------------- */

const pivot = (origin: string): CSSProperties =>
  ({ transformOrigin: origin, transformBox: "fill-box" } as CSSProperties);

/** Drawn facing right in local space, centred on the body. Flip the parent
 *  with scale(-1,1) for a left-facing bird. */
function Bird({
  s,
  tone,
  idPrefix,
  flapDelay = 0,
  excited = false,
}: {
  s: number;
  tone: number;
  idPrefix: string;
  flapDelay?: number;
  excited?: boolean;
}) {
  const c = LEVEL_BIRDS[tone];
  return (
    <g>
      {/* tail feathers */}
      <path
        d={`M ${-0.85 * s} 0 L ${-1.75 * s} ${-0.52 * s} L ${-1.5 * s} ${0.02 * s} L ${-1.68 * s} ${0.5 * s} Z`}
        fill={c.wing}
      />
      {/* plump body */}
      <ellipse
        cx={0}
        cy={0}
        rx={1.15 * s}
        ry={0.72 * s}
        fill={`url(#${idPrefix}Body${tone})`}
      />
      {/* belly highlight */}
      <ellipse
        cx={0.22 * s}
        cy={0.3 * s}
        rx={0.68 * s}
        ry={0.32 * s}
        fill={c.belly}
        opacity={0.85}
      />
      {/* head */}
      <circle
        cx={0.85 * s}
        cy={-0.5 * s}
        r={0.52 * s}
        fill={`url(#${idPrefix}Body${tone})`}
      />
      {/* beak */}
      <path
        d={`M ${1.28 * s} ${-0.63 * s} L ${1.8 * s} ${-0.45 * s} L ${1.28 * s} ${-0.27 * s} Z`}
        fill="#f59e0b"
        stroke="#d97706"
        strokeWidth={0.07 * s}
        strokeLinejoin="round"
      />
      {/* eye */}
      <circle cx={0.92 * s} cy={-0.57 * s} r={0.17 * s} fill="#ffffff" />
      <circle cx={0.99 * s} cy={-0.57 * s} r={0.09 * s} fill="#0f172a" />
      {/* flapping wing — pivots at the wing root near the body's shoulder */}
      <motion.path
        d={
          `M ${0.15 * s} ${-0.3 * s} ` +
          `Q ${-0.9 * s} ${-0.52 * s} ${-1.5 * s} ${0.45 * s} ` +
          `Q ${-0.55 * s} ${0.52 * s} ${0.15 * s} ${0.06 * s} Z`
        }
        fill={c.wing}
        animate={{ rotate: [14, -32, 14] }}
        transition={{
          duration: excited ? 0.32 : 0.72,
          repeat: Infinity,
          ease: "easeInOut",
          delay: flapDelay,
        }}
        style={pivot("100% 20%")}
      />
    </g>
  );
}

/* ---------------- Sky backdrop (sun, clouds, hills) ---------------- */

function SkyDefs({ idPrefix }: { idPrefix: string }) {
  return (
    <defs>
      {LEVEL_BIRDS.map((t, i) => (
        <linearGradient
          key={i}
          id={`${idPrefix}Body${i}`}
          x1="0"
          y1="-1"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={t.belly} />
          <stop offset="55%" stopColor={t.body} />
          <stop offset="100%" stopColor={t.deep} />
        </linearGradient>
      ))}
      <radialGradient id={`${idPrefix}Sun`}>
        <stop offset="0%" stopColor="#fef9c3" stopOpacity="0.95" />
        <stop offset="55%" stopColor="#fde68a" stopOpacity="0.45" />
        <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

const CLOUDS = [
  { cx: 24, cy: 13, s: 1.15, dur: 34, drift: 9, opacity: 0.9, front: false },
  { cx: 74, cy: 21, s: 0.8, dur: 26, drift: -7, opacity: 0.75, front: false },
  { cx: 46, cy: 48, s: 1.35, dur: 40, drift: 11, opacity: 0.95, front: true },
];

function CloudPuff({
  cx,
  cy,
  s,
  dur,
  drift,
  opacity,
}: {
  cx: number;
  cy: number;
  s: number;
  dur: number;
  drift: number;
  opacity: number;
}) {
  return (
    <motion.g
      opacity={opacity}
      animate={{ x: [0, drift, 0] }}
      transition={{ duration: dur, repeat: Infinity, ease: "easeInOut" }}
      pointerEvents="none"
    >
      <ellipse cx={cx} cy={cy} rx={7.4 * s} ry={2.5 * s} fill="#ffffff" />
      <circle cx={cx - 3.4 * s} cy={cy - 1.3 * s} r={2.5 * s} fill="#ffffff" />
      <circle cx={cx + 1.2 * s} cy={cy - 2 * s} r={3.1 * s} fill="#ffffff" />
      <ellipse
        cx={cx}
        cy={cy + 1.4 * s}
        rx={6.6 * s}
        ry={1.4 * s}
        fill="#bae6fd"
        opacity={0.5}
      />
    </motion.g>
  );
}

/** Layered sky: sun + distant birds + parallax clouds behind the flock,
 *  one soft cloud and rolling hills in front. */
function SkyScene({
  idPrefix,
  children,
}: {
  idPrefix: string;
  children?: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 100 62"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <SkyDefs idPrefix={idPrefix} />

      {/* sun with a warm glow */}
      <circle cx={15} cy={10} r={13} fill={`url(#${idPrefix}Sun)`} />
      <circle cx={15} cy={10} r={4.4} fill="#fef08a" />

      {/* far-off flock, just silhouettes */}
      <g
        stroke="#1e3a8a"
        strokeWidth="0.45"
        fill="none"
        opacity="0.3"
        strokeLinecap="round"
      >
        <path d="M 71 9 q 1.7 -1.9 3.4 0 q 1.7 -1.9 3.4 0" />
        <path d="M 80 13.5 q 1.3 -1.5 2.6 0 q 1.3 -1.5 2.6 0" />
        <path d="M 64 15 q 1.1 -1.3 2.2 0 q 1.1 -1.3 2.2 0" />
      </g>

      {/* back clouds — behind the flock */}
      {CLOUDS.filter((c) => !c.front).map((c, i) => (
        <CloudPuff key={i} {...c} />
      ))}

      {/* the flock */}
      {children}

      {/* front cloud — the flock passes behind it for depth */}
      {CLOUDS.filter((c) => c.front).map((c, i) => (
        <CloudPuff key={i} {...c} />
      ))}

      {/* rolling hills ground the scene */}
      <path
        d="M 0 56.5 Q 22 48.5 45 55 T 100 54 L 100 62 L 0 62 Z"
        fill="#6ee7b7"
        opacity="0.85"
      />
      <path
        d="M 0 59.5 Q 30 53.5 60 58.5 T 100 58 L 100 62 L 0 62 Z"
        fill="#10b981"
      />
    </svg>
  );
}

/* ---------------- Answer buttons ---------------- */

function ArrowIcon({ left }: { left: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <path
        d={left ? "M 15 5 L 7 12 L 15 19" : "M 9 5 L 17 12 L 9 19"}
        stroke="currentColor"
        strokeWidth="3.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AnswerButtons({ onAnswer }: { onAnswer: (d: Dir) => void }) {
  return (
    <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-3">
      <motion.button
        type="button"
        data-testid="btn-left"
        aria-label="Middle bird faces left"
        onPointerDown={() => onAnswer("L")}
        onClick={() => onAnswer("L")}
        whileTap={{ scale: 0.95 }}
        className="flex min-h-[60px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-lg font-extrabold text-white shadow-soft ring-1 ring-sky-600/40 touch-manipulation select-none"
      >
        <ArrowIcon left />
        Left
      </motion.button>
      <motion.button
        type="button"
        data-testid="btn-right"
        aria-label="Middle bird faces right"
        onPointerDown={() => onAnswer("R")}
        onClick={() => onAnswer("R")}
        whileTap={{ scale: 0.95 }}
        className="flex min-h-[60px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-sky-500 text-lg font-extrabold text-white shadow-soft ring-1 ring-indigo-600/40 touch-manipulation select-none"
      >
        Right
        <ArrowIcon left={false} />
      </motion.button>
    </div>
  );
}

/* ---------------- Tutorial demo (auto-playing) ---------------- */

/** Looping demo built from the real scene pieces: the flock glides in, a
 *  ghost finger presses the correct button, and the flock flies off. */
function DemoFlock({
  mode,
}: {
  mode: "congruent" | "incongruent" | "buttons";
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1300);
    return () => window.clearInterval(id);
  }, []);

  const step = tick % 3; // 0 glide in · 1 hold · 2 answer + fly off
  const cycle = Math.floor(tick / 3);
  const centerDir: Dir =
    mode === "incongruent" ? "L" : cycle % 2 === 0 ? "R" : "L";
  const flankDir: Dir = mode === "incongruent" ? "R" : centerDir;
  const offsets = formationOffsets(5);
  const exitX = centerDir === "R" ? 95 : -95;
  const tone = mode === "congruent" ? 0 : mode === "incongruent" ? 1 : 3;
  const idPrefix = `fdemo${mode}`;

  return (
    <div className="mx-auto w-full max-w-sm space-y-3">
      <div className="relative aspect-[8/5] w-full overflow-hidden rounded-3xl bg-gradient-to-b from-sky-400 via-sky-300 to-sky-100 shadow-soft ring-1 ring-sky-300/70 dark:from-sky-950 dark:via-sky-800 dark:to-indigo-900 dark:ring-sky-500/30">
        <SkyScene idPrefix={idPrefix}>
          <motion.g
            key={cycle}
            initial={{ x: -80, y: -4 }}
            animate={step === 2 ? { x: exitX, y: -12 } : { x: 0, y: 0 }}
            transition={{
              duration: 0.6,
              ease: step === 2 ? "easeIn" : "easeOut",
            }}
          >
            {offsets.map((o, i) => {
              const isC = i === 2;
              const dir = isC ? centerDir : flankDir;
              const s = isC ? 5.4 : 4.2;
              return (
                <g key={i} transform={`translate(${50 + o.x} ${31 + o.y})`}>
                  {isC && <Halo s={s} strong={mode === "incongruent"} />}
                  <motion.g
                    animate={{ y: [0, -0.9, 0] }}
                    transition={{
                      duration: 2.4,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: i * 0.14,
                    }}
                  >
                    <g transform={`scale(${dir === "L" ? -1 : 1} 1)`}>
                      <Bird
                        s={s}
                        tone={tone}
                        idPrefix={idPrefix}
                        flapDelay={i * 0.1}
                        excited={step === 2}
                      />
                    </g>
                  </motion.g>
                </g>
              );
            })}
          </motion.g>
        </SkyScene>

        {/* demo score ping on the answer beat */}
        {step === 2 && (
          <div
            className="pointer-events-none absolute left-1/2 top-[30%]"
            style={{ transform: "translateX(-50%)" }}
          >
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: [0, 1, 1, 0], y: -18 }}
              transition={{ duration: 1.15, times: [0, 0.2, 0.7, 1] }}
            >
              <span className="rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-black text-white shadow-soft ring-1 ring-emerald-300">
                +16
              </span>
            </motion.div>
          </div>
        )}
      </div>

      {/* demo buttons with a ghost finger pressing the right one */}
      <div className="grid grid-cols-2 gap-3">
        {(["L", "R"] as Dir[]).map((d) => {
          const active = step === 2 && d === centerDir;
          return (
            <div
              key={d}
              className={
                "relative flex min-h-[52px] items-center justify-center gap-2 rounded-2xl text-base font-extrabold text-white shadow-soft ring-1 transition-transform " +
                (d === "L"
                  ? "bg-gradient-to-br from-sky-500 to-indigo-500 ring-sky-600/40"
                  : "bg-gradient-to-br from-indigo-500 to-sky-500 ring-indigo-600/40") +
                (active ? " scale-95 ring-2 ring-amber-300" : "")
              }
            >
              <span className="flex items-center gap-1.5">
                {d === "L" && <ArrowIcon left />}
                {d === "L" ? "Left" : "Right"}
                {d === "R" && <ArrowIcon left={false} />}
              </span>
              <AnimatePresence>
                {active && (
                  <motion.span
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: [0.5, 1.15, 1], opacity: [0, 0.9, 0.7] }}
                    exit={{ scale: 1.3, opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="absolute h-9 w-9 rounded-full bg-white/40 ring-2 ring-white/80"
                    aria-hidden
                  />
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {mode === "buttons" && (
        <p className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
          Keyboard: <span className="rounded-md bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">←</span>{" "}
          and <span className="rounded-md bg-slate-200 px-1.5 py-0.5 dark:bg-slate-700">→</span>
        </p>
      )}
    </div>
  );
}

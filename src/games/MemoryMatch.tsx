import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";

type Phase = "intro" | "tutorial" | "countdown" | "playing" | "done";

type Card = {
  id: number;
  symbol: string;
  matched: boolean;
  flipped: boolean;
};

const SYMBOLS = ["🍎", "🚀", "🌈", "🐙", "🎲", "🎵", "⚓️", "🌸"];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck(): Card[] {
  const pairs = shuffle(SYMBOLS).slice(0, 8);
  const doubled = shuffle([...pairs, ...pairs]);
  return doubled.map((symbol, i) => ({
    id: i,
    symbol,
    matched: false,
    flipped: false,
  }));
}

export default function MemoryMatch() {
  const game = getGame("memory");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [deck, setDeck] = useState<Card[]>([]);
  const [moves, setMoves] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [score, setScore] = useState(0);
  const [isBest, setIsBest] = useState(false);
  const busy = useRef(false);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== "playing") return;
    tickRef.current = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000);
    }, 100);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [phase, startedAt]);

  const begin = () => {
    setDeck(makeDeck());
    setMoves(0);
    setElapsed(0);
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "All cards start face-down.",
      stage: <MemoryDemo stage="hidden" />,
    },
    {
      caption: "Flip two cards at a time. Different symbols flip back.",
      stage: <MemoryDemo stage="mismatch" />,
    },
    {
      caption: "Match the symbols and the pair stays revealed.",
      stage: <MemoryDemo stage="match" />,
    },
    {
      caption:
        "Find all 8 pairs in as few moves and as little time as possible.",
      stage: <MemoryDemo stage="hidden" />,
    },
  ];

  const startPlay = () => {
    setStartedAt(Date.now());
    setPhase("playing");
  };

  const onFlip = (id: number) => {
    if (busy.current) return;
    setDeck((prev) => {
      const card = prev.find((c) => c.id === id);
      if (!card || card.matched || card.flipped) return prev;

      const flippedNow = prev.filter((c) => c.flipped && !c.matched);
      if (flippedNow.length >= 2) return prev;

      const next = prev.map((c) => (c.id === id ? { ...c, flipped: true } : c));
      const newlyFlipped = next.filter((c) => c.flipped && !c.matched);

      if (newlyFlipped.length === 2) {
        const [a, b] = newlyFlipped;
        setMoves((m) => m + 1);
        if (a.symbol === b.symbol) {
          // Match
          return next.map((c) =>
            c.id === a.id || c.id === b.id
              ? { ...c, matched: true, flipped: false }
              : c
          );
        } else {
          busy.current = true;
          window.setTimeout(() => {
            setDeck((cur) =>
              cur.map((c) =>
                c.id === a.id || c.id === b.id ? { ...c, flipped: false } : c
              )
            );
            busy.current = false;
          }, 800);
        }
      }
      return next;
    });
  };

  useEffect(() => {
    if (phase !== "playing") return;
    if (deck.length === 0) return;
    if (deck.every((c) => c.matched)) {
      const seconds = (Date.now() - startedAt) / 1000;
      // Score: fewer moves & less time → higher points. Base 1000 - penalty.
      const raw = Math.max(
        50,
        Math.round(1000 - (moves - 8) * 25 - seconds * 8)
      );
      const { isBest: best } = recordPlay("memory", raw);
      setScore(raw);
      setIsBest(best);
      setPhase("done");
    }
  }, [deck, moves, phase, recordPlay, startedAt]);

  const grid = useMemo(() => deck, [deck]);

  return (
    <GameShell game={game}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          16 cards, 8 pairs. Flip two at a time and match them all.
        </Instructions>
      )}

      {phase === "tutorial" && (
        <Tutorial steps={tutorialSteps} onDone={afterTutorial} />
      )}

      {phase === "countdown" && <Countdown onDone={startPlay} />}

      {phase === "playing" && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="chip">Moves: {moves}</span>
            <span className="chip">Time: {elapsed.toFixed(1)}s</span>
          </div>
          <div
            role="grid"
            aria-label="Memory cards"
            className="grid grid-cols-4 gap-2 sm:gap-3"
          >
            {grid.map((card) => (
              <MemoryCard
                key={card.id}
                card={card}
                onFlip={() => onFlip(card.id)}
              />
            ))}
          </div>
        </>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={score}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${moves} moves · ${elapsed.toFixed(1)}s`}
        />
      )}
    </GameShell>
  );
}

function MemoryCard({ card, onFlip }: { card: Card; onFlip: () => void }) {
  const showFace = card.flipped || card.matched;
  return (
    <motion.button
      type="button"
      role="gridcell"
      aria-label={showFace ? `Card showing ${card.symbol}` : "Hidden card"}
      aria-pressed={showFace}
      onClick={onFlip}
      whileTap={{ scale: 0.96 }}
      className="relative aspect-square min-h-[64px] w-full rounded-2xl"
    >
      <motion.span
        animate={{ rotateY: showFace ? 180 : 0 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-0 grid place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-teal text-2xl text-white shadow-soft backface-hidden"
        style={{ backfaceVisibility: "hidden" }}
        aria-hidden
      >
        ?
      </motion.span>
      <motion.span
        initial={false}
        animate={{ rotateY: showFace ? 0 : -180 }}
        transition={{ duration: 0.3 }}
        className={
          "absolute inset-0 grid place-items-center rounded-2xl text-3xl backface-hidden " +
          (card.matched
            ? "bg-emerald-100 ring-2 ring-emerald-300 dark:bg-emerald-900/50 dark:ring-emerald-700"
            : "bg-white ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700")
        }
        style={{ backfaceVisibility: "hidden" }}
        aria-hidden
      >
        {card.symbol}
      </motion.span>
    </motion.button>
  );
}

function MemoryDemo({
  stage,
}: {
  stage: "hidden" | "mismatch" | "match";
}) {
  const tiles: Array<{ face: string | null; matched?: boolean }> = [
    { face: stage === "hidden" ? null : "🍎", matched: stage === "match" },
    { face: stage === "hidden" ? null : null },
    { face: stage === "hidden" ? null : null },
    {
      face: stage === "hidden" ? null : stage === "match" ? "🍎" : "🚀",
      matched: stage === "match",
    },
  ];
  return (
    <div className="mx-auto grid max-w-[16rem] grid-cols-2 gap-3">
      {tiles.map((t, i) => (
        <div
          key={i}
          className={
            "grid aspect-square place-items-center rounded-2xl text-3xl shadow-soft " +
            (t.matched
              ? "bg-emerald-100 ring-2 ring-emerald-300"
              : t.face
              ? "bg-white ring-1 ring-slate-200"
              : "bg-gradient-to-br from-brand-500 to-accent-teal text-white")
          }
        >
          {t.face ?? "?"}
        </div>
      ))}
    </div>
  );
}

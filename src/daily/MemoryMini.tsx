import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { DailyMiniProps } from "./types";

type Card = {
  id: number;
  symbol: string;
  matched: boolean;
  flipped: boolean;
};

const SYMBOLS = ["🍎", "🚀", "🌈", "🐙", "🎲", "🎵", "⚓️", "🌸"];
const MISMATCH_MS = 700;
const TARGET_SECONDS = 40;

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

export function MemoryMini({ onComplete }: DailyMiniProps) {
  const [deck, setDeck] = useState<Card[]>(() => makeDeck());
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const busy = useRef(false);
  const startedAtRef = useRef(Date.now());
  const endedRef = useRef(false);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    tickRef.current = window.setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 100);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, []);

  const onFlip = (id: number) => {
    if (busy.current || endedRef.current) return;
    setDeck((prev) => {
      const card = prev.find((c) => c.id === id);
      if (!card || card.matched || card.flipped) return prev;
      const alreadyFlipped = prev.filter((c) => c.flipped && !c.matched);
      if (alreadyFlipped.length >= 2) return prev;
      const next = prev.map((c) =>
        c.id === id ? { ...c, flipped: true } : c
      );
      const pair = next.filter((c) => c.flipped && !c.matched);
      if (pair.length === 2) {
        const [a, b] = pair;
        setMoves((m) => m + 1);
        if (a.symbol === b.symbol) {
          const matched = next.map((c) =>
            c.id === a.id || c.id === b.id
              ? { ...c, matched: true, flipped: false }
              : c
          );
          if (matched.every((c) => c.matched) && !endedRef.current) {
            endedRef.current = true;
            const sec = (Date.now() - startedAtRef.current) / 1000;
            const score = Math.max(
              50,
              Math.round(
                400 -
                  (moves + 1 - 8) * 8 -
                  sec * 3 +
                  Math.max(0, (TARGET_SECONDS - sec) * 2)
              )
            );
            window.setTimeout(() => onComplete(score), 280);
          }
          return matched;
        }
        busy.current = true;
        window.setTimeout(() => {
          setDeck((cur) =>
            cur.map((c) =>
              c.id === a.id || c.id === b.id ? { ...c, flipped: false } : c
            )
          );
          busy.current = false;
        }, MISMATCH_MS);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3" data-testid="mini-memory">
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{moves} moves</span>
        <span>{elapsed.toFixed(1)}s</span>
      </div>
      <div
        role="grid"
        aria-label="Memory cards"
        className="grid grid-cols-4 gap-2 sm:gap-3"
      >
        {deck.map((card) => {
          const showFace = card.flipped || card.matched;
          return (
            <motion.button
              key={card.id}
              type="button"
              role="gridcell"
              data-testid="card"
              data-symbol={card.symbol}
              data-matched={card.matched ? "1" : "0"}
              data-flipped={card.flipped ? "1" : "0"}
              onClick={() => onFlip(card.id)}
              whileTap={{ scale: 0.96 }}
              className="relative aspect-square w-full rounded-2xl"
            >
              <motion.span
                animate={{ rotateY: showFace ? 180 : 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 grid place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-teal text-2xl text-white shadow-soft"
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
                  "absolute inset-0 grid place-items-center rounded-2xl text-3xl " +
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
        })}
      </div>
    </div>
  );
}

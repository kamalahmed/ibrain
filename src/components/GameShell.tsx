import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { GameMeta } from "@/lib/games";
import { GameArt } from "@/components/GameArt";

type Props = {
  game: GameMeta;
  children: ReactNode;
  toolbar?: ReactNode;
  /** Slim header during play so the game itself owns the screen. */
  compact?: boolean;
};

export function GameShell({ game, children, toolbar, compact = false }: Props) {
  return (
    <main className="mx-auto w-full max-w-3xl safe-px pb-16 pt-4 sm:pt-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <Link
            to="/dashboard"
            className="btn-ghost -ml-2 text-sm"
            aria-label="Back to dashboard"
          >
            <span aria-hidden>←</span>
            <span className={compact ? "sr-only" : ""}>Dashboard</span>
          </Link>
          {compact && (
            <span className="flex min-w-0 items-center gap-2 font-bold text-slate-900 dark:text-white">
              <span
                aria-hidden
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${game.accent} text-sm text-white`}
              >
                {game.emoji}
              </span>
              <span className="truncate text-sm sm:text-base">{game.name}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">{toolbar}</div>
      </div>
      <AnimatePresence initial={false}>
        {!compact && (
          <motion.header
            key="hero"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.25 }}
            className={`relative mb-5 overflow-hidden rounded-3xl bg-gradient-to-br ${game.accent} text-white shadow-soft`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 p-5">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 text-2xl backdrop-blur">
                  <span aria-hidden>{game.emoji}</span>
                </div>
                <div>
                  <h1 className="text-xl font-extrabold sm:text-2xl">
                    {game.name}
                  </h1>
                  <p className="text-sm text-white/90">{game.tagline}</p>
                </div>
              </div>
              <GameArt
                id={game.id}
                className="hidden h-24 w-40 shrink-0 pr-4 sm:block"
              />
            </div>
          </motion.header>
        )}
      </AnimatePresence>
      <div className="animate-fade-in">{children}</div>
    </main>
  );
}

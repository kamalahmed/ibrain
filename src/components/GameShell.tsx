import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { GameMeta } from "@/lib/games";

type Props = {
  game: GameMeta;
  children: ReactNode;
  toolbar?: ReactNode;
};

export function GameShell({ game, children, toolbar }: Props) {
  return (
    <main className="mx-auto w-full max-w-3xl safe-px pb-16 pt-4 sm:pt-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          to="/dashboard"
          className="btn-ghost -ml-2 text-sm"
          aria-label="Back to dashboard"
        >
          <span aria-hidden>←</span> Dashboard
        </Link>
        <div className="flex items-center gap-2">{toolbar}</div>
      </div>
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={`mb-5 rounded-3xl bg-gradient-to-br ${game.accent} p-5 text-white shadow-soft`}
      >
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 text-2xl backdrop-blur">
            <span aria-hidden>{game.emoji}</span>
          </div>
          <div>
            <h1 className="text-xl font-extrabold sm:text-2xl">{game.name}</h1>
            <p className="text-sm text-white/90">{game.tagline}</p>
          </div>
        </div>
      </motion.header>
      <div className="animate-fade-in">{children}</div>
    </main>
  );
}

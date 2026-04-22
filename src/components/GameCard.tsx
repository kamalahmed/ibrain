import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { GameMeta } from "@/lib/games";
import { formatScore } from "@/lib/scoring";

type Props = {
  game: GameMeta;
  best: number | undefined;
};

export function GameCard({ game, best }: Props) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
    >
      <Link
        to={game.path}
        className="group block overflow-hidden rounded-3xl ring-1 ring-slate-200/70 dark:ring-slate-800"
        aria-label={`Play ${game.name}`}
      >
        <div className={`bg-gradient-to-br ${game.accent} p-5 text-white`}>
          <div className="flex items-center justify-between">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 text-2xl backdrop-blur">
              <span aria-hidden>{game.emoji}</span>
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              Best {best === undefined ? "—" : formatScore(game.id, best)}
            </span>
          </div>
          <h3 className="mt-4 text-lg font-extrabold sm:text-xl">{game.name}</h3>
          <p className="text-sm text-white/90">{game.tagline}</p>
        </div>
        <div className="flex items-center justify-between bg-white/90 px-5 py-3 text-sm font-semibold text-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
          <span>Play now</span>
          <span
            aria-hidden
            className="translate-x-0 text-brand-600 transition-transform group-hover:translate-x-1 dark:text-brand-300"
          >
            →
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

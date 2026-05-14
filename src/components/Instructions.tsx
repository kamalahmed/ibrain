import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { GameMeta } from "@/lib/games";
import { DOMAINS } from "@/lib/games";
import { formatScore } from "@/lib/scoring";
import { useStore } from "@/store/useStore";
import { DomainBadge } from "@/components/DomainBadge";
import { fadeUp } from "@/lib/motion";

type Props = {
  game: GameMeta;
  onStart: () => void;
  children?: ReactNode;
};

export function Instructions({ game, onStart, children }: Props) {
  const best = useStore((s) => s.bestScores[game.id]);
  const domain = DOMAINS[game.domain];
  return (
    <motion.section
      aria-labelledby="how-to-play"
      className="card"
      initial={fadeUp.initial}
      animate={fadeUp.animate}
      transition={fadeUp.transition}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="how-to-play"
          className="text-lg font-bold text-slate-900 dark:text-white"
        >
          How to play
        </h2>
        <DomainBadge domain={game.domain} />
      </div>
      <p className="mt-2 text-slate-700 dark:text-slate-300">
        {game.description}
      </p>
      {children && (
        <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          {children}
        </div>
      )}

      <div className="mt-4 rounded-2xl bg-brand-50/70 p-4 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:ring-brand-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-200">
          What this trains · {domain.name}
        </p>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
          {game.trains}
        </p>
      </div>

      <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <span className="text-slate-500 dark:text-slate-400">Your best:</span>{" "}
          <span className="font-bold text-slate-900 dark:text-white">
            {best === undefined ? "—" : formatScore(game.id, best)}
          </span>
        </div>
        <button type="button" className="btn-primary" onClick={onStart}>
          Start
        </button>
      </div>
    </motion.section>
  );
}

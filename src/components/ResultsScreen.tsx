import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { GameMeta } from "@/lib/games";
import { formatScore } from "@/lib/scoring";
import { useStore } from "@/store/useStore";

type Props = {
  game: GameMeta;
  score: number;
  isBest: boolean;
  onPlayAgain: () => void;
  detail?: string;
};

export function ResultsScreen({
  game,
  score,
  isBest,
  onPlayAgain,
  detail,
}: Props) {
  const best = useStore((s) => s.bestScores[game.id]);
  return (
    <motion.section
      aria-labelledby="results-heading"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 24 }}
      className="card text-center"
    >
      <h2 id="results-heading" className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {isBest ? "New best!" : "Round complete"}
      </h2>
      <p className="mt-2 text-5xl font-black text-slate-900 dark:text-white sm:text-6xl">
        {formatScore(game.id, score)}
      </p>
      {detail && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{detail}</p>
      )}
      <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
        Personal best:{" "}
        <span className="font-semibold text-slate-900 dark:text-white">
          {best === undefined ? "—" : formatScore(game.id, best)}
        </span>
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button type="button" className="btn-primary" onClick={onPlayAgain}>
          Play again
        </button>
        <Link to="/dashboard" className="btn-secondary">
          Back to dashboard
        </Link>
      </div>
    </motion.section>
  );
}

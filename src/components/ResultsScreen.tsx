import { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { GameMeta } from "@/lib/games";
import { DOMAINS } from "@/lib/games";
import { formatScore, normalizeScore, clamp } from "@/lib/scoring";
import { useStore } from "@/store/useStore";
import { Confetti } from "@/components/Confetti";
import { DomainBadge } from "@/components/DomainBadge";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";

type Props = {
  game: GameMeta;
  score: number;
  isBest: boolean;
  onPlayAgain: () => void;
  detail?: string;
};

/** Coarse skill tier for the normalized 0-100 rating. */
function skillTier(rating: number): string {
  if (rating >= 85) return "Elite";
  if (rating >= 65) return "Strong";
  if (rating >= 40) return "Solid";
  if (rating >= 15) return "Building";
  return "Warming up";
}

export function ResultsScreen({
  game,
  score,
  isBest,
  onPlayAgain,
  detail,
}: Props) {
  const best = useStore((s) => s.bestScores[game.id]);
  const history = useStore((s) => s.history);

  useEffect(() => {
    if (isBest) haptic.success();
  }, [isBest]);

  // recordPlay() runs before this screen mounts, so history[0] for this game
  // is the session we just finished — previous plays start at index 1.
  const prior = history
    .filter((h) => h.game === game.id)
    .slice(1, 6)
    .map((h) => h.score);
  const baseline =
    prior.length > 0
      ? prior.reduce((a, b) => a + b, 0) / prior.length
      : null;
  const deltaPct =
    baseline && baseline > 0
      ? Math.round(((score - baseline) / baseline) * 100)
      : null;

  const rating = Math.round(normalizeScore(game.id, score));
  const domain = DOMAINS[game.domain];

  let comparison: { text: string; tone: "up" | "down" | "flat" | "new" };
  if (baseline === null) {
    comparison = { text: "First session — this sets your baseline.", tone: "new" };
  } else if (deltaPct !== null && deltaPct >= 5) {
    comparison = {
      text: `+${deltaPct}% above your recent average`,
      tone: "up",
    };
  } else if (deltaPct !== null && deltaPct <= -5) {
    comparison = {
      text: `${deltaPct}% below your recent average`,
      tone: "down",
    };
  } else {
    comparison = { text: "On par with your recent average", tone: "flat" };
  }

  const toneClass =
    comparison.tone === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : comparison.tone === "down"
      ? "text-rose-600 dark:text-rose-400"
      : "text-slate-500 dark:text-slate-400";

  return (
    <motion.section
      aria-labelledby="results-heading"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.soft}
      className="card relative overflow-hidden text-center"
    >
      {isBest && <Confetti />}
      <div className="flex items-center justify-center gap-2">
        <h2
          id="results-heading"
          className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        >
          {isBest ? "New best!" : "Round complete"}
        </h2>
        <DomainBadge domain={game.domain} />
      </div>
      <p className="mt-2 text-5xl font-black text-slate-900 dark:text-white sm:text-6xl">
        {formatScore(game.id, score)}
      </p>
      {detail && (
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {detail}
        </p>
      )}

      {/* Skill rating — the normalized 0-100 this session contributes to your
          brain score, framed as a legible cognitive measure. */}
      <div className="mx-auto mt-5 max-w-sm rounded-2xl bg-slate-50 p-4 text-left ring-1 ring-slate-200/80 dark:bg-slate-800/60 dark:ring-slate-700">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {domain.name} skill
          </span>
          <span className="text-sm font-bold text-slate-900 dark:text-white">
            {skillTier(rating)} · {rating}
            <span className="text-slate-400"> / 100</span>
          </span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <motion.div
            className={`h-full rounded-full bg-gradient-to-r ${domain.accent}`}
            initial={{ width: 0 }}
            animate={{ width: `${clamp(rating)}%` }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          />
        </div>
        <p className={`mt-2 text-xs font-semibold ${toneClass}`}>
          {comparison.tone === "up"
            ? "▲ "
            : comparison.tone === "down"
            ? "▼ "
            : ""}
          {comparison.text}
        </p>
      </div>

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

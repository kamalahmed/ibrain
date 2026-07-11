import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { GameMeta } from "@/lib/games";
import { DOMAINS } from "@/lib/games";
import { formatScore } from "@/lib/scoring";
import { timeAgo } from "@/lib/date";
import { Sparkline, computeTrendPct } from "@/components/Sparkline";
import { GameArt } from "@/components/GameArt";

type Props = {
  game: GameMeta;
  best: number | undefined;
  /** Chronological score history for this game (oldest first). */
  history?: number[];
  /** Epoch ms of the most recent session, if any. */
  lastPlayedAt?: number;
  /** Coach's pick — highlighted as today's suggested game. */
  recommended?: boolean;
};

export function GameCard({
  game,
  best,
  history = [],
  lastPlayedAt,
  recommended = false,
}: Props) {
  const trim = history.slice(-12);
  const trend = computeTrendPct(trim, 5);
  const hasHistory = trim.length > 0;

  const trendBadge =
    trim.length < 2
      ? null
      : trend >= 5
      ? { label: `+${trend}%`, classes: "bg-emerald-100/80 text-emerald-700" }
      : trend <= -5
      ? { label: `${trend}%`, classes: "bg-rose-100/80 text-rose-700" }
      : { label: "flat", classes: "bg-slate-200/70 text-slate-700" };

  return (
    <motion.div
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="h-full"
    >
      <Link
        to={game.path}
        className={
          "group flex h-full flex-col overflow-hidden rounded-3xl ring-1 " +
          (recommended
            ? "ring-2 ring-brand-500 shadow-soft dark:ring-brand-400"
            : "ring-slate-200/70 dark:ring-slate-800")
        }
        aria-label={`Play ${game.name}`}
      >
        <div
          className={`relative bg-gradient-to-br ${game.accent} p-4 pb-2 text-white`}
        >
          {recommended && (
            <span className="absolute right-3 top-3 z-10 rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-brand-700 shadow-soft">
              ★ Coach's pick
            </span>
          )}
          <div className="flex items-start justify-between gap-2 pr-1">
            <div>
              <h3 className="text-lg font-extrabold leading-tight sm:text-xl">
                {game.name}
              </h3>
              <span className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur">
                {DOMAINS[game.domain].name}
              </span>
            </div>
            {!recommended && (
              <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
                Best {best === undefined ? "—" : formatScore(game.id, best)}
              </span>
            )}
          </div>
          <GameArt
            id={game.id}
            className="mx-auto mt-1 h-28 w-full max-w-[15rem] drop-shadow-sm transition-transform duration-300 group-hover:scale-[1.04]"
          />
        </div>
        <div className="flex flex-1 items-center justify-between gap-3 bg-white/90 px-5 py-3 text-sm font-semibold text-slate-800 dark:bg-slate-900/80 dark:text-slate-100">
          {hasHistory ? (
            <div className="flex min-w-0 items-center gap-2" data-testid="game-card-trend">
              <Sparkline
                values={trim}
                width={96}
                height={28}
                colorClass="text-brand-500 dark:text-brand-300"
                ariaLabel={`${game.name} trend over last ${trim.length} plays`}
              />
              {trendBadge && (
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] font-bold dark:bg-opacity-30 " +
                    trendBadge.classes
                  }
                  aria-label={`trend ${trendBadge.label}`}
                >
                  {trendBadge.label}
                </span>
              )}
              {lastPlayedAt !== undefined && (
                <span className="hidden truncate text-[11px] font-medium text-slate-400 dark:text-slate-500 sm:inline">
                  {timeAgo(lastPlayedAt)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">
              New — give it a try
            </span>
          )}
          <span
            aria-hidden
            className="translate-x-0 text-brand-600 transition-transform group-hover:translate-x-1 dark:text-brand-300"
          >
            Play →
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

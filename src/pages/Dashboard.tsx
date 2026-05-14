import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { GameCard } from "@/components/GameCard";
import { Sparkline, computeTrendPct } from "@/components/Sparkline";
import { CountUp } from "@/components/CountUp";
import { GAMES, DOMAINS, DOMAIN_ORDER, type GameId } from "@/lib/games";
import { formatScore } from "@/lib/scoring";
import {
  selectBrainScore,
  selectDomainScores,
  useStore,
} from "@/store/useStore";
import { fadeUp } from "@/lib/motion";
import { todayKey } from "@/lib/date";
import { DAILY_GAMES } from "@/daily/types";

export default function Dashboard() {
  const bestScores = useStore((s) => s.bestScores);
  const streak = useStore((s) => s.streak);
  const brainScore = useStore(selectBrainScore);
  const history = useStore((s) => s.history);
  const resetTutorials = useStore((s) => s.resetTutorials);
  const dailyStreak = useStore((s) => s.dailyStreak);
  const bestDaily = useStore((s) => s.bestDaily);
  const lastDailyDate = useStore((s) => s.lastDailyDate);
  const dailyResults = useStore((s) => s.dailyResults);
  const domainScores = useStore(selectDomainScores);
  const doneToday = lastDailyDate === todayKey();
  const recent = history.slice(0, 5);
  const totalPlayed = history.length;

  // Per-game chronological history (oldest → newest), last 12 each
  const perGameHistory: Record<GameId, number[]> = GAMES.reduce(
    (acc, g) => {
      acc[g.id] = history
        .filter((h) => h.game === g.id)
        .slice(0, 12)
        .reverse()
        .map((h) => h.score);
      return acc;
    },
    {} as Record<GameId, number[]>
  );

  // Daily totals (oldest → newest), last 14, non-practice only
  const dailyTrend = dailyResults
    .filter((r) => !r.isPractice)
    .slice(0, 14)
    .reverse()
    .map((r) => r.totalScore);
  const dailyTrendPct = computeTrendPct(dailyTrend, 5);

  return (
    <main className="mx-auto max-w-5xl safe-px pb-16 pt-6">
      <section aria-label="Your stats" className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Brain score"
          value={brainScore}
          sub="avg of your bests"
          highlight
          animate
        />
        <StatCard
          label="Daily streak"
          value={streak}
          sub={streak === 1 ? "day" : "days"}
          icon="🔥"
          flame
        />
        <StatCard
          label="Games played"
          value={totalPlayed}
          sub="total sessions"
          animate
        />
      </section>

      <section aria-label="Daily challenge" className="mt-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-accent-blue to-accent-teal p-5 text-white shadow-soft sm:p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/80">
                <span aria-hidden>🗓️</span> Daily Challenge
              </div>
              <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">
                {doneToday ? "You trained today ✓" : "Today's training is waiting"}
              </h2>
              <p className="mt-1 max-w-prose text-sm text-white/90">
                One short run of each of the {DAILY_GAMES.length} games, back-to-back. ~5 minutes.
                Keeps your streak alive.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-xl bg-white/15 px-3 py-1 backdrop-blur">
                  Streak <strong>{dailyStreak}</strong> {dailyStreak === 1 ? "day" : "days"}
                </span>
                <span className="rounded-xl bg-white/15 px-3 py-1 backdrop-blur">
                  Best <strong>{bestDaily}</strong> pts
                </span>
                {dailyTrend.length >= 1 && (
                  <span
                    className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-1 backdrop-blur"
                    data-testid="daily-trend"
                  >
                    <Sparkline
                      values={dailyTrend}
                      width={96}
                      height={20}
                      colorClass="text-white"
                      ariaLabel="daily totals trend"
                    />
                    {dailyTrend.length >= 2 && (
                      <span className="text-[11px] font-bold">
                        {dailyTrendPct > 0 ? "+" : ""}
                        {dailyTrendPct}%
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            <Link
              to="/daily"
              className="self-start rounded-xl bg-white px-4 py-2 text-sm font-bold text-brand-700 shadow-soft hover:bg-brand-50 sm:self-center"
              data-testid="daily-card-cta"
            >
              {doneToday ? "Practice →" : "Start →"}
            </Link>
          </div>
        </motion.div>
      </section>

      <section aria-label="Cognitive areas" className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
            Cognitive areas
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Where your training is landing.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOMAIN_ORDER.map((id, i) => {
            const meta = DOMAINS[id];
            const ds = domainScores[id];
            const started = ds && ds.played > 0;
            return (
              <motion.div
                key={id}
                initial={fadeUp.initial}
                animate={fadeUp.animate}
                transition={{ ...fadeUp.transition, delay: i * 0.05 }}
                className="card p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    {meta.name}
                  </h3>
                  <span className="text-sm font-black text-slate-900 dark:text-white">
                    {started ? ds.score : "—"}
                    <span className="text-xs font-semibold text-slate-400">
                      {" "}
                      / 100
                    </span>
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <motion.div
                    className={`h-full rounded-full bg-gradient-to-r ${meta.accent}`}
                    initial={{ width: 0 }}
                    animate={{ width: started ? `${ds.score}%` : "0%" }}
                    transition={{
                      duration: 0.7,
                      ease: [0.22, 1, 0.36, 1],
                      delay: 0.1 + i * 0.05,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {meta.blurb}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  {started
                    ? `${ds.played} / ${ds.total} game${
                        ds.total === 1 ? "" : "s"
                      } trained`
                    : `${ds.total} game${ds.total === 1 ? "" : "s"} — not started`}
                </p>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section aria-label="Games" className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
            Train one game
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Full 5-level session for any game.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((g) => (
            <GameCard
              key={g.id}
              game={g}
              best={bestScores[g.id]}
              history={perGameHistory[g.id]}
            />
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section aria-label="Recent sessions" className="mt-10">
          <h2 className="mb-3 text-lg font-extrabold text-slate-900 dark:text-white">
            Recent sessions
          </h2>
          <ul className="card divide-y divide-slate-200/70 p-0 dark:divide-slate-800">
            {recent.map((r) => {
              const meta = GAMES.find((g) => g.id === r.game)!;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br ${meta.accent} text-lg text-white`}
                      aria-hidden
                    >
                      {meta.emoji}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {meta.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(r.playedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {formatScore(r.game, r.score)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="Preferences" className="mt-10 flex justify-center">
        <button
          type="button"
          onClick={() => resetTutorials()}
          className="btn-ghost text-sm"
        >
          Replay tutorials
        </button>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
  animate,
  icon,
  flame,
}: {
  label: string;
  value: number;
  sub?: string;
  highlight?: boolean;
  animate?: boolean;
  icon?: string;
  flame?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={
        highlight
          ? "rounded-3xl bg-gradient-to-br from-brand-600 to-accent-teal p-5 text-white shadow-soft"
          : "card"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={
            "text-xs font-semibold uppercase tracking-wide " +
            (highlight ? "text-white/80" : "text-slate-500 dark:text-slate-400")
          }
        >
          {label}
        </p>
        {icon && (
          <motion.span
            aria-hidden
            className="text-xl leading-none"
            initial={flame ? { scale: 0.6, rotate: -8 } : { scale: 1 }}
            animate={flame ? { scale: 1, rotate: 0 } : { scale: 1 }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 12,
              delay: 0.15,
            }}
          >
            {icon}
          </motion.span>
        )}
      </div>
      <p
        className={
          "mt-1 text-3xl font-black " +
          (highlight ? "text-white" : "text-slate-900 dark:text-white")
        }
        data-testid={
          highlight
            ? "stat-brain-score"
            : flame
            ? "stat-streak"
            : "stat-games-played"
        }
      >
        {animate ? <CountUp value={value} /> : String(value)}
      </p>
      {sub && (
        <p
          className={
            "mt-0.5 text-xs " +
            (highlight ? "text-white/80" : "text-slate-500 dark:text-slate-400")
          }
        >
          {sub}
        </p>
      )}
    </motion.div>
  );
}

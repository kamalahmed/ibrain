import { motion } from "framer-motion";
import { GameCard } from "@/components/GameCard";
import { GAMES } from "@/lib/games";
import { formatScore } from "@/lib/scoring";
import { selectBrainScore, selectRecent, useStore } from "@/store/useStore";

export default function Dashboard() {
  const bestScores = useStore((s) => s.bestScores);
  const streak = useStore((s) => s.streak);
  const brainScore = useStore(selectBrainScore);
  const recent = useStore((s) => selectRecent(s, 5));
  const totalPlayed = useStore((s) => s.history.length);

  return (
    <main className="mx-auto max-w-5xl safe-px pb-16 pt-6">
      <section aria-label="Your stats" className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Brain score"
          value={String(brainScore)}
          sub="avg of your bests"
          highlight
        />
        <StatCard
          label="Daily streak"
          value={`${streak}`}
          sub={streak === 1 ? "day" : "days"}
        />
        <StatCard
          label="Games played"
          value={String(totalPlayed)}
          sub="total sessions"
        />
      </section>

      <section aria-label="Games" className="mt-8">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
            Today's workout
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Pick any game to begin.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((g) => (
            <GameCard key={g.id} game={g} best={bestScores[g.id]} />
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
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
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
      <p
        className={
          "text-xs font-semibold uppercase tracking-wide " +
          (highlight ? "text-white/80" : "text-slate-500 dark:text-slate-400")
        }
      >
        {label}
      </p>
      <p
        className={
          "mt-1 text-3xl font-black " +
          (highlight ? "text-white" : "text-slate-900 dark:text-white")
        }
      >
        {value}
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

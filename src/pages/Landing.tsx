import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { DOMAINS, DOMAIN_ORDER, GAMES } from "@/lib/games";
import { selectBrainScore, useStore } from "@/store/useStore";
import { GameArt } from "@/components/GameArt";

const ROTATE_MS = 3800;

export default function Landing() {
  const brainScore = useStore(selectBrainScore);
  const streak = useStore((s) => s.streak);
  const sessions = useStore((s) => s.history.length);
  const returning = sessions > 0;

  const [featured, setFeatured] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setFeatured((i) => (i + 1) % GAMES.length),
      ROTATE_MS
    );
    return () => window.clearInterval(id);
  }, []);
  const game = GAMES[featured];

  return (
    <main className="mx-auto max-w-5xl safe-px pb-16 pt-6 sm:pt-10">
      <section className="grid items-center gap-8 sm:grid-cols-2 sm:gap-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <span className="chip">
            {returning ? (
              <>🔥 {streak}-day streak · welcome back</>
            ) : (
              <>🧠 {GAMES.length} games · {DOMAIN_ORDER.length} cognitive areas</>
            )}
          </span>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            {returning ? "Keep your streak alive." : "Sharpen your mind."}{" "}
            <span className="bg-gradient-to-r from-brand-600 to-accent-teal bg-clip-text text-transparent">
              Five minutes a day.
            </span>
          </h1>
          <p className="mt-4 max-w-prose text-lg text-slate-600 dark:text-slate-300">
            {returning
              ? "Your daily challenge is one short run of every game — quick wins for your focus, memory and speed."
              : "iBrain is a tiny, science-inspired workout for your focus, memory and reaction time. No accounts, no ads — your streak lives right in your browser."}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/daily" className="btn-primary">
              {returning ? "Continue training →" : "Today's challenge →"}
            </Link>
            <Link to="/dashboard" className="btn-secondary">
              {returning ? "My dashboard" : "Browse games"}
            </Link>
          </div>
          <dl className="mt-8 grid max-w-md grid-cols-3 gap-4 text-center">
            {returning ? (
              <>
                <Stat label="Brain score" value={String(brainScore)} />
                <Stat label="Streak" value={`${streak}d`} />
                <Stat label="Sessions" value={String(sessions)} />
              </>
            ) : (
              <>
                <Stat label="Games" value={GAMES.length.toString()} />
                <Stat label="Min / day" value="~5" />
                <Stat label="Areas" value={DOMAIN_ORDER.length.toString()} />
              </>
            )}
          </dl>
        </motion.div>

        {/* Rotating live showcase — every few seconds the featured game swaps
            in with its animated scene, so visitors instantly see the games. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative mx-auto w-full max-w-md"
        >
          <div
            className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-brand-500 via-accent-blue to-accent-teal opacity-60 blur-2xl"
            aria-hidden
          />
          <div className="relative rounded-[36px] bg-white/70 p-4 ring-1 ring-slate-200/70 backdrop-blur-md dark:bg-slate-900/60 dark:ring-slate-800">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={game.id}
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <Link
                  to={game.path}
                  className={`block overflow-hidden rounded-3xl bg-gradient-to-br ${game.accent} p-5 text-white shadow-soft`}
                  aria-label={`Play ${game.name}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-lg font-extrabold">{game.name}</p>
                      <p className="text-xs text-white/85">{game.tagline}</p>
                    </div>
                    <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide backdrop-blur">
                      {DOMAINS[game.domain].name}
                    </span>
                  </div>
                  <GameArt id={game.id} animated className="mt-3 h-44 w-full" />
                </Link>
              </motion.div>
            </AnimatePresence>
            <div
              className="mt-3 flex items-center justify-center gap-1.5"
              role="tablist"
              aria-label="Featured game"
            >
              {GAMES.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={i === featured}
                  aria-label={g.name}
                  onClick={() => setFeatured(i)}
                  className={
                    "h-2.5 rounded-full transition-all " +
                    (i === featured
                      ? "w-6 bg-brand-500"
                      : "w-2.5 bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600")
                  }
                />
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      <section id="games" className="mt-16 scroll-mt-20">
        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
          Meet the games
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Each one trains a different cognitive area — tap any to jump in.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((g, i) => (
            <motion.article
              key={g.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 + (i % 3) * 0.06 }}
            >
              <Link
                to={g.path}
                className="group block h-full overflow-hidden rounded-3xl ring-1 ring-slate-200/70 transition-shadow hover:shadow-soft dark:ring-slate-800"
                aria-label={`Play ${g.name}`}
              >
                <div className={`bg-gradient-to-br ${g.accent} px-4 pt-3`}>
                  <GameArt
                    id={g.id}
                    className="mx-auto h-24 w-full max-w-[13rem] transition-transform duration-300 group-hover:scale-[1.05]"
                  />
                </div>
                <div className="bg-white/90 p-4 dark:bg-slate-900/80">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-white">
                      {g.name}
                    </h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {DOMAINS[g.domain].name}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {g.tagline}
                  </p>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link to="/dashboard" className="btn-primary">
            Go to dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-slate-200/70 dark:bg-slate-900/60 dark:ring-slate-800">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-black text-slate-900 dark:text-white">
        {value}
      </dd>
    </div>
  );
}

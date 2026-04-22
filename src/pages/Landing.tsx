import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GAMES } from "@/lib/games";

export default function Landing() {
  return (
    <main className="mx-auto max-w-5xl safe-px pb-16 pt-6 sm:pt-10">
      <section className="grid items-center gap-8 sm:grid-cols-2 sm:gap-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <span className="chip" aria-hidden>
            🧠 Train daily · 5 mini-games
          </span>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            Sharpen your mind.{" "}
            <span className="bg-gradient-to-r from-brand-600 to-accent-teal bg-clip-text text-transparent">
              Five minutes a day.
            </span>
          </h1>
          <p className="mt-4 max-w-prose text-lg text-slate-600 dark:text-slate-300">
            iBrain is a tiny, Lumosity-style workout for your focus, memory and
            reaction time. No accounts, no ads — your streak lives right in
            your browser.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/dashboard" className="btn-primary">
              Start training →
            </Link>
            <a href="#games" className="btn-secondary">
              See the games
            </a>
          </div>
          <dl className="mt-8 grid max-w-md grid-cols-3 gap-4 text-center">
            <Stat label="Games" value="5" />
            <Stat label="Minutes" value="5" />
            <Stat label="Backend" value="None" />
          </dl>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative mx-auto aspect-square w-full max-w-md"
          aria-hidden
        >
          <div className="absolute inset-0 rounded-[36px] bg-gradient-to-br from-brand-500 via-accent-blue to-accent-teal opacity-90 blur-2xl" />
          <div className="relative grid h-full w-full grid-cols-2 grid-rows-2 gap-3 rounded-[36px] bg-white/70 p-4 ring-1 ring-slate-200/70 backdrop-blur-md dark:bg-slate-900/60 dark:ring-slate-800">
            {GAMES.slice(0, 4).map((g) => (
              <div
                key={g.id}
                className={`flex flex-col justify-between rounded-2xl bg-gradient-to-br ${g.accent} p-4 text-white shadow-soft`}
              >
                <span className="text-3xl">{g.emoji}</span>
                <div>
                  <p className="text-sm font-bold">{g.name}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      <section id="games" className="mt-16 scroll-mt-20">
        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
          Meet the games
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((g) => (
            <article key={g.id} className="card">
              <div className="flex items-start gap-3">
                <div
                  className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${g.accent} text-xl text-white shadow-soft`}
                >
                  <span aria-hidden>{g.emoji}</span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    {g.name}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    {g.tagline}
                  </p>
                </div>
              </div>
            </article>
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

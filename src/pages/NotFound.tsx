import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center safe-px text-center">
      <div className="text-6xl" aria-hidden>
        🧭
      </div>
      <h1 className="mt-4 text-3xl font-extrabold text-slate-900 dark:text-white">
        Lost in thought?
      </h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        We couldn't find that page.
      </p>
      <Link to="/" className="btn-primary mt-6">
        Back home
      </Link>
    </main>
  );
}

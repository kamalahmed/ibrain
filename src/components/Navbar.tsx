import { Link, NavLink } from "react-router-dom";
import { useStore } from "@/store/useStore";

export function Navbar() {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-white/70 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/70">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-5xl items-center justify-between gap-3 safe-px py-3"
      >
        <Link
          to="/"
          className="flex items-center gap-2 font-extrabold tracking-tight text-slate-900 dark:text-white"
          aria-label="iBrain home"
        >
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-teal text-white shadow-soft"
          >
            🧠
          </span>
          <span className="text-lg">iBrain</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <NavLink
            to="/daily"
            className={({ isActive }) =>
              "rounded-xl px-3 py-2 text-sm font-semibold transition-colors " +
              (isActive
                ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")
            }
          >
            Daily
          </NavLink>
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              "rounded-xl px-3 py-2 text-sm font-semibold transition-colors " +
              (isActive
                ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={({ isActive }) =>
              "grid h-10 w-10 place-items-center rounded-xl transition-colors " +
              (isActive
                ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800")
            }
          >
            <span aria-hidden>⚙️</span>
          </NavLink>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="grid h-10 w-10 place-items-center rounded-xl text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isDark ? "☀️" : "🌙"}
          </button>
        </div>
      </nav>
    </header>
  );
}

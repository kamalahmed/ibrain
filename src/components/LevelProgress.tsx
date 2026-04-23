import { motion } from "framer-motion";

type Props = {
  total: number;
  current: number; // 1-indexed index of the active level
  cleared: number; // count of cleared levels (0..total)
  label?: string;
};

export function LevelProgress({ total, current, cleared, label }: Props) {
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const state: "done" | "active" | "todo" =
            n <= cleared ? "done" : n === current ? "active" : "todo";
          return (
            <motion.span
              key={n}
              aria-label={`Level ${n} ${state}`}
              initial={false}
              animate={{
                scale: state === "active" ? 1.1 : 1,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className={
                "grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold " +
                (state === "done"
                  ? "bg-brand-600 text-white"
                  : state === "active"
                  ? "bg-white text-brand-700 ring-2 ring-brand-500 dark:bg-slate-900 dark:text-brand-300 dark:ring-brand-400"
                  : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400")
              }
            >
              {state === "done" ? "✓" : n}
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}

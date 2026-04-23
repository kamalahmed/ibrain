import { motion } from "framer-motion";

type Props = {
  levelJustCleared: number;
  totalLevels: number;
  levelScore: number;
  nextLabel?: string;
};

export function LevelComplete({
  levelJustCleared,
  totalLevels,
  levelScore,
  nextLabel,
}: Props) {
  const isLast = levelJustCleared >= totalLevels;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className="mx-auto grid min-h-[26vh] max-w-md place-items-center rounded-3xl bg-gradient-to-br from-brand-500 to-accent-teal p-6 text-center text-white shadow-soft"
      role="status"
      aria-live="polite"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-white/80">
          Level {levelJustCleared} cleared
        </p>
        <p className="mt-1 text-4xl font-black sm:text-5xl">+{levelScore}</p>
        <p className="mt-3 text-sm text-white/90">
          {isLast
            ? "Session complete!"
            : nextLabel
            ? `Up next: ${nextLabel}`
            : `Level ${levelJustCleared + 1} coming up…`}
        </p>
      </div>
    </motion.div>
  );
}

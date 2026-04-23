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
      initial={{ opacity: 0, scale: 0.9, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 22, mass: 0.6 }}
      className="mx-auto grid min-h-[26vh] max-w-md place-items-center rounded-3xl bg-gradient-to-br from-brand-500 to-accent-teal p-6 text-center text-white shadow-soft"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-2">
        <motion.div
          initial={{ scale: 0, rotate: -20, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 500,
            damping: 18,
            delay: 0.08,
          }}
          className="grid h-12 w-12 place-items-center rounded-full bg-white/25 text-2xl backdrop-blur"
          aria-hidden
        >
          {isLast ? "🏆" : "✓"}
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.2 }}
          className="text-xs font-semibold uppercase tracking-wide text-white/80"
        >
          Level {levelJustCleared} cleared
        </motion.p>
        <motion.p
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            type: "spring",
            stiffness: 360,
            damping: 20,
            delay: 0.22,
          }}
          className="text-4xl font-black sm:text-5xl"
        >
          +{levelScore}
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.22 }}
          className="mt-1 text-sm text-white/90"
        >
          {isLast
            ? "Session complete!"
            : nextLabel
            ? `Up next: ${nextLabel}`
            : `Level ${levelJustCleared + 1} coming up…`}
        </motion.p>
      </div>
    </motion.div>
  );
}

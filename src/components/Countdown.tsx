import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Props = {
  from?: number;
  onDone: () => void;
};

export function Countdown({ from = 3, onDone }: Props) {
  const [n, setN] = useState(from);

  useEffect(() => {
    if (n <= 0) {
      onDone();
      return;
    }
    const id = window.setTimeout(() => setN((v) => v - 1), 750);
    return () => window.clearTimeout(id);
  }, [n, onDone]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-[40vh] place-items-center"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={n}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 1.6, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="grid h-40 w-40 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-accent-teal text-6xl font-black text-white shadow-soft sm:h-56 sm:w-56 sm:text-7xl"
        >
          {n > 0 ? n : "Go!"}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

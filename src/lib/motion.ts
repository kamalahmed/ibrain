import type { Transition, Variants } from "framer-motion";

/**
 * Shared motion vocabulary so every screen reaches for the same springs and
 * easings — the difference between a pile of one-off animations and something
 * that feels like one product.
 */

export const spring = {
  /** Calm settle for entrances and layout shifts. */
  soft: { type: "spring", stiffness: 260, damping: 26 } as Transition,
  /** Quick and decisive for taps and toggles. */
  snappy: { type: "spring", stiffness: 380, damping: 28 } as Transition,
  /** A little overshoot for celebratory moments. */
  bouncy: { type: "spring", stiffness: 300, damping: 18 } as Transition,
};

/** Soft cubic-bezier for fades that shouldn't feel mechanical. */
export const ease = [0.22, 1, 0.36, 1] as const;

/** Standard "rise into place" entrance for cards and sections. */
export const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, ease },
};

/** Pop entrance for hero numbers and badges. */
export const pop = {
  initial: { opacity: 0, scale: 0.92 },
  animate: { opacity: 1, scale: 1 },
  transition: spring.bouncy,
};

/** Parent for staggered lists — pair with `staggerItem` on children. */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease } },
};

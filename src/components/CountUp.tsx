import { useEffect, useRef } from "react";
import {
  animate,
  useMotionValue,
  useReducedMotion,
  useTransform,
  motion,
} from "framer-motion";

type Props = {
  value: number;
  duration?: number; // seconds
  className?: string;
  ariaLabel?: string;
};

export function CountUp({ value, duration = 0.7, className, ariaLabel }: Props) {
  const mv = useMotionValue(value);
  const rounded = useTransform(mv, (n) => Math.round(n).toString());
  const prevRef = useRef(value);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      mv.set(value);
      prevRef.current = value;
      return;
    }
    const controls = animate(mv, value, {
      duration,
      ease: [0.22, 0.61, 0.36, 1],
    });
    prevRef.current = value;
    return () => controls.stop();
  }, [value, duration, mv, reduced]);

  return (
    <motion.span className={className} aria-label={ariaLabel}>
      {rounded}
    </motion.span>
  );
}

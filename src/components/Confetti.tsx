import { useMemo } from "react";
import { motion } from "framer-motion";

const COLORS = ["#7e4dff", "#2dd4bf", "#38bdf8", "#f472b6", "#fbbf24"];

type Props = {
  count?: number;
};

export function Confetti({ count = 40 }: Props) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.25,
        duration: 1.4 + Math.random() * 0.9,
        rotate: Math.random() * 360,
        color: COLORS[i % COLORS.length],
        w: 6 + Math.random() * 6,
        h: 10 + Math.random() * 8,
        drift: (Math.random() - 0.5) * 80,
      })),
    [count]
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          initial={{ y: -20, x: 0, rotate: 0, opacity: 1 }}
          animate={{
            y: "110%",
            x: p.drift,
            rotate: p.rotate,
            opacity: [1, 1, 0.6, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: "easeIn",
          }}
          style={{
            position: "absolute",
            top: 0,
            left: `${p.left}%`,
            width: p.w,
            height: p.h,
            background: p.color,
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

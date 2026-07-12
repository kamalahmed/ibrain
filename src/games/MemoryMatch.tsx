import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { Countdown } from "@/components/Countdown";
import { ResultsScreen } from "@/components/ResultsScreen";
import { Tutorial, type TutorialStep } from "@/components/Tutorial";
import { LevelComplete } from "@/components/LevelComplete";
import { GameHUD } from "@/components/GameHUD";
import { getGame } from "@/lib/games";
import { haptic } from "@/lib/haptics";
import { useStore } from "@/store/useStore";

type Phase =
  | "intro"
  | "tutorial"
  | "countdown"
  | "playing"
  | "levelDone"
  | "done";

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

const SESSION_SECONDS = 180; // 3-minute session
const POINTS_PER_MATCH = 14;
const LEVEL_CLEAR_BASE = 40;
const SPEED_BONUS_PER_SECOND = 3;
const MISMATCH_MS = 650; // wobble, then flip back
const GLOW_MS = 520; // glow + sparkle before the pair flies off
const FLY_MS = 480; // shrink-fly to the collected pile
const PING_MS = 900;

/*
 * Anchor math (src/lib/scoring.ts: 900 ≈ strong run):
 *   pairs: 6+8+10+15 = 39 × 14        = 546
 *   level clears: 4 × 40              = 160
 *   speed bonuses (strong clears ~20/30/40/62 s
 *     vs targets 30/42/55/80 s → 55 s under × 3)  ≈ 165
 *   early finish (~25 s left × 1)     ≈  25
 *   total                              ≈ 896 ≈ 900
 */

type Level = {
  id: 1 | 2 | 3 | 4;
  name: string;
  cols: number;
  rows: number;
  targetSeconds: number;
};

const LEVELS: Level[] = [
  { id: 1, name: "Warm up", cols: 3, rows: 4, targetSeconds: 30 },
  { id: 2, name: "Bigger table", cols: 4, rows: 4, targetSeconds: 42 },
  { id: 3, name: "More pairs", cols: 4, rows: 5, targetSeconds: 55 },
  { id: 4, name: "Full table", cols: 5, rows: 6, targetSeconds: 80 },
];

/** Grid column class + a max width per level so cards stay ≥ 44 px at 320 px
 *  wide yet the whole table still fits above the fold. */
const GRID_LAYOUT = [
  { cols: "grid-cols-3", maxW: "max-w-[16rem]" },
  { cols: "grid-cols-4", maxW: "max-w-[21rem]" },
  { cols: "grid-cols-4", maxW: "max-w-[18rem]" },
  { cols: "grid-cols-5", maxW: "max-w-[19rem]" },
];

/* ------------------------------------------------------------------ */
/* The hand-drawn face set                                             */
/* ------------------------------------------------------------------ */

type IconId =
  | "apple"
  | "pear"
  | "cherry"
  | "leaf"
  | "mushroom"
  | "flower"
  | "sun"
  | "cloud"
  | "star"
  | "moon"
  | "fish"
  | "bird"
  | "boat"
  | "cup"
  | "key";

const ICON_IDS: IconId[] = [
  "apple",
  "pear",
  "cherry",
  "leaf",
  "mushroom",
  "flower",
  "sun",
  "cloud",
  "star",
  "moon",
  "fish",
  "bird",
  "boat",
  "cup",
  "key",
];

/** One friendly style across all 15 faces: two-tone fills + darker outline,
 *  round joins, drawn in a 40×40 box. */
const ICON_ART: Record<IconId, ReactNode> = {
  apple: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 9 Q20.5 5 24 3.5" fill="none" stroke="#92400e" strokeWidth="2" />
      <path
        d="M21 8 Q26 2.5 30.5 6.5 Q26.5 11 21 8 Z"
        fill="#4ade80"
        stroke="#166534"
        strokeWidth="1.5"
      />
      <path
        d="M20 11 C 14 6.5 5.5 10 6.5 19 C 7.3 27 13 34.5 20 33.5 C 27 34.5 32.7 27 33.5 19 C 34.5 10 26 6.5 20 11 Z"
        fill="#ef4444"
        stroke="#b91c1c"
        strokeWidth="2"
      />
      <path d="M12 15.5 Q10.5 19.5 12.5 24" fill="none" stroke="#fca5a5" strokeWidth="2.4" />
    </g>
  ),
  pear: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10.5 Q19.5 6 23 4" fill="none" stroke="#78350f" strokeWidth="2" />
      <path
        d="M20 10.5 C 22.5 10.5 23.5 14 24.5 18 C 25.5 20.5 29.5 23 29.5 27.5 C 29.5 33 25 35.5 20 35.5 C 15 35.5 10.5 33 10.5 27.5 C 10.5 23 14.5 20.5 15.5 18 C 16.5 14 17.5 10.5 20 10.5 Z"
        fill="#a3e635"
        stroke="#4d7c0f"
        strokeWidth="2"
      />
      <path d="M14.5 26 Q14.5 30 17 31.5" fill="none" stroke="#d9f99d" strokeWidth="2.2" />
    </g>
  ),
  cherry: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 22.5 Q15 11 21.5 5.5" fill="none" stroke="#15803d" strokeWidth="2" />
      <path d="M26.5 21 Q24.5 12 21.5 5.5" fill="none" stroke="#15803d" strokeWidth="2" />
      <path
        d="M21.5 5.5 Q27.5 3 29.5 8 Q24.5 10.5 21.5 5.5 Z"
        fill="#4ade80"
        stroke="#166534"
        strokeWidth="1.5"
      />
      <circle cx="12.5" cy="28.5" r="6.3" fill="#f43f5e" stroke="#be123c" strokeWidth="2" />
      <circle cx="27.5" cy="27" r="5.7" fill="#f43f5e" stroke="#be123c" strokeWidth="2" />
      <circle cx="10.5" cy="26.5" r="1.7" fill="#fda4af" />
      <circle cx="25.7" cy="25.2" r="1.4" fill="#fda4af" />
    </g>
  ),
  leaf: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M9 31.5 C 7.5 17 17 6.5 32 8 C 33.8 22.5 24 32.8 9 31.5 Z"
        fill="#4ade80"
        stroke="#15803d"
        strokeWidth="2"
      />
      <path
        d="M9 31.5 C 8.2 22 12 13 20 9.5 C 14 15 11 22 10.8 30.8 Z"
        fill="#bbf7d0"
        opacity="0.7"
      />
      <path d="M11.5 29 Q20 21 28.5 11.5" fill="none" stroke="#15803d" strokeWidth="1.6" />
      <path d="M16 24.5 L13.5 19" fill="none" stroke="#15803d" strokeWidth="1.2" opacity="0.6" />
      <path d="M22 18.5 L20 13.5" fill="none" stroke="#15803d" strokeWidth="1.2" opacity="0.6" />
    </g>
  ),
  mushroom: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M15.5 21.5 Q15 29.5 13.5 33 Q20 36 26.5 33 Q25 29.5 24.5 21.5 Q20 22.5 15.5 21.5 Z"
        fill="#fef3c7"
        stroke="#d97706"
        strokeWidth="2"
      />
      <path
        d="M6.5 20.5 C 6.5 10 14 4.5 20 4.5 C 26 4.5 33.5 10 33.5 20.5 Q 20 24.5 6.5 20.5 Z"
        fill="#ef4444"
        stroke="#b91c1c"
        strokeWidth="2"
      />
      <circle cx="14" cy="12" r="2.3" fill="#ffe4e6" />
      <circle cx="24.5" cy="9.5" r="1.8" fill="#ffe4e6" />
      <circle cx="28" cy="15.5" r="2" fill="#ffe4e6" />
      <circle cx="17" cy="17.5" r="1.5" fill="#ffe4e6" />
    </g>
  ),
  flower: (
    <g strokeLinecap="round" strokeLinejoin="round">
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse
          key={a}
          cx="20"
          cy="13"
          rx="4.6"
          ry="7"
          fill="#f9a8d4"
          stroke="#be185d"
          strokeWidth="1.5"
          transform={`rotate(${a} 20 21.5)`}
        />
      ))}
      <circle cx="20" cy="21.5" r="4.8" fill="#fbbf24" stroke="#b45309" strokeWidth="2" />
    </g>
  ),
  sun: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <g stroke="#f59e0b" strokeWidth="2.4">
        <path d="M33.5 20 L37 20" />
        <path d="M29.55 29.55 L32.02 32.02" />
        <path d="M20 33.5 L20 37" />
        <path d="M10.45 29.55 L7.98 32.02" />
        <path d="M6.5 20 L3 20" />
        <path d="M10.45 10.45 L7.98 7.98" />
        <path d="M20 6.5 L20 3" />
        <path d="M29.55 10.45 L32.02 7.98" />
      </g>
      <circle cx="20" cy="20" r="10" fill="#fbbf24" stroke="#d97706" strokeWidth="2" />
      <circle cx="16.5" cy="16.5" r="4" fill="#fde68a" opacity="0.9" />
    </g>
  ),
  cloud: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M10.5 28.5 Q4.5 28 5 22.8 Q5.4 18.6 10 18.2 Q10.8 11.5 17.6 11 Q23.8 10.6 25.8 15.6 Q32.4 15.2 33.6 20.2 Q34.8 25.8 28.8 27 Q27.6 28.5 25.6 28.5 Z"
        fill="#eff8ff"
        stroke="#0284c7"
        strokeWidth="2"
      />
      <path d="M9.5 25.8 Q19 29 29.5 24.8" fill="none" stroke="#bae6fd" strokeWidth="2.4" />
    </g>
  ),
  star: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M20 7 L23.5 16.2 L33.3 16.7 L25.7 22.9 L28.2 32.3 L20 27 L11.8 32.3 L14.3 22.9 L6.7 16.7 L16.5 16.2 Z"
        fill="#fbbf24"
        stroke="#b45309"
        strokeWidth="2"
      />
      <circle cx="18" cy="17.5" r="2.4" fill="#fde68a" />
    </g>
  ),
  moon: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M23.5 4.5 C 13.5 6 7 13 7 20 C 7 27 13.5 34 23.5 35.5 C 17 31 13.5 26 13.5 20 C 13.5 14 17 9 23.5 4.5 Z"
        fill="#fde68a"
        stroke="#ca8a04"
        strokeWidth="2"
      />
      <circle cx="28" cy="13" r="1.6" fill="#fcd34d" />
      <circle cx="31.5" cy="21" r="1.1" fill="#fcd34d" />
      <circle cx="27.5" cy="27.5" r="1.3" fill="#fcd34d" />
    </g>
  ),
  fish: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M31 20 L37.5 13.5 Q35.8 20 37.5 26.5 Z"
        fill="#38bdf8"
        stroke="#0369a1"
        strokeWidth="2"
      />
      <path
        d="M5.5 20 Q12 9.5 20.5 9.5 Q28.5 9.5 31.5 20 Q28.5 30.5 20.5 30.5 Q12 30.5 5.5 20 Z"
        fill="#38bdf8"
        stroke="#0369a1"
        strokeWidth="2"
      />
      <path d="M8 23.5 Q15 28.5 24 27.5" fill="none" stroke="#bae6fd" strokeWidth="2.4" />
      <path d="M17 13 Q15.5 20 17 27" fill="none" stroke="#0369a1" strokeWidth="1.3" opacity="0.5" />
      <circle cx="12.5" cy="17.5" r="1.9" fill="#0c4a6e" />
      <circle cx="12" cy="17" r="0.6" fill="#ffffff" />
    </g>
  ),
  bird: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21 L2.5 17 L4.5 24.5 Z" fill="#fb923c" stroke="#c2410c" strokeWidth="1.5" />
      <path d="M16 29.5 L16 34" fill="none" stroke="#c2410c" strokeWidth="1.6" />
      <path d="M21 29.5 L21 34" fill="none" stroke="#c2410c" strokeWidth="1.6" />
      <path
        d="M8.5 21.5 Q8.5 11 19 11 Q29.5 11 29.5 19.5 Q29.5 29.5 18 29.5 Q9.5 29.5 8.5 21.5 Z"
        fill="#fdba74"
        stroke="#c2410c"
        strokeWidth="2"
      />
      <path
        d="M14.5 19 Q21 14.5 25.5 19.5 Q20.5 24.5 14.5 19 Z"
        fill="#fb923c"
        stroke="#c2410c"
        strokeWidth="1.5"
      />
      <path d="M29.5 17.5 L35.5 20 L29.5 22.5 Z" fill="#facc15" stroke="#ca8a04" strokeWidth="1.5" />
      <circle cx="25" cy="15.5" r="1.6" fill="#7c2d12" />
    </g>
  ),
  boat: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 25.5 L20 5.5" fill="none" stroke="#78350f" strokeWidth="2" />
      <path
        d="M21.5 7 Q30.5 13 22.5 22.5 L21.5 22.5 Z"
        fill="#f8fafc"
        stroke="#64748b"
        strokeWidth="1.5"
      />
      <path d="M18.5 10 L18.5 22.5 L10.5 22.5 Z" fill="#e2e8f0" stroke="#64748b" strokeWidth="1.5" />
      <path
        d="M7 25.5 L33 25.5 L28.5 33.5 L11.5 33.5 Z"
        fill="#f87171"
        stroke="#b91c1c"
        strokeWidth="2"
      />
      <path
        d="M4 36.5 Q8 34.5 12 36.5 T20 36.5 T28 36.5 T36 36.5"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.8"
      />
    </g>
  ),
  cup: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 9.5 Q16.2 6.5 15 3.5" fill="none" stroke="#9ca3af" strokeWidth="1.8" />
      <path d="M23 9.5 Q24.2 6.5 23 3.5" fill="none" stroke="#9ca3af" strokeWidth="1.8" />
      <path
        d="M29.2 16.5 Q36.5 17 35 23 Q33.8 27.5 28.4 26.5"
        fill="none"
        stroke="#0f766e"
        strokeWidth="2.2"
      />
      <path
        d="M8.5 13 L10.5 32.5 Q19 35.8 27.5 32.5 L29.5 13 Z"
        fill="#2dd4bf"
        stroke="#0f766e"
        strokeWidth="2"
      />
      <ellipse cx="19" cy="13" rx="10.5" ry="3.2" fill="#99f6e4" stroke="#0f766e" strokeWidth="2" />
    </g>
  ),
  key: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.8 18.8 L33.5 33.5" stroke="#b45309" strokeWidth="5" />
      <path d="M28 29.5 L31.5 26" stroke="#b45309" strokeWidth="4" />
      <path d="M31.5 33 L35 29.5" stroke="#b45309" strokeWidth="4" />
      <path d="M18.8 18.8 L33.5 33.5" stroke="#fbbf24" strokeWidth="2.6" />
      <path d="M28 29.5 L31.5 26" stroke="#fbbf24" strokeWidth="1.8" />
      <path d="M31.5 33 L35 29.5" stroke="#fbbf24" strokeWidth="1.8" />
      <circle cx="13.5" cy="13.5" r="7.2" fill="#fbbf24" stroke="#b45309" strokeWidth="2" />
      <circle cx="13.5" cy="13.5" r="2.8" fill="#fffaf0" stroke="#b45309" strokeWidth="1.6" />
    </g>
  ),
};

function IconGlyph({ icon, className }: { icon: IconId; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className ?? "h-[74%] w-[74%]"} aria-hidden>
      {ICON_ART[icon]}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

type CardState = "down" | "up" | "glow" | "miss" | "gone";

type Card = {
  id: number;
  icon: IconId;
  state: CardState;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck(cols: number, rows: number): Card[] {
  const pairCount = (cols * rows) / 2;
  const pairs = shuffle(ICON_IDS).slice(0, pairCount);
  const doubled = shuffle([...pairs, ...pairs]);
  return doubled.map((icon, i) => ({ id: i, icon, state: "down" as CardState }));
}

const LATTICE = [-40, -30, -20, -10, 0, 10, 20, 30, 40];

/** Patterned card back — teal diamond lattice, no "?". */
function CardBack() {
  return (
    <svg viewBox="0 0 40 40" className="h-full w-full" preserveAspectRatio="none" aria-hidden>
      <rect width="40" height="40" fill="#0f766e" />
      <g stroke="#5eead4" strokeWidth="0.9" opacity="0.4">
        {LATTICE.map((k) => (
          <path key={`a${k}`} d={`M ${k} 0 L ${k + 40} 40`} />
        ))}
        {LATTICE.map((k) => (
          <path key={`b${k}`} d={`M ${k} 40 L ${k + 40} 0`} />
        ))}
      </g>
      <rect
        x="13.5"
        y="13.5"
        width="13"
        height="13"
        rx="1.5"
        transform="rotate(45 20 20)"
        fill="#14b8a6"
        stroke="#99f6e4"
        strokeWidth="1"
      />
      <circle cx="20" cy="20" r="2.2" fill="#ccfbf1" />
      <rect
        x="2.2"
        y="2.2"
        width="35.6"
        height="35.6"
        rx="4"
        fill="none"
        stroke="#99f6e4"
        strokeWidth="1.1"
        opacity="0.85"
      />
    </svg>
  );
}

const SPARKS = [
  { dx: -26, dy: -20, delay: 0 },
  { dx: 24, dy: -26, delay: 0.04 },
  { dx: 30, dy: 8, delay: 0.08 },
  { dx: -30, dy: 10, delay: 0.02 },
  { dx: -6, dy: -32, delay: 0.06 },
  { dx: 8, dy: 30, delay: 0.1 },
];

/** Little four-point stars that burst from a matched pair. */
function Sparkles() {
  return (
    <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
      {SPARKS.map((s, i) => (
        <motion.span
          key={i}
          className="absolute"
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{ x: s.dx, y: s.dy, scale: [0, 1, 0.4], opacity: [1, 1, 0] }}
          transition={{ duration: 0.55, delay: s.delay, ease: "easeOut" }}
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
            <path d="M5 0 L6.2 3.8 L10 5 L6.2 6.2 L5 10 L3.8 6.2 L0 5 L3.8 3.8 Z" fill="#fbbf24" />
          </svg>
        </motion.span>
      ))}
    </span>
  );
}

const FLIP_T = { duration: 0.25, ease: "easeInOut" as const };

/** The two faces of a card with a true 3D flip (rotateY + hidden backfaces). */
function CardFaces({ icon, state }: { icon: IconId; state: CardState }) {
  const faceUp = state === "up" || state === "glow" || state === "miss";
  const faceClass =
    state === "glow"
      ? "ring-2 ring-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.75)]"
      : state === "miss"
      ? "bg-rose-50 ring-2 ring-rose-400"
      : "ring-1 ring-[#e4cfa4] shadow-sm";
  return (
    <span className="absolute inset-0 block" style={{ perspective: "600px" }} aria-hidden>
      <motion.span
        initial={false}
        animate={{ rotateY: faceUp ? 180 : 0 }}
        transition={FLIP_T}
        className="absolute inset-0 block overflow-hidden rounded-lg ring-1 ring-teal-950/50 shadow-sm"
        style={{ backfaceVisibility: "hidden" }}
      >
        <CardBack />
        <span className="absolute inset-0 block bg-gradient-to-br from-white/25 via-transparent to-black/15" />
      </motion.span>
      <motion.span
        initial={false}
        animate={{
          rotateY: faceUp ? 0 : -180,
          scale: state === "glow" ? [1, 1.1, 1] : 1,
        }}
        transition={FLIP_T}
        className={"absolute inset-0 grid place-items-center rounded-lg bg-[#fffaf0] " + faceClass}
        style={{ backfaceVisibility: "hidden" }}
      >
        <IconGlyph icon={icon} />
        {state === "glow" && <Sparkles />}
      </motion.span>
    </span>
  );
}

const MISS_WOBBLE = { rotate: [0, -5, 5, -4, 4, 0] };
const NO_WOBBLE = { rotate: 0 };

function CardCell({
  card,
  dealDelay,
  onFlip,
  registerEl,
}: {
  card: Card;
  dealDelay: number;
  onFlip: () => void;
  registerEl: (el: HTMLButtonElement | null) => void;
}) {
  const gone = card.state === "gone";
  const faceUp = card.state !== "down";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.4, y: -12 }}
      animate={gone ? { opacity: 0, scale: 0.5, y: 6 } : { opacity: 1, scale: 1, y: 0 }}
      transition={
        gone
          ? { duration: 0.18 }
          : { type: "spring", stiffness: 340, damping: 24, delay: dealDelay }
      }
      className="relative aspect-square w-full"
    >
      <motion.button
        ref={registerEl}
        type="button"
        role="gridcell"
        data-testid="card"
        data-icon={card.icon}
        data-state={card.state}
        aria-label={faceUp ? `Card showing ${card.icon}` : "Face-down card"}
        aria-pressed={faceUp}
        tabIndex={gone ? -1 : 0}
        onClick={onFlip}
        animate={card.state === "miss" ? MISS_WOBBLE : NO_WOBBLE}
        transition={{ duration: 0.4 }}
        whileTap={{ scale: 0.95 }}
        className={
          "absolute inset-0 rounded-lg " + (gone ? "pointer-events-none" : "cursor-pointer")
        }
      >
        <CardFaces icon={card.icon} state={card.state} />
      </motion.button>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* The picnic table scene                                              */
/* ------------------------------------------------------------------ */

const PLANK_FILLS = ["#a2592b", "#965122", "#ab6333", "#9b5626", "#a65e2d", "#925023"];
const KNOTS = [
  { x: 22, y: 9, rx: 3, ry: 1.7 },
  { x: 71, y: 42, rx: 2.6, ry: 1.5 },
  { x: 40, y: 76, rx: 3.2, ry: 1.8 },
];

/** Warm wooden tabletop: planks, grain, knots, seams and a soft vignette. */
function WoodTable({ idPrefix }: { idPrefix: string }) {
  const plankH = 100 / PLANK_FILLS.length;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <radialGradient id={`${idPrefix}Vig`} cx="0.5" cy="0.4" r="0.85">
          <stop offset="55%" stopColor="#2c1704" stopOpacity="0" />
          <stop offset="100%" stopColor="#2c1704" stopOpacity="0.5" />
        </radialGradient>
        <linearGradient id={`${idPrefix}Sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd9a0" stopOpacity="0.22" />
          <stop offset="45%" stopColor="#ffd9a0" stopOpacity="0" />
        </linearGradient>
      </defs>

      {PLANK_FILLS.map((fill, i) => {
        const y = i * plankH;
        const jointX = (i * 41 + 17) % 100;
        const g1 = y + 4 + ((i * 3) % 7);
        const g2 = y + plankH - 4 - ((i * 5) % 6);
        return (
          <g key={i}>
            <rect x="0" y={y} width="100" height={plankH + 0.2} fill={fill} />
            {/* wood grain */}
            <path
              d={`M 0 ${g1} Q 25 ${g1 - 1.4} 50 ${g1} T 100 ${g1 - 0.8}`}
              fill="none"
              stroke="#5f3413"
              strokeWidth="0.45"
              opacity="0.3"
            />
            <path
              d={`M 0 ${g2} Q 30 ${g2 + 1.2} 60 ${g2 - 0.6} T 100 ${g2 + 0.6}`}
              fill="none"
              stroke="#5f3413"
              strokeWidth="0.4"
              opacity="0.22"
            />
            {/* butt joint + nails */}
            <path
              d={`M ${jointX} ${y + 0.6} L ${jointX} ${y + plankH - 0.6}`}
              stroke="#5f3413"
              strokeWidth="0.6"
              opacity="0.7"
            />
            <circle cx={jointX + 2.4} cy={y + 2.6} r="0.65" fill="#57300f" opacity="0.8" />
            <circle cx={jointX - 2.4} cy={y + plankH - 2.6} r="0.65" fill="#57300f" opacity="0.8" />
            {/* seam between planks */}
            {i > 0 && (
              <path d={`M 0 ${y} L 100 ${y}`} stroke="#5a2f10" strokeWidth="0.7" opacity="0.85" />
            )}
          </g>
        );
      })}

      {KNOTS.map((k, i) => (
        <g key={i} opacity="0.6">
          <ellipse cx={k.x} cy={k.y} rx={k.rx} ry={k.ry} fill="#7c4318" />
          <ellipse
            cx={k.x}
            cy={k.y}
            rx={k.rx * 0.55}
            ry={k.ry * 0.55}
            fill="none"
            stroke="#57300f"
            strokeWidth="0.4"
          />
          <ellipse
            cx={k.x}
            cy={k.y}
            rx={k.rx + 1.1}
            ry={k.ry + 0.7}
            fill="none"
            stroke="#57300f"
            strokeWidth="0.35"
            opacity="0.7"
          />
        </g>
      ))}

      <rect width="100" height="100" fill={`url(#${idPrefix}Sun)`} />
      <rect width="100" height="100" fill={`url(#${idPrefix}Vig)`} />
    </svg>
  );
}

/** A butterfly slowly drifting across the top of the table. Decorative. */
function Butterfly() {
  return (
    <motion.div
      className="pointer-events-none absolute z-0"
      style={{ left: "6%", top: "3%" }}
      animate={{ x: [0, 70, 130, 60, 0], y: [0, 16, 6, 20, 0] }}
      transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden
    >
      <svg viewBox="0 0 24 20" className="h-5 w-6 opacity-90">
        <motion.g
          animate={{ scaleX: [1, 0.55, 1] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "12px 10px" }}
        >
          <ellipse cx="7" cy="7" rx="5.5" ry="4.5" fill="#f9a8d4" stroke="#be185d" strokeWidth="1" />
          <ellipse cx="17" cy="7" rx="5.5" ry="4.5" fill="#f9a8d4" stroke="#be185d" strokeWidth="1" />
          <ellipse cx="8.4" cy="13.5" rx="4" ry="3.4" fill="#fbcfe8" stroke="#be185d" strokeWidth="1" />
          <ellipse cx="15.6" cy="13.5" rx="4" ry="3.4" fill="#fbcfe8" stroke="#be185d" strokeWidth="1" />
        </motion.g>
        <rect x="11" y="4" width="2" height="13" rx="1" fill="#57300f" />
      </svg>
    </motion.div>
  );
}

/** A daisy peeking in from the table edge, swaying gently. Decorative. */
function Daisy({ className }: { className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 40 40"
      className={className}
      animate={{ rotate: [-4, 4, -4] }}
      transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden
    >
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <ellipse
          key={a}
          cx="20"
          cy="12"
          rx="4"
          ry="8"
          fill="#fff7ed"
          opacity="0.95"
          transform={`rotate(${a} 20 20)`}
        />
      ))}
      <circle cx="20" cy="20" r="4.5" fill="#fbbf24" />
    </motion.svg>
  );
}

const PILE_SLOTS = [
  { x: -6, y: 0, r: -10 },
  { x: 5, y: -1, r: 8 },
  { x: -2, y: -3, r: -3 },
  { x: 3, y: -5, r: 12 },
  { x: -5, y: -6, r: -14 },
  { x: 1, y: -8, r: 4 },
];

/** The collected pile in the corner — a stack of mini card backs that grows. */
function CollectedPile({ count }: { count: number }) {
  const shown = Math.min(count, PILE_SLOTS.length);
  return (
    <div className="relative flex h-11 w-14 items-end justify-center" aria-hidden>
      <div className="absolute inset-x-1 bottom-0 top-1 rounded-lg border-2 border-dashed border-amber-100/40" />
      {PILE_SLOTS.slice(0, shown).map((s, i) => (
        <span
          key={i}
          className="absolute bottom-1"
          style={{ transform: `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg)` }}
        >
          <motion.span
            initial={i === shown - 1 ? { scale: 1.7, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
            className="block h-7 w-5 overflow-hidden rounded-[4px] ring-1 ring-teal-950/60 shadow"
          >
            <CardBack />
          </motion.span>
        </span>
      ))}
      {count > 0 && (
        <motion.span
          key={count}
          initial={{ scale: 1.5 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 20 }}
          className="absolute -right-1.5 -top-1.5 z-10 rounded-full bg-amber-400 px-1.5 text-[10px] font-black leading-4 text-amber-950 ring-1 ring-amber-600"
        >
          ×{count}
        </motion.span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback bits (pings + fly-to-pile)                                 */
/* ------------------------------------------------------------------ */

type Ping = { id: number; x: number; y: number; text: string };

type Flyer = {
  id: number;
  icon: IconId;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  w: number;
};

function PingPop({ ping }: { ping: Ping }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-30 -translate-x-1/2"
      style={{ left: ping.x, top: ping.y }}
      initial={{ y: 0, opacity: 0, scale: 0.6 }}
      animate={{ y: -34, opacity: [0, 1, 1, 0], scale: [0.6, 1.15, 1, 1] }}
      transition={{ duration: PING_MS / 1000, ease: "easeOut" }}
      aria-hidden
    >
      <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-black text-white shadow ring-1 ring-emerald-700">
        {ping.text}
      </span>
    </motion.div>
  );
}

function FlyerCard({ flyer }: { flyer: Flyer }) {
  const half = flyer.w / 2;
  return (
    <motion.div
      className="pointer-events-none absolute left-0 top-0 z-20"
      style={{ width: flyer.w, height: flyer.w }}
      initial={{ x: flyer.fromX - half, y: flyer.fromY - half, scale: 1, opacity: 1, rotate: 0 }}
      animate={{
        x: flyer.toX - half,
        y: flyer.toY - half,
        scale: 0.22,
        opacity: 0.95,
        rotate: 14,
      }}
      transition={{ duration: FLY_MS / 1000, ease: [0.45, 0.05, 0.7, 0.5] }}
      aria-hidden
    >
      <span className="grid h-full w-full place-items-center rounded-lg bg-[#fffaf0] ring-1 ring-amber-300 shadow-lg">
        <IconGlyph icon={flyer.icon} />
      </span>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function MemoryMatch() {
  const game = getGame("memory");
  const recordPlay = useStore((s) => s.recordPlay);
  const tutorialSeen = useStore((s) => s.tutorialsSeen[game.id]);
  const markTutorialSeen = useStore((s) => s.markTutorialSeen);

  const [phase, setPhase] = useState<Phase>("intro");
  const [levelIdx, setLevelIdx] = useState(0);
  const [deck, setDeck] = useState<Card[]>([]);
  const [moves, setMoves] = useState(0);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [pileCount, setPileCount] = useState(0);
  const [pings, setPings] = useState<Ping[]>([]);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [lastCleared, setLastCleared] = useState(0);
  const [lastLevelScore, setLastLevelScore] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [isBest, setIsBest] = useState(false);

  const deckRef = useRef<Card[]>([]);
  const scoreRef = useRef(0);
  const clearedRef = useRef(0);
  const levelPointsRef = useRef(0);
  const matchedPairsRef = useRef(0);
  const totalMatchesRef = useRef(0);
  const levelIdxRef = useRef(0);
  const deadlineRef = useRef(0);
  const sessionTickRef = useRef<number | null>(null);
  const levelStartedAtRef = useRef(0);
  const busyRef = useRef(false);
  const endedRef = useRef(false);
  const timeoutsRef = useRef<Set<number>>(new Set());
  const pingIdRef = useRef(0);
  const flyerIdRef = useRef(0);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const pileRef = useRef<HTMLDivElement | null>(null);
  const cardElsRef = useRef<Map<number, HTMLButtonElement>>(new Map());

  const currentLevel = LEVELS[levelIdx];
  const totalPairs = (currentLevel.cols * currentLevel.rows) / 2;

  const updateDeck = (next: Card[]) => {
    deckRef.current = next;
    setDeck(next);
  };

  /** setTimeout that is tracked and cleared on unmount / level change / end. */
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timeoutsRef.current.delete(id);
      fn();
    }, ms);
    timeoutsRef.current.add(id);
    return id;
  };

  const clearTimers = () => {
    timeoutsRef.current.forEach((id) => window.clearTimeout(id));
    timeoutsRef.current.clear();
  };

  const stopTick = () => {
    if (sessionTickRef.current !== null) {
      window.clearInterval(sessionTickRef.current);
      sessionTickRef.current = null;
    }
  };

  useEffect(
    () => () => {
      stopTick();
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current.clear();
    },
    []
  );

  const end = useCallback(
    (clearedAll: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopTick();
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current.clear();
      let final = scoreRef.current;
      if (clearedAll) {
        const remaining = Math.max(0, Math.floor((deadlineRef.current - Date.now()) / 1000));
        final += remaining;
      }
      scoreRef.current = final;
      setScore(final);
      const { isBest: best } = recordPlay("memory", final);
      setFinalScore(final);
      setIsBest(best);
      setPhase("done");
    },
    [recordPlay]
  );

  const startLevel = useCallback((idx: number) => {
    clearTimers();
    const lvl = LEVELS[idx];
    levelIdxRef.current = idx;
    setLevelIdx(idx);
    updateDeck(makeDeck(lvl.cols, lvl.rows));
    setMoves(0);
    setPings([]);
    setFlyers([]);
    setPileCount(0);
    matchedPairsRef.current = 0;
    setMatchedPairs(0);
    levelPointsRef.current = 0;
    busyRef.current = false;
    levelStartedAtRef.current = Date.now();
    setPhase("playing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const begin = () => {
    setScore(0);
    scoreRef.current = 0;
    clearedRef.current = 0;
    levelPointsRef.current = 0;
    totalMatchesRef.current = 0;
    matchedPairsRef.current = 0;
    setMatchedPairs(0);
    setPileCount(0);
    setLevelIdx(0);
    levelIdxRef.current = 0;
    setTimeLeft(SESSION_SECONDS);
    endedRef.current = false;
    setPhase(tutorialSeen ? "countdown" : "tutorial");
  };

  const afterTutorial = () => {
    markTutorialSeen(game.id);
    setPhase("countdown");
  };

  const startSession = () => {
    deadlineRef.current = Date.now() + SESSION_SECONDS * 1000;
    setTimeLeft(SESSION_SECONDS);
    stopTick();
    sessionTickRef.current = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) end(false);
    }, 200);
    startLevel(0);
  };

  const addPing = (x: number, y: number, text: string) => {
    const id = ++pingIdRef.current;
    setPings((p) => [...p, { id, x, y, text }]);
    later(() => setPings((p) => p.filter((q) => q.id !== id)), PING_MS + 50);
  };

  /** Centre of an element relative to the scene container. */
  const centreInScene = (el: HTMLElement) => {
    const scene = sceneRef.current;
    if (!scene) return null;
    const s = scene.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, w: r.width };
  };

  const spawnFlyers = (aId: number, bId: number, icon: IconId) => {
    const pile = pileRef.current;
    if (!pile) return;
    const to = centreInScene(pile);
    if (!to) return;
    const made: Flyer[] = [];
    for (const id of [aId, bId]) {
      const el = cardElsRef.current.get(id);
      if (!el) continue;
      const from = centreInScene(el);
      if (!from) continue;
      made.push({
        id: ++flyerIdRef.current,
        icon,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y + 2,
        w: from.w,
      });
    }
    if (made.length === 0) {
      setPileCount((c) => c + 1);
      return;
    }
    setFlyers((f) => [...f, ...made]);
    const ids = made.map((m) => m.id);
    later(() => {
      setFlyers((f) => f.filter((fl) => !ids.includes(fl.id)));
      setPileCount((c) => c + 1);
    }, FLY_MS + 40);
  };

  const advanceAfterClear = (lvl: Level) => {
    if (endedRef.current) return;
    const elapsed = (Date.now() - levelStartedAtRef.current) / 1000;
    const speedBonus = Math.max(
      0,
      Math.round((lvl.targetSeconds - elapsed) * SPEED_BONUS_PER_SECOND)
    );
    const clearPts = LEVEL_CLEAR_BASE + speedBonus;
    scoreRef.current += clearPts;
    levelPointsRef.current += clearPts;
    setScore(scoreRef.current);
    clearedRef.current += 1;
    setLastCleared(lvl.id);
    setLastLevelScore(levelPointsRef.current);
    const nextIdx = levelIdxRef.current + 1;
    setPhase("levelDone");
    if (nextIdx >= LEVELS.length) {
      later(() => end(true), 1100);
    } else {
      later(() => startLevel(nextIdx), 1100);
    }
  };

  const onFlip = (id: number) => {
    if (phase !== "playing" || endedRef.current) return;
    if (busyRef.current) return;
    const deckNow = deckRef.current;
    const card = deckNow.find((c) => c.id === id);
    if (!card || card.state !== "down") return;
    const ups = deckNow.filter((c) => c.state === "up");
    if (ups.length >= 2) return;

    haptic.tap();
    let next = deckNow.map((c) => (c.id === id ? { ...c, state: "up" as CardState } : c));
    const upNow = next.filter((c) => c.state === "up");

    if (upNow.length === 2) {
      const [a, b] = upNow;
      setMoves((m) => m + 1);
      if (a.icon === b.icon) {
        // ---- match: glow + sparkle, then shrink-fly to the pile ----
        haptic.success();
        scoreRef.current += POINTS_PER_MATCH;
        levelPointsRef.current += POINTS_PER_MATCH;
        totalMatchesRef.current += 1;
        setScore(scoreRef.current);
        matchedPairsRef.current += 1;
        setMatchedPairs(matchedPairsRef.current);
        next = next.map((c) =>
          c.id === a.id || c.id === b.id ? { ...c, state: "glow" as CardState } : c
        );

        const elA = cardElsRef.current.get(a.id);
        const elB = cardElsRef.current.get(b.id);
        if (elA && elB) {
          const pa = centreInScene(elA);
          const pb = centreInScene(elB);
          if (pa && pb) {
            addPing((pa.x + pb.x) / 2, Math.min(pa.y, pb.y) - pa.w / 2, `+${POINTS_PER_MATCH}`);
          }
        }

        const aId = a.id;
        const bId = b.id;
        const icon = a.icon;
        later(() => {
          spawnFlyers(aId, bId, icon);
          updateDeck(
            deckRef.current.map((c) =>
              c.id === aId || c.id === bId ? { ...c, state: "gone" as CardState } : c
            )
          );
        }, GLOW_MS);

        const lvl = LEVELS[levelIdxRef.current];
        if (matchedPairsRef.current === (lvl.cols * lvl.rows) / 2) {
          later(() => advanceAfterClear(lvl), GLOW_MS + FLY_MS + 140);
        }
      } else {
        // ---- mismatch: wobble once, flip back after ~650 ms ----
        haptic.error();
        busyRef.current = true;
        next = next.map((c) =>
          c.id === a.id || c.id === b.id ? { ...c, state: "miss" as CardState } : c
        );
        const aId = a.id;
        const bId = b.id;
        later(() => {
          updateDeck(
            deckRef.current.map((c) =>
              c.id === aId || c.id === bId ? { ...c, state: "down" as CardState } : c
            )
          );
          busyRef.current = false;
        }, MISMATCH_MS);
      }
    }
    updateDeck(next);
  };

  const tutorialSteps: TutorialStep[] = [
    {
      caption: "Tap a card to flip it over.",
      stage: <FlipDemo />,
      auto: 3400,
    },
    {
      caption: "Find two cards with the same picture — pairs sparkle and fly to your pile.",
      stage: <MatchDemo />,
      auto: 4600,
    },
    {
      caption: "No match? The cards wobble and flip back. Nothing lost — try again.",
      stage: <MissDemo />,
      auto: 3600,
    },
    {
      caption: "The table grows each level: 12 cards up to 30. Clear it before time runs out.",
      stage: <GrowDemo />,
    },
  ];

  const layout = GRID_LAYOUT[levelIdx];

  return (
    <GameShell game={game} compact={phase === "playing" || phase === "levelDone"}>
      {phase === "intro" && (
        <Instructions game={game} onStart={begin}>
          Four picnic tables in one 3-minute session — 12, 16, 20, then 30 cards
          laid out on the wood. Flip two at a time; matching pictures sparkle
          and fly to your collection pile. Clear each table to set the next one.
        </Instructions>
      )}

      {phase === "tutorial" && <Tutorial steps={tutorialSteps} onDone={afterTutorial} />}

      {phase === "countdown" && <Countdown onDone={startSession} />}

      {(phase === "playing" || phase === "levelDone") && (
        <div className="space-y-3">
          <GameHUD
            levelTotal={LEVELS.length}
            levelCurrent={levelIdx + 1}
            levelsCleared={clearedRef.current}
            score={score}
            timeLeft={timeLeft}
            sessionSeconds={SESSION_SECONDS}
          />

          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {currentLevel.name} · {moves} moves
            </span>
            <span data-testid="progress">
              pairs {matchedPairs} / {totalPairs}
            </span>
          </div>

          {phase === "levelDone" ? (
            <LevelComplete
              levelJustCleared={lastCleared}
              totalLevels={LEVELS.length}
              levelScore={lastLevelScore}
              nextLabel={LEVELS[lastCleared]?.name}
            />
          ) : (
            <div
              ref={sceneRef}
              className="relative mx-auto w-full max-w-xl overflow-hidden rounded-3xl ring-1 ring-amber-900/40 shadow-soft dark:ring-amber-950"
              style={{ background: "#8a4c22" }}
            >
              <WoodTable idPrefix="mm" />
              {/* deepen the wood in dark mode */}
              <div className="pointer-events-none absolute inset-0 hidden bg-slate-950/30 dark:block" />
              <Butterfly />
              <Daisy className="absolute -left-3 bottom-2 z-0 h-10 w-10" />

              <div className="relative z-10 p-3 sm:p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span className="mt-1 rounded-full bg-black/25 px-2.5 py-1 text-xs font-bold text-amber-50">
                    L{currentLevel.id} · {currentLevel.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-100/80">
                      collected
                    </span>
                    <div ref={pileRef}>
                      <CollectedPile count={pileCount} />
                    </div>
                  </div>
                </div>

                <div
                  role="grid"
                  aria-label="Memory cards on the picnic table"
                  data-testid="memory-grid"
                  data-cols={currentLevel.cols}
                  data-rows={currentLevel.rows}
                  className={`mx-auto grid w-full gap-1.5 sm:gap-2 ${layout.cols} ${layout.maxW}`}
                >
                  {deck.map((card, i) => (
                    <CardCell
                      key={`${levelIdx}-${card.id}`}
                      card={card}
                      dealDelay={i * 0.025}
                      onFlip={() => onFlip(card.id)}
                      registerEl={(el) => {
                        if (el) cardElsRef.current.set(card.id, el);
                        else cardElsRef.current.delete(card.id);
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* matched pairs flying to the pile */}
              {flyers.map((f) => (
                <FlyerCard key={f.id} flyer={f} />
              ))}

              {/* floating +N pings */}
              {pings.map((p) => (
                <PingPop key={p.id} ping={p} />
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={finalScore}
          isBest={isBest}
          onPlayAgain={begin}
          detail={`${clearedRef.current} / ${LEVELS.length} tables · ${totalMatchesRef.current} pairs`}
        />
      )}
    </GameShell>
  );
}

/* ------------------------------------------------------------------ */
/* Tutorial demos — built from the same table + card pieces            */
/* ------------------------------------------------------------------ */

/** Cycles through a list of phase durations, looping forever. */
function useLoopPhase(durations: number[]): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setP((v) => (v + 1) % durations.length), durations[p] ?? 1000);
    return () => window.clearTimeout(t);
  }, [p, durations]);
  return p;
}

function DemoTable({ children, idPrefix }: { children: ReactNode; idPrefix: string }) {
  return (
    <div className="grid min-h-[24vh] place-items-center">
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl ring-1 ring-amber-900/40 shadow-soft"
        style={{ background: "#8a4c22" }}
      >
        <WoodTable idPrefix={idPrefix} />
        <div className="pointer-events-none absolute inset-0 hidden bg-slate-950/30 dark:block" />
        <div className="relative z-10 p-5">{children}</div>
      </div>
    </div>
  );
}

function DemoCard({
  icon,
  state,
  hidden,
}: {
  icon: IconId;
  state: CardState;
  hidden?: boolean;
}) {
  return (
    <motion.div
      animate={
        hidden
          ? { opacity: 0, scale: 0.4, y: -8 }
          : { opacity: 1, scale: 1, y: 0, ...(state === "miss" ? MISS_WOBBLE : NO_WOBBLE) }
      }
      transition={{ duration: 0.35 }}
      className="relative aspect-square w-full"
      aria-hidden
    >
      <CardFaces icon={icon} state={state} />
    </motion.div>
  );
}

/** A ghost fingertip that hovers, presses, and fades. */
function GhostFinger({ pressed, faded }: { pressed: boolean; faded: boolean }) {
  return (
    <motion.span
      className="pointer-events-none absolute left-1/2 top-[62%] z-20 -ml-3.5 h-7 w-7 rounded-full bg-white/90 shadow-lg ring-2 ring-white"
      animate={{
        scale: pressed ? 0.7 : 1,
        opacity: faded ? 0 : 0.95,
        y: pressed ? 3 : 0,
      }}
      transition={{ duration: 0.22 }}
      aria-hidden
    />
  );
}

const FLIP_DEMO_PHASES = [1000, 500, 1400, 500];

/** Step 1: a finger taps the middle card; it flips up, then back down. */
function FlipDemo() {
  const p = useLoopPhase(FLIP_DEMO_PHASES);
  // 0 hover · 1 press · 2 card up · 3 back down
  return (
    <DemoTable idPrefix="mmFlip">
      <div className="mx-auto grid max-w-[15rem] grid-cols-3 gap-2.5">
        <DemoCard icon="apple" state="down" />
        <div className="relative">
          <DemoCard icon="sun" state={p === 2 ? "up" : "down"} />
          <GhostFinger pressed={p === 1} faded={p === 2} />
        </div>
        <DemoCard icon="fish" state="down" />
      </div>
    </DemoTable>
  );
}

const MATCH_DEMO_PHASES = [900, 700, 700, 950, 1350];

/** Step 2: two apples flip up, glow with sparkles, then vanish to the pile. */
function MatchDemo() {
  const p = useLoopPhase(MATCH_DEMO_PHASES);
  // 0 down · 1 c0 up · 2 c2 up · 3 glow · 4 gone + ping
  const s0: CardState = p === 1 || p === 2 ? "up" : p === 3 ? "glow" : "down";
  const s2: CardState = p === 2 ? "up" : p === 3 ? "glow" : "down";
  const gone = p === 4;
  return (
    <DemoTable idPrefix="mmMatch">
      <div className="relative">
        <div className="mx-auto grid max-w-[15rem] grid-cols-3 gap-2.5">
          <DemoCard icon="apple" state={s0} hidden={gone} />
          <DemoCard icon="moon" state="down" />
          <DemoCard icon="apple" state={s2} hidden={gone} />
        </div>
        {gone && (
          <motion.span
            className="absolute left-1/2 top-0 z-20 -translate-x-1/2"
            initial={{ y: 10, opacity: 0, scale: 0.6 }}
            animate={{ y: -18, opacity: [0, 1, 1, 0], scale: 1 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            aria-hidden
          >
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-black text-white shadow ring-1 ring-emerald-700">
              +{POINTS_PER_MATCH}
            </span>
          </motion.span>
        )}
        <div className="mt-3 flex items-center justify-end gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-100/80">
            collected
          </span>
          <CollectedPile count={gone ? 1 : 0} />
        </div>
      </div>
    </DemoTable>
  );
}

const MISS_DEMO_PHASES = [900, 700, 1100, 900];

/** Step 3: a cherry and a moon — wobble, then both flip back down. */
function MissDemo() {
  const p = useLoopPhase(MISS_DEMO_PHASES);
  // 0 down · 1 c0 up · 2 both up + wobble · 3 back down
  const s0: CardState = p === 1 ? "up" : p === 2 ? "miss" : "down";
  const s1: CardState = p === 2 ? "miss" : "down";
  return (
    <DemoTable idPrefix="mmMiss">
      <div className="mx-auto grid max-w-[10rem] grid-cols-2 gap-2.5">
        <DemoCard icon="cherry" state={s0} />
        <DemoCard icon="moon" state={s1} />
      </div>
    </DemoTable>
  );
}

const GROW_SIZES: Array<[number, number, string]> = [
  [3, 4, "Warm up"],
  [4, 4, "Bigger table"],
  [4, 5, "More pairs"],
  [5, 6, "Full table"],
];
const GROW_PHASES = [1300, 1300, 1300, 1300];

/** Step 4: the four table sizes, the active one highlighted on a loop. */
function GrowDemo() {
  const active = useLoopPhase(GROW_PHASES);
  return (
    <DemoTable idPrefix="mmGrow">
      <div className="flex flex-wrap items-end justify-center gap-3 sm:gap-4">
        {GROW_SIZES.map(([c, r, name], i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <motion.div
              animate={{ scale: i === active ? 1.14 : 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className={
                "grid gap-[2px] rounded-lg p-1.5 ring-1 " +
                (i === active
                  ? "bg-amber-100/90 ring-amber-300"
                  : "bg-black/20 ring-amber-100/20")
              }
              style={{ gridTemplateColumns: `repeat(${c}, 1fr)` }}
              aria-hidden
            >
              {Array.from({ length: c * r }).map((_, j) => (
                <span
                  key={j}
                  className={
                    "h-1.5 w-1.5 rounded-[2px] " +
                    (i === active ? "bg-teal-600" : "bg-amber-100/50")
                  }
                />
              ))}
            </motion.div>
            <span
              className={
                "text-[10px] font-bold " +
                (i === active ? "text-amber-100" : "text-amber-100/50")
              }
            >
              {name}
            </span>
          </div>
        ))}
      </div>
    </DemoTable>
  );
}

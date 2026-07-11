import { motion } from "framer-motion";
import type { GameId } from "@/lib/games";

type Props = {
  id: GameId;
  /** Turn on the gentle looping motion (hero / featured spots). Cards stay static. */
  animated?: boolean;
  className?: string;
};

/**
 * Hand-drawn SVG vignette for each game, designed to sit on the game's
 * gradient. Gives players an instant read of what the game looks like —
 * a real preview instead of a lone emoji.
 */
export function GameArt({ id, animated = false, className }: Props) {
  return (
    <svg
      viewBox="0 0 200 120"
      className={className}
      role="img"
      aria-label={`${id} game preview`}
      fill="none"
    >
      {id === "reaction" && <ReactionArt animated={animated} />}
      {id === "memory" && <MemoryArt animated={animated} />}
      {id === "nback" && <NBackArt animated={animated} />}
      {id === "math" && <MathArt animated={animated} />}
      {id === "schulte" && <SchulteArt animated={animated} />}
      {id === "pond" && <PondArt animated={animated} />}
      {id === "stroop" && <StroopArt animated={animated} />}
    </svg>
  );
}

type ArtProps = { animated: boolean };

const float = (animated: boolean, dy = 4, duration = 2.6, delay = 0) =>
  animated
    ? {
        animate: { y: [0, -dy, 0] },
        transition: { duration, delay, repeat: Infinity, ease: "easeInOut" as const },
      }
    : {};

/** Go/no-go search: distractor shapes + the big red triangle target with a tap ripple. */
function ReactionArt({ animated }: ArtProps) {
  return (
    <g>
      <circle cx="38" cy="34" r="13" fill="rgba(255,255,255,0.35)" />
      <rect x="146" y="20" width="26" height="26" rx="7" fill="rgba(255,255,255,0.3)" />
      <circle cx="162" cy="88" r="11" fill="rgba(255,255,255,0.25)" />
      <rect x="24" y="76" width="22" height="22" rx="6" fill="rgba(255,255,255,0.25)" />
      <motion.g {...float(animated, 5, 2.2)}>
        <path
          d="M100 30 L132 86 L68 86 Z"
          fill="#ef4444"
          stroke="rgba(255,255,255,0.95)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      </motion.g>
      {animated ? (
        <motion.circle
          cx="100"
          cy="68"
          r="18"
          stroke="#fde047"
          strokeWidth="3"
          animate={{ r: [16, 34], opacity: [1, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
      ) : (
        <>
          <circle cx="100" cy="68" r="26" stroke="#fde047" strokeWidth="3" opacity="0.9" />
          <circle cx="100" cy="68" r="36" stroke="#fde047" strokeWidth="2" opacity="0.4" />
        </>
      )}
      {/* fingertip about to tap the target */}
      <circle cx="100" cy="68" r="7" fill="white" opacity="0.95" />
    </g>
  );
}

/** Card grid with a flipped matching pair. */
function MemoryArt({ animated }: ArtProps) {
  const card = (x: number, y: number, faceUp = false, key?: string) => (
    <g key={key}>
      <rect
        x={x}
        y={y}
        width="34"
        height="42"
        rx="7"
        fill={faceUp ? "white" : "rgba(255,255,255,0.28)"}
        stroke="rgba(255,255,255,0.8)"
        strokeWidth="2"
      />
      {!faceUp && (
        <text
          x={x + 17}
          y={y + 28}
          textAnchor="middle"
          fontSize="16"
          fill="rgba(255,255,255,0.75)"
          fontWeight="800"
        >
          ?
        </text>
      )}
    </g>
  );
  const star = (cx: number, cy: number) => (
    <path
      d={starPath(cx, cy, 9, 4.2)}
      fill="#fbbf24"
      stroke="#b45309"
      strokeWidth="1"
    />
  );
  return (
    <g>
      {card(20, 14)}
      {card(62, 14, true)}
      {star(79, 34)}
      {card(104, 14)}
      {card(146, 14)}
      {card(20, 64)}
      {card(62, 64)}
      <motion.g {...float(animated, 3, 2.4, 0.3)}>
        {card(104, 64, true)}
        {star(121, 84)}
      </motion.g>
      {card(146, 64)}
    </g>
  );
}

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** Letter stream with an arc linking the current letter to the one 2 back. */
function NBackArt({ animated }: ArtProps) {
  const tile = (x: number, letter: string, hot = false) => (
    <g key={x}>
      <rect
        x={x}
        y="44"
        width="34"
        height="38"
        rx="8"
        fill={hot ? "white" : "rgba(255,255,255,0.25)"}
        stroke="rgba(255,255,255,0.8)"
        strokeWidth="2"
      />
      <text
        x={x + 17}
        y="70"
        textAnchor="middle"
        fontSize="20"
        fontWeight="800"
        fill={hot ? "#4f46e5" : "rgba(255,255,255,0.9)"}
      >
        {letter}
      </text>
    </g>
  );
  return (
    <g>
      {tile(18, "K")}
      {tile(60, "A", true)}
      {tile(102, "T")}
      <motion.g {...float(animated, 4, 2.2, 0.2)}>{tile(144, "A", true)}</motion.g>
      <path
        d="M77 40 Q119 8 161 40"
        stroke="#fde047"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
      <text x="119" y="24" textAnchor="middle" fontSize="11" fontWeight="800" fill="white">
        2 back ✓
      </text>
      <text x="119" y="102" textAnchor="middle" fontSize="10" fontWeight="700" fill="rgba(255,255,255,0.8)">
        MATCH
      </text>
      <rect x="87" y="90" width="64" height="18" rx="9" stroke="rgba(255,255,255,0.7)" strokeWidth="2" />
    </g>
  );
}

/** Equation tile with answer choices. */
function MathArt({ animated }: ArtProps) {
  const choice = (x: number, v: string, hot = false) => (
    <g key={v}>
      <rect
        x={x}
        y="74"
        width="36"
        height="28"
        rx="8"
        fill={hot ? "#34d399" : "rgba(255,255,255,0.25)"}
        stroke="rgba(255,255,255,0.8)"
        strokeWidth="2"
      />
      <text
        x={x + 18}
        y="93"
        textAnchor="middle"
        fontSize="14"
        fontWeight="800"
        fill={hot ? "#064e3b" : "white"}
      >
        {v}
      </text>
    </g>
  );
  return (
    <g>
      <motion.g {...float(animated, 4, 2.5)}>
        <rect x="46" y="14" width="108" height="42" rx="12" fill="white" opacity="0.95" />
        <text x="100" y="42" textAnchor="middle" fontSize="22" fontWeight="900" fill="#a21caf">
          7 × 8 = ?
        </text>
      </motion.g>
      {choice(16, "54")}
      {choice(60, "56", true)}
      {choice(104, "58")}
      {choice(148, "64")}
    </g>
  );
}

/** Mini Schulte grid with the search path traced through 1→2→3. */
function SchulteArt({ animated }: ArtProps) {
  const nums = [
    [7, 2, 12, 5],
    [10, 1, 8, 14],
    [3, 15, 6, 11],
    [13, 9, 4, 16],
  ];
  const cell = 26;
  const x0 = 48;
  const y0 = 8;
  const pos = (n: number) => {
    for (let r = 0; r < 4; r++) {
      const c = nums[r].indexOf(n);
      if (c >= 0)
        return { x: x0 + c * cell + cell / 2, y: y0 + r * cell + cell / 2 };
    }
    return { x: 0, y: 0 };
  };
  const p1 = pos(1);
  const p2 = pos(2);
  const p3 = pos(3);
  return (
    <g>
      {nums.map((row, r) =>
        row.map((n, c) => (
          <g key={`${r}-${c}`}>
            <rect
              x={x0 + c * cell + 1.5}
              y={y0 + r * cell + 1.5}
              width={cell - 3}
              height={cell - 3}
              rx="5"
              fill={n <= 2 ? "white" : "rgba(255,255,255,0.22)"}
              stroke="rgba(255,255,255,0.7)"
              strokeWidth="1.5"
            />
            <text
              x={x0 + c * cell + cell / 2}
              y={y0 + r * cell + cell / 2 + 4.5}
              textAnchor="middle"
              fontSize="12"
              fontWeight="800"
              fill={n <= 2 ? "#047857" : "white"}
            >
              {n}
            </text>
          </g>
        ))
      )}
      <motion.path
        d={`M${p1.x} ${p1.y} L${p2.x} ${p2.y} L${p3.x} ${p3.y}`}
        stroke="#fde047"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="4 6"
        {...(animated
          ? {
              animate: { strokeDashoffset: [0, -20] },
              transition: { duration: 1.6, repeat: Infinity, ease: "linear" },
            }
          : {})}
      />
      <circle cx={p3.x} cy={p3.y} r="9" stroke="#fde047" strokeWidth="2.5" />
    </g>
  );
}

/** Pond with lily pads and fish to track. */
function PondArt({ animated }: ArtProps) {
  const fish = (x: number, y: number, flip = false, delay = 0) => (
    <motion.g
      key={`${x}-${y}`}
      {...(animated
        ? {
            animate: { x: flip ? [0, -8, 0] : [0, 8, 0] },
            transition: { duration: 3, delay, repeat: Infinity, ease: "easeInOut" as const },
          }
        : {})}
    >
      <g transform={`translate(${x} ${y})${flip ? " scale(-1,1)" : ""}`}>
        <ellipse cx="0" cy="0" rx="13" ry="7" fill="#fb923c" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
        <path d="M-11 0 L-20 -6 L-20 6 Z" fill="#fb923c" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
        <circle cx="6" cy="-1.5" r="1.6" fill="#1e293b" />
      </g>
    </motion.g>
  );
  return (
    <g>
      <ellipse cx="100" cy="62" rx="88" ry="48" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
      <ellipse cx="52" cy="34" rx="15" ry="8" fill="#22c55e" opacity="0.85" />
      <ellipse cx="152" cy="82" rx="17" ry="9" fill="#22c55e" opacity="0.85" />
      <ellipse cx="138" cy="30" rx="12" ry="7" fill="#16a34a" opacity="0.8" />
      {fish(76, 58)}
      {fish(132, 52, true, 0.6)}
      {fish(96, 88, false, 1.1)}
    </g>
  );
}

/** The classic conflict: the word BLUE inked in red, plus colour answer keys. */
function StroopArt({ animated }: ArtProps) {
  const key = (x: number, fill: string, ring = false) => (
    <g key={fill}>
      <rect
        x={x}
        y="78"
        width="30"
        height="24"
        rx="8"
        fill={fill}
        stroke={ring ? "white" : "rgba(255,255,255,0.5)"}
        strokeWidth={ring ? 3 : 1.5}
      />
    </g>
  );
  return (
    <g>
      <motion.g {...float(animated, 4, 2.4)}>
        <rect x="38" y="16" width="124" height="44" rx="12" fill="white" opacity="0.95" />
        <text
          x="100"
          y="46"
          textAnchor="middle"
          fontSize="26"
          fontWeight="900"
          fill="#ef4444"
          letterSpacing="1"
        >
          BLUE
        </text>
      </motion.g>
      {key(28, "#ef4444", true)}
      {key(66, "#3b82f6")}
      {key(104, "#22c55e")}
      {key(142, "#f59e0b")}
    </g>
  );
}

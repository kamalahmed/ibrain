export type GameId =
  | "reaction"
  | "memory"
  | "nback"
  | "math"
  | "schulte"
  | "pond";

export type GameMeta = {
  id: GameId;
  name: string;
  tagline: string;
  description: string;
  path: string;
  emoji: string;
  accent: string; // tailwind gradient classes
  scoreUnit: string;
  // Lower raw score = better (e.g. ms, seconds). We invert for "brain score".
  lowerIsBetter: boolean;
};

export const GAMES: GameMeta[] = [
  {
    id: "reaction",
    name: "Reaction Time",
    tagline: "Tap the instant it turns green.",
    description:
      "Measures simple reaction time in milliseconds. Wait for the green signal, then tap as fast as you can. Five trials, lowest average wins.",
    path: "/play/reaction",
    emoji: "⚡️",
    accent: "from-amber-400 to-pink-500",
    scoreUnit: "ms",
    lowerIsBetter: true,
  },
  {
    id: "memory",
    name: "Memory Match",
    tagline: "Flip, remember, match.",
    description:
      "A classic matching game. Flip two cards at a time, find all pairs in as few moves and as little time as possible.",
    path: "/play/memory",
    emoji: "🧩",
    accent: "from-teal-400 to-sky-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
  },
  {
    id: "nback",
    name: "N-Back",
    tagline: "Is this letter the same as 2 back?",
    description:
      "A working-memory classic. A letter appears every 2 seconds — press Match when the current letter is identical to the one 2 steps before.",
    path: "/play/nback",
    emoji: "🧠",
    accent: "from-indigo-400 to-brand-600",
    scoreUnit: "pts",
    lowerIsBetter: false,
  },
  {
    id: "math",
    name: "Math Sprint",
    tagline: "Quick — what's 17 × 4?",
    description:
      "60 seconds of arithmetic. Type the correct answer as fast as you can. Correct answers add points, wrong answers cost time.",
    path: "/play/math",
    emoji: "➗",
    accent: "from-fuchsia-400 to-brand-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
  },
  {
    id: "schulte",
    name: "Schulte Table",
    tagline: "1 to 25, in order, as fast as you can.",
    description:
      "A peripheral-vision and focus drill. A 5×5 grid of shuffled numbers. Tap them in order from 1 to 25 as quickly as possible.",
    path: "/play/schulte",
    emoji: "🔢",
    accent: "from-emerald-400 to-teal-500",
    scoreUnit: "s",
    lowerIsBetter: true,
  },
  {
    id: "pond",
    name: "Attention Pond",
    tagline: "Tap every fish exactly once — no doubles.",
    description:
      "A divided-attention drill based on the Multiple Object Tracking paradigm (Pylyshyn & Storm, 1988). Fish drift around the pond; tap each one exactly once. Tap the same fish twice and you lose points.",
    path: "/play/pond",
    emoji: "🐟",
    accent: "from-cyan-400 to-emerald-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
  },
];

export function getGame(id: GameId): GameMeta {
  const g = GAMES.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}

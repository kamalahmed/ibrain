export type GameId =
  | "reaction"
  | "memory"
  | "nback"
  | "math"
  | "schulte"
  | "pond"
  | "stroop";

/** Broad cognitive areas each game trains — the way Lumosity-style trainers
 *  group their exercises so progress is legible, not just a pile of scores. */
export type CognitiveDomain =
  | "speed"
  | "memory"
  | "attention"
  | "problem"
  | "flexibility";

export type DomainMeta = {
  id: CognitiveDomain;
  name: string;
  /** One-line description of the cognitive area. */
  blurb: string;
  accent: string; // tailwind gradient classes
};

export const DOMAINS: Record<CognitiveDomain, DomainMeta> = {
  speed: {
    id: "speed",
    name: "Speed",
    blurb: "How quickly you take in information and act on it.",
    accent: "from-amber-400 to-pink-500",
  },
  memory: {
    id: "memory",
    name: "Memory",
    blurb: "Holding and updating information over short spans.",
    accent: "from-teal-400 to-sky-500",
  },
  attention: {
    id: "attention",
    name: "Attention",
    blurb: "Staying focused and tracking what matters.",
    accent: "from-emerald-400 to-teal-500",
  },
  problem: {
    id: "problem",
    name: "Problem Solving",
    blurb: "Reasoning through numbers and patterns under pressure.",
    accent: "from-fuchsia-400 to-brand-500",
  },
  flexibility: {
    id: "flexibility",
    name: "Flexibility",
    blurb: "Switching rules and overriding automatic responses.",
    accent: "from-violet-500 to-pink-500",
  },
};

export const DOMAIN_ORDER: CognitiveDomain[] = [
  "speed",
  "attention",
  "memory",
  "problem",
  "flexibility",
];

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
  /** Cognitive area this game primarily trains. */
  domain: CognitiveDomain;
  /** "What this trains" — the science framing shown before a session. */
  trains: string;
};

export const GAMES: GameMeta[] = [
  {
    id: "reaction",
    name: "Reaction Time",
    tagline: "Five levels from simple tap to shape discrimination.",
    description:
      "Five reflex levels in one 5-minute session. Level 1 is a pure reaction test; later levels add go/no-go and shape discrimination — only tap on a green circle.",
    path: "/play/reaction",
    emoji: "⚡️",
    accent: "from-amber-400 to-pink-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
    domain: "speed",
    trains:
      "Processing speed and motor response — the lag between seeing a cue and acting on it. Faster, more consistent responses point to sharper information processing.",
  },
  {
    id: "memory",
    name: "Memory Match",
    tagline: "Five grids. 4×4 → 6×6. One 5-minute timer.",
    description:
      "A classic matching game made bigger. Five grids in one 5-minute session — 4×4, 4×5, 4×6, 5×6, then 6×6. Flip two cards at a time; match all pairs to unlock the next grid.",
    path: "/play/memory",
    emoji: "🧩",
    accent: "from-teal-400 to-sky-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
    domain: "memory",
    trains:
      "Visuospatial working memory — building and refreshing a mental map of where things are. The same system you lean on for names, faces and where you left your keys.",
  },
  {
    id: "nback",
    name: "N-Back",
    tagline: "Five levels climbing from 1-back to 3-back.",
    description:
      "A working-memory classic. Five n-back levels in one 5-minute session: 1-back → 2-back → 3-back, faster each time. Press Match (or space) whenever the current letter equals the one N steps before.",
    path: "/play/nback",
    emoji: "🧠",
    accent: "from-indigo-400 to-brand-600",
    scoreUnit: "pts",
    lowerIsBetter: false,
    domain: "memory",
    trains:
      "Working-memory updating — continuously holding, comparing and refreshing a short sequence. The n-back is one of the most studied measures of fluid working memory in cognitive science.",
  },
  {
    id: "math",
    name: "Math Sprint",
    tagline: "Five levels. Five minutes. How high can you climb?",
    description:
      "Five arithmetic levels, one 5-minute timer. Tap the correct answer from four choices on levels 1–4, then type it on level 5. Clear each level to unlock the next. Wrong answers cost time.",
    path: "/play/math",
    emoji: "➗",
    accent: "from-fuchsia-400 to-brand-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
    domain: "problem",
    trains:
      "Numerical fluency and decision-making under time pressure — retrieving arithmetic facts quickly while resisting plausible-looking wrong answers.",
  },
  {
    id: "schulte",
    name: "Schulte Table",
    tagline: "Five grids. 5×5 → 7×7. Colours try to distract.",
    description:
      "A peripheral-vision drill. Five grids in one 5-minute session — 5×5, 5×5 coloured, 6×6, 6×6 coloured, then 7×7. Tap the numbers in order; clear each grid to unlock the next. Faster clears = more points.",
    path: "/play/schulte",
    emoji: "🔢",
    accent: "from-emerald-400 to-teal-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
    domain: "attention",
    trains:
      "Visual search and peripheral attention — Schulte tables are a long-standing drill for widening your span of attention and taking in more at a glance.",
  },
  {
    id: "pond",
    name: "Attention Pond",
    tagline: "Five ponds. 3 → 7 fish. Tap each one exactly once.",
    description:
      "A divided-attention drill based on Multiple Object Tracking (Pylyshyn & Storm, 1988). Five ponds, one 5-minute session: fish counts climb from 3 to 7 and lily-pad occlusion grows level by level. Tap every fish once — doubles cost points, and fed fish look the same as unfed.",
    path: "/play/pond",
    emoji: "🐟",
    accent: "from-cyan-400 to-emerald-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
    domain: "attention",
    trains:
      "Divided attention and multiple-object tracking (Pylyshyn & Storm, 1988) — keeping several moving targets in mind at once without losing track of which you've handled.",
  },
  {
    id: "stroop",
    name: "Stroop Test",
    tagline: "Five levels. Colour vs. word conflict. One 5-minute timer.",
    description:
      "The classic inhibition task. Five Stroop levels in one 5-minute session: colour swatches, plain words, congruent word+ink, the classic incongruent conflict, and a mixed level that flips the rule each trial. Tap one of four colour buttons that matches the prompt.",
    path: "/play/stroop",
    emoji: "🎨",
    accent: "from-violet-500 to-pink-500",
    scoreUnit: "pts",
    lowerIsBetter: false,
    domain: "flexibility",
    trains:
      "Response inhibition and cognitive control — the Stroop effect (Stroop, 1935) measures how well you override an automatic response to follow the rule that actually matters.",
  },
];

export function gamesByDomain(domain: CognitiveDomain): GameMeta[] {
  return GAMES.filter((g) => g.domain === domain);
}

export function getGame(id: GameId): GameMeta {
  const g = GAMES.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown game: ${id}`);
  return g;
}

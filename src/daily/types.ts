import type { GameId } from "@/lib/games";

export type DailyMiniProps = {
  onComplete: (score: number) => void;
};

export type DailyGameSlot = {
  id: GameId;
  label: string;
  emoji: string;
  /** ~seconds budget shown to the user */
  estimatedSeconds: number;
};

export const DAILY_GAMES: DailyGameSlot[] = [
  { id: "reaction", label: "Reaction", emoji: "⚡️", estimatedSeconds: 25 },
  { id: "math", label: "Math", emoji: "➗", estimatedSeconds: 45 },
  { id: "schulte", label: "Schulte", emoji: "🔢", estimatedSeconds: 45 },
  { id: "memory", label: "Memory", emoji: "🧩", estimatedSeconds: 60 },
  { id: "nback", label: "N-Back", emoji: "🧠", estimatedSeconds: 30 },
  { id: "pond", label: "Pond", emoji: "🐟", estimatedSeconds: 30 },
];

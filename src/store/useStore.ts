import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { GameId } from "@/lib/games";
import { GAMES } from "@/lib/games";
import { normalizeScore } from "@/lib/scoring";
import { daysBetween, todayKey } from "@/lib/date";

export type PlayRecord = {
  id: string;
  game: GameId;
  score: number; // raw
  playedAt: number; // epoch ms
};

type BestByGame = Partial<Record<GameId, number>>;

type State = {
  bestScores: BestByGame;
  history: PlayRecord[]; // most recent first
  streak: number;
  lastPlayed: string | null; // YYYY-MM-DD
  theme: "light" | "dark" | "system";
  tutorialsSeen: Partial<Record<GameId, boolean>>;
};

type Actions = {
  recordPlay: (game: GameId, score: number) => { isBest: boolean };
  setTheme: (t: State["theme"]) => void;
  toggleTheme: () => void;
  markTutorialSeen: (game: GameId) => void;
  resetTutorials: () => void;
  reset: () => void;
};

const MAX_HISTORY = 50;

const initial: State = {
  bestScores: {},
  history: [],
  streak: 0,
  lastPlayed: null,
  theme: "system",
  tutorialsSeen: {},
};

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...initial,

      recordPlay: (game, score) => {
        const meta = GAMES.find((g) => g.id === game)!;
        const prevBest = get().bestScores[game];
        const isBest =
          prevBest === undefined ||
          (meta.lowerIsBetter ? score < prevBest : score > prevBest);

        const today = todayKey();
        const last = get().lastPlayed;
        let streak = get().streak;
        if (last === null) streak = 1;
        else if (last === today) {
          // already counted today
        } else {
          const diff = daysBetween(last, today);
          streak = diff === 1 ? streak + 1 : 1;
        }

        const record: PlayRecord = {
          id: crypto.randomUUID(),
          game,
          score,
          playedAt: Date.now(),
        };

        set((s) => ({
          bestScores: {
            ...s.bestScores,
            [game]: isBest ? score : s.bestScores[game],
          },
          history: [record, ...s.history].slice(0, MAX_HISTORY),
          streak,
          lastPlayed: today,
        }));

        return { isBest };
      },

      setTheme: (t) => {
        set({ theme: t });
        applyTheme(t);
      },
      toggleTheme: () => {
        const cur = get().theme;
        const next: State["theme"] = cur === "dark" ? "light" : "dark";
        set({ theme: next });
        applyTheme(next);
      },

      markTutorialSeen: (game) =>
        set((s) => ({
          tutorialsSeen: { ...s.tutorialsSeen, [game]: true },
        })),
      resetTutorials: () => set({ tutorialsSeen: {} }),

      reset: () => set({ ...initial }),
    }),
    {
      name: "ibrain:state:v1",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);

function applyTheme(t: State["theme"]) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = t === "dark" || (t === "system" && prefersDark);
  root.classList.toggle("dark", isDark);
  try {
    localStorage.setItem("ibrain:theme", isDark ? "dark" : "light");
  } catch {
    // ignore
  }
}

export function selectBrainScore(state: State): number {
  // Use each game's best score (if any) → normalized 0-100 → average across
  // the games that have been played. If nothing played, return 0.
  const parts: number[] = [];
  for (const g of GAMES) {
    const best = state.bestScores[g.id];
    if (typeof best === "number") parts.push(normalizeScore(g.id, best));
  }
  if (parts.length === 0) return 0;
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return Math.round(avg);
}

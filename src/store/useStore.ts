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

export type DailyResult = {
  id: string;
  date: string; // YYYY-MM-DD
  totalScore: number;
  perGame: Array<{ game: GameId; score: number }>;
  completedAt: number;
  /** True if played after today's non-practice daily already existed (streak-neutral). */
  isPractice?: boolean;
};

type BestByGame = Partial<Record<GameId, number>>;

export type ReducedMotionSetting = "auto" | "on" | "off";

type State = {
  bestScores: BestByGame;
  history: PlayRecord[]; // most recent first
  streak: number;
  lastPlayed: string | null; // YYYY-MM-DD
  theme: "light" | "dark" | "system";
  tutorialsSeen: Partial<Record<GameId, boolean>>;
  dailyResults: DailyResult[]; // most recent first
  dailyStreak: number;
  lastDailyDate: string | null; // YYYY-MM-DD of the last non-practice daily
  bestDaily: number;
  reducedMotion: ReducedMotionSetting;
  hapticsEnabled: boolean;
};

type Actions = {
  recordPlay: (game: GameId, score: number) => { isBest: boolean };
  recordDaily: (
    totalScore: number,
    perGame: Array<{ game: GameId; score: number }>
  ) => { isBest: boolean; streak: number; isPractice: boolean };
  setTheme: (t: State["theme"]) => void;
  toggleTheme: () => void;
  markTutorialSeen: (game: GameId) => void;
  resetTutorials: () => void;
  setReducedMotion: (v: ReducedMotionSetting) => void;
  setHapticsEnabled: (b: boolean) => void;
  /** Clear play history, bests, daily state. Keeps tutorialsSeen + settings. */
  resetHistory: () => void;
  reset: () => void;
};

const MAX_HISTORY = 50;
const MAX_DAILY_HISTORY = 60;

const initial: State = {
  bestScores: {},
  history: [],
  streak: 0,
  lastPlayed: null,
  theme: "system",
  tutorialsSeen: {},
  dailyResults: [],
  dailyStreak: 0,
  lastDailyDate: null,
  bestDaily: 0,
  reducedMotion: "auto",
  hapticsEnabled: true,
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

      setReducedMotion: (v) => set({ reducedMotion: v }),
      setHapticsEnabled: (b) => set({ hapticsEnabled: b }),

      resetHistory: () =>
        set({
          bestScores: {},
          history: [],
          streak: 0,
          lastPlayed: null,
          dailyResults: [],
          dailyStreak: 0,
          lastDailyDate: null,
          bestDaily: 0,
        }),

      recordDaily: (totalScore, perGame) => {
        const today = todayKey();
        const state = get();
        const alreadyDoneToday = state.lastDailyDate === today;

        // Practice run: doesn't affect streak, best, or replace today's entry
        if (alreadyDoneToday) {
          const record: DailyResult = {
            id: crypto.randomUUID(),
            date: today,
            totalScore,
            perGame,
            completedAt: Date.now(),
            isPractice: true,
          };
          set((s) => ({
            dailyResults: [record, ...s.dailyResults].slice(0, MAX_DAILY_HISTORY),
          }));
          return {
            isBest: totalScore > state.bestDaily,
            streak: state.dailyStreak,
            isPractice: true,
          };
        }

        // First run today — counts for streak
        let streak = state.dailyStreak;
        if (state.lastDailyDate === null) streak = 1;
        else {
          const diff = daysBetween(state.lastDailyDate, today);
          streak = diff === 1 ? streak + 1 : 1;
        }

        const isBest = totalScore > state.bestDaily;
        const record: DailyResult = {
          id: crypto.randomUUID(),
          date: today,
          totalScore,
          perGame,
          completedAt: Date.now(),
        };
        set((s) => ({
          dailyResults: [record, ...s.dailyResults].slice(0, MAX_DAILY_HISTORY),
          dailyStreak: streak,
          lastDailyDate: today,
          bestDaily: isBest ? totalScore : s.bestDaily,
        }));
        return { isBest, streak, isPractice: false };
      },

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

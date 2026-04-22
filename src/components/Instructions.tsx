import type { ReactNode } from "react";
import type { GameMeta } from "@/lib/games";
import { formatScore } from "@/lib/scoring";
import { useStore } from "@/store/useStore";

type Props = {
  game: GameMeta;
  onStart: () => void;
  children?: ReactNode;
};

export function Instructions({ game, onStart, children }: Props) {
  const best = useStore((s) => s.bestScores[game.id]);
  return (
    <section aria-labelledby="how-to-play" className="card">
      <h2 id="how-to-play" className="text-lg font-bold text-slate-900 dark:text-white">
        How to play
      </h2>
      <p className="mt-2 text-slate-700 dark:text-slate-300">{game.description}</p>
      {children && (
        <div className="mt-3 text-sm text-slate-600 dark:text-slate-400">{children}</div>
      )}
      <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <span className="text-slate-500 dark:text-slate-400">Your best:</span>{" "}
          <span className="font-bold text-slate-900 dark:text-white">
            {best === undefined ? "—" : formatScore(game.id, best)}
          </span>
        </div>
        <button type="button" className="btn-primary" onClick={onStart}>
          Start
        </button>
      </div>
    </section>
  );
}

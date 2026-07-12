import { useState } from "react";
import { GameShell } from "@/components/GameShell";
import { Instructions } from "@/components/Instructions";
import { ResultsScreen } from "@/components/ResultsScreen";
import { getGame } from "@/lib/games";
import { useStore } from "@/store/useStore";

// Placeholder skeleton — full scene implementation lands with the game
// redesign workflow (see docs/GAME_DESIGN.md).
export default function PatternRecall() {
  const game = getGame("pattern");
  const recordPlay = useStore((s) => s.recordPlay);
  const [phase, setPhase] = useState<"intro" | "done">("intro");
  const [isBest, setIsBest] = useState(false);

  const start = () => {
    const { isBest: best } = recordPlay(game.id, 0);
    setIsBest(best);
    setPhase("done");
  };

  return (
    <GameShell game={game}>
      {phase === "intro" && <Instructions game={game} onStart={start} />}
      {phase === "done" && (
        <ResultsScreen
          game={game}
          score={0}
          isBest={isBest}
          onPlayAgain={() => setPhase("intro")}
        />
      )}
    </GameShell>
  );
}

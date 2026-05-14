import type { GameId } from "./games";

/**
 * Normalize a raw game score into a 0–100 "brain score" component.
 * Targets are rough skill anchors; values are clamped.
 */
// Anchors are calibrated for the 3-minute, 4-level sessions — a strong run of
// each game maps to ~100. They are deliberately rough.
export function normalizeScore(id: GameId, raw: number): number {
  switch (id) {
    case "reaction": {
      // 1500 pts ≈ strong session → 100
      return clamp((raw / 1500) * 100);
    }
    case "memory": {
      // 900 pts ≈ strong run → 100
      return clamp((raw / 900) * 100);
    }
    case "nback": {
      // 550 pts ≈ cleared most levels with good hits → 100
      return clamp((raw / 550) * 100);
    }
    case "math": {
      // 240 pts ≈ cleared most levels → 100
      return clamp((raw / 240) * 100);
    }
    case "schulte": {
      // 720 session pts ≈ strong run → 100
      return clamp((raw / 720) * 100);
    }
    case "pond": {
      // 1500 pts ≈ strong run → 100
      return clamp((raw / 1500) * 100);
    }
    case "stroop": {
      // 3000 pts ≈ strong run → 100
      return clamp((raw / 3000) * 100);
    }
  }
}

export function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function formatScore(id: GameId, raw: number): string {
  switch (id) {
    case "reaction":
      return `${Math.round(raw)} pts`;
    case "schulte":
    case "memory":
    case "nback":
    case "math":
    case "pond":
    case "stroop":
      return `${Math.round(raw)} pts`;
  }
}

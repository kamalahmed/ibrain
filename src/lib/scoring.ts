import type { GameId } from "./games";

/**
 * Normalize a raw game score into a 0–100 "brain score" component.
 * Targets are rough skill anchors; values are clamped.
 */
export function normalizeScore(id: GameId, raw: number): number {
  switch (id) {
    case "reaction": {
      // session points, higher is better. 2500 pts ≈ strong session → 100
      return clamp((raw / 2500) * 100);
    }
    case "memory": {
      // session points, higher is better. 1500 pts ≈ strong run → 100
      return clamp((raw / 1500) * 100);
    }
    case "nback": {
      // session points, higher is better. 900 pts ≈ cleared most levels with good hits → 100
      return clamp((raw / 900) * 100);
    }
    case "math": {
      // session points, higher is better. 400 pts ≈ cleared 4+ levels → 100
      return clamp((raw / 400) * 100);
    }
    case "schulte": {
      // session points, higher is better. 1200 session pts ≈ strong run → 100
      return clamp((raw / 1200) * 100);
    }
    case "pond": {
      // session points, higher is better. 2500 pts ≈ strong run → 100
      return clamp((raw / 2500) * 100);
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
      return `${Math.round(raw)} pts`;
  }
}

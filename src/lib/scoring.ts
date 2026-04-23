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
      // points, higher is better. 1000pts → 100
      return clamp((raw / 1000) * 100);
    }
    case "nback": {
      // points, higher is better. 20 hits → 100
      return clamp((raw / 20) * 100);
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
      // points, higher is better. 2000 pts → 100
      return clamp((raw / 2000) * 100);
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

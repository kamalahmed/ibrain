import type { GameId } from "./games";

/**
 * Normalize a raw game score into a 0–100 "brain score" component.
 * Targets are rough skill anchors; values are clamped.
 */
export function normalizeScore(id: GameId, raw: number): number {
  switch (id) {
    case "reaction": {
      // ms, lower is better. 200ms → 100, 600ms → 0
      const v = 100 - ((raw - 200) / (600 - 200)) * 100;
      return clamp(v);
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
      // points, higher is better. 30 in a minute → 100
      return clamp((raw / 30) * 100);
    }
    case "schulte": {
      // seconds, lower is better. 20s → 100, 90s → 0
      const v = 100 - ((raw - 20) / (90 - 20)) * 100;
      return clamp(v);
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
      return `${Math.round(raw)} ms`;
    case "schulte":
      return `${raw.toFixed(1)} s`;
    case "memory":
    case "nback":
    case "math":
    case "pond":
      return `${Math.round(raw)} pts`;
  }
}

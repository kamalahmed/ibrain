import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectBrainScore,
  computeDomainScores,
  useStore,
  type DomainScore,
} from "@/store/useStore";
import { DOMAIN_ORDER, GAMES } from "@/lib/games";

test("selectBrainScore is 0 before anything is played", () => {
  assert.equal(selectBrainScore({ bestScores: {} } as never), 0);
});

test("selectBrainScore averages normalized bests across played games", () => {
  // math anchor 400 and reaction anchor 2500 both normalize to 100.
  const state = { bestScores: { math: 400, reaction: 2500 } } as never;
  assert.equal(selectBrainScore(state), 100);
});

test("computeDomainScores reports zero/untrained for an empty profile", () => {
  const ds = computeDomainScores({});
  for (const d of DOMAIN_ORDER) {
    const entry: DomainScore = ds[d];
    assert.equal(entry.score, 0);
    assert.equal(entry.played, 0);
    assert.ok(entry.total >= 1, `domain ${d} should track its game count`);
  }
});

test("computeDomainScores averages the normalized bests within a domain", () => {
  // memory domain = Memory Match (anchor 1500) + N-Back (anchor 900).
  const ds = computeDomainScores({ memory: 1500, nback: 900 });
  assert.equal(ds.memory.score, 100);
  assert.equal(ds.memory.played, 2);
  assert.equal(ds.memory.total, 2);
});

test("computeDomainScores totals add up to the full game roster", () => {
  const ds = computeDomainScores({});
  const total = DOMAIN_ORDER.reduce((n, d) => n + ds[d].total, 0);
  assert.equal(total, GAMES.length);
});

// Regression guard for the Dashboard crash: computeDomainScores builds a fresh
// object every call, so it must NEVER be passed straight to useStore() as a
// selector — zustand would see a new reference each render and loop forever.
// Consumers must memoize it. This test pins the hazard so the contract is
// explicit and the rename away from "select*" is intentional.
test("computeDomainScores returns a fresh, deeply-equal object each call", () => {
  const a = computeDomainScores({ math: 400 });
  const b = computeDomainScores({ math: 400 });
  assert.notEqual(a, b, "must be a new reference (not a memo-safe selector)");
  assert.deepEqual(a, b, "same input must produce the same data");
});

// The Dashboard fix relies on subscribing to the raw `bestScores` slice (a
// referentially stable object) and memoizing computeDomainScores off it.
// If `bestScores` weren't stable between reads, even the memoized version
// would thrash. Pin that property here.
test("the bestScores store slice is referentially stable between reads", () => {
  const first = useStore.getState().bestScores;
  const second = useStore.getState().bestScores;
  assert.equal(first, second, "bestScores must be a stable reference");
});

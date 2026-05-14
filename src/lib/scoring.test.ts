import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScore, clamp, formatScore } from "@/lib/scoring";
import { GAMES } from "@/lib/games";

test("clamp keeps values within 0-100 by default", () => {
  assert.equal(clamp(-10), 0);
  assert.equal(clamp(150), 100);
  assert.equal(clamp(42), 42);
});

test("clamp respects custom bounds", () => {
  assert.equal(clamp(5, 10, 20), 10);
  assert.equal(clamp(25, 10, 20), 20);
});

test("normalizeScore stays within 0-100 for every game", () => {
  for (const g of GAMES) {
    assert.equal(normalizeScore(g.id, 0), 0, `${g.id} floor`);
    const big = normalizeScore(g.id, 1e9);
    assert.ok(big <= 100 && big >= 0, `${g.id} clamps high input`);
  }
});

test("normalizeScore scales linearly below the anchor", () => {
  // math anchor: 240 raw points => 100
  assert.equal(normalizeScore("math", 120), 50);
  assert.equal(normalizeScore("math", 240), 100);
});

test("formatScore renders rounded integer points", () => {
  assert.equal(formatScore("math", 123.7), "124 pts");
  assert.equal(formatScore("reaction", 0), "0 pts");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAMES,
  DOMAINS,
  DOMAIN_ORDER,
  getGame,
  gamesByDomain,
} from "@/lib/games";

test("every game has a known domain and a real 'trains' blurb", () => {
  for (const g of GAMES) {
    assert.ok(DOMAINS[g.domain], `${g.id} points at unknown domain "${g.domain}"`);
    assert.ok(
      typeof g.trains === "string" && g.trains.length > 20,
      `${g.id} is missing a 'trains' blurb`
    );
  }
});

test("DOMAIN_ORDER lists exactly the domains in DOMAINS, no dupes", () => {
  assert.equal(new Set(DOMAIN_ORDER).size, DOMAIN_ORDER.length);
  assert.deepEqual([...DOMAIN_ORDER].sort(), Object.keys(DOMAINS).sort());
});

test("every domain has at least one game", () => {
  for (const d of DOMAIN_ORDER) {
    assert.ok(gamesByDomain(d).length >= 1, `domain "${d}" has no games`);
  }
});

test("gamesByDomain partitions GAMES with no leftovers", () => {
  const counted = DOMAIN_ORDER.reduce(
    (n, d) => n + gamesByDomain(d).length,
    0
  );
  assert.equal(counted, GAMES.length);
});

test("game ids and paths are unique", () => {
  assert.equal(new Set(GAMES.map((g) => g.id)).size, GAMES.length);
  assert.equal(new Set(GAMES.map((g) => g.path)).size, GAMES.length);
});

test("getGame returns the matching game and throws on unknown ids", () => {
  assert.equal(getGame("math").id, "math");
  // @ts-expect-error - exercising the runtime guard
  assert.throws(() => getGame("not-a-game"));
});

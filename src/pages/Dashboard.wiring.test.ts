import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Static guard for the Dashboard crash regression. computeDomainScores builds
// a fresh object per call; handing it straight to useStore() makes zustand
// re-render forever. It must be memoized instead.
const source = fs.readFileSync(
  path.join(process.cwd(), "src/pages/Dashboard.tsx"),
  "utf8"
);

test("Dashboard never passes computeDomainScores directly to useStore()", () => {
  assert.ok(
    !/useStore\(\s*computeDomainScores\s*\)/.test(source),
    "computeDomainScores must not be used as a zustand selector"
  );
});

test("Dashboard memoizes computeDomainScores", () => {
  assert.ok(
    /useMemo\(\s*\(\)\s*=>\s*computeDomainScores/.test(source),
    "computeDomainScores should be wrapped in useMemo keyed on bestScores"
  );
});

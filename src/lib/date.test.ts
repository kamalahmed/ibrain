import { test } from "node:test";
import assert from "node:assert/strict";
import { todayKey, daysBetween } from "@/lib/date";

test("todayKey formats a date as YYYY-MM-DD with zero padding", () => {
  assert.equal(todayKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(todayKey(new Date(2026, 11, 31)), "2026-12-31");
});

test("daysBetween counts whole days forward and backward", () => {
  assert.equal(daysBetween("2026-05-14", "2026-05-15"), 1);
  assert.equal(daysBetween("2026-05-14", "2026-05-14"), 0);
  assert.equal(daysBetween("2026-05-15", "2026-05-14"), -1);
});

test("daysBetween spans month and year boundaries", () => {
  assert.equal(daysBetween("2026-01-31", "2026-02-01"), 1);
  assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
});

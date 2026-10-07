import test from "node:test";
import assert from "node:assert/strict";
import { formatBackupDate } from "../src/backup-window/date-format.mjs";

test("Backup dates omit the current year and include a different year", () => {
  const current = new Date(2026, 9, 7);
  assert.doesNotMatch(formatBackupDate("2026-10-07T19:14:00", current), /2026/);
  assert.match(formatBackupDate("2025-10-07T19:14:00", current), /2025/);
});

test("unparseable Backup dates are empty", () => {
  assert.equal(formatBackupDate("not a date", new Date(2026, 9, 7)), "");
});

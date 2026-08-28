import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UNLOCK_MINUTES,
  parseUnlockMinutes,
} from "../src/lib/unlock-duration.ts";

test("unlock duration accepts whole minutes from 1 through 120", () => {
  assert.equal(parseUnlockMinutes("1"), 1);
  assert.equal(parseUnlockMinutes("10"), 10);
  assert.equal(parseUnlockMinutes("120"), 120);
});

test("unlock duration falls back to 10 for invalid preferences", () => {
  for (const value of [null, "", "not-a-number", "0", "121", "1.5"]) {
    assert.equal(parseUnlockMinutes(value), DEFAULT_UNLOCK_MINUTES);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { clampPaneWidth } from "../src/lib/pane-width.ts";

test("pane width keeps both panes above their minimum width", () => {
  assert.equal(clampPaneWidth(200, 1000, 320, 360), 320);
  assert.equal(clampPaneWidth(320, 1000, 480, 360), 480);
  assert.equal(clampPaneWidth(500, 1000, 320, 360), 500);
  assert.equal(clampPaneWidth(800, 1000, 320, 360), 640);
  assert.equal(clampPaneWidth(400, 600, 320, 360), 320);
});

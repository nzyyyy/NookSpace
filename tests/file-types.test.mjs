import assert from "node:assert/strict";
import test from "node:test";
import { isMediaFile } from "../src/lib/file-types.ts";

test("media files are recognized by MIME or common extension", () => {
  assert.equal(isMediaFile("audio/mpeg", "track.bin"), true);
  assert.equal(isMediaFile("application/octet-stream", "recording.M4A"), true);
  assert.equal(isMediaFile("application/octet-stream", "movie.webm"), true);
  assert.equal(isMediaFile("application/pdf", "document.pdf"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalFormat,
  displayStem,
  isHtmlFile,
  isLargeTextFile,
  isMediaFile,
  isSwitchableText,
  LARGE_TEXT_FILE_THRESHOLD,
} from "../src/lib/file-types.ts";

test("media files are recognized by MIME or common extension", () => {
  assert.equal(isMediaFile("audio/mpeg", "track.bin"), true);
  assert.equal(isMediaFile("application/octet-stream", "recording.M4A"), true);
  assert.equal(isMediaFile("application/octet-stream", "movie.webm"), true);
  assert.equal(isMediaFile("application/pdf", "document.pdf"), false);
});

test("switchable text formats strip stems", () => {
  assert.equal(canonicalFormat("markdown"), "md");
  assert.equal(isSwitchableText("files/x/note.md"), true);
  assert.equal(isSwitchableText("photo.png"), false);
  assert.equal(displayStem("data.csv", "files/1/data.csv"), "data");
  assert.equal(displayStem("无标题", "files/1/无标题.md"), "无标题");
});

test("HTML files are readable but not switchable", () => {
  assert.equal(isHtmlFile("text/html", "page.bin"), true);
  assert.equal(isHtmlFile("application/octet-stream", "page.HTML"), true);
  assert.equal(isHtmlFile("application/octet-stream", "page.htm"), true);
  assert.equal(isSwitchableText("page.html"), false);
  assert.equal(isSwitchableText("page.htm"), false);
});

test("large text files default to read mode at 256 KiB", () => {
  assert.equal(isLargeTextFile(LARGE_TEXT_FILE_THRESHOLD - 1), false);
  assert.equal(isLargeTextFile(LARGE_TEXT_FILE_THRESHOLD), true);
  assert.equal(isLargeTextFile(1, LARGE_TEXT_FILE_THRESHOLD), true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { fitNoteText, wrapText } from "../src/noteText.js";

// A monospace measure keeps expectations readable: each character is half the
// font size wide.
const measure = (text: string, fontSize: number) =>
  [...text].length * fontSize * 0.5;

test("wraps words and keeps explicit paragraphs", () => {
  assert.deepEqual(wrapText(measure, "one two three\n\nfour", 10, 40), [
    "one two",
    "three",
    "",
    "four",
  ]);
});

test("breaks words that are wider than the box", () => {
  assert.deepEqual(wrapText(measure, "abcdefghij", 10, 20), [
    "abcd",
    "efgh",
    "ij",
  ]);
});

test("short notes use the largest font size", () => {
  const box = { width: 400, height: 400, minFontSize: 10, maxFontSize: 80 };
  assert.equal(fitNoteText(measure, "Hi", box).fontSize, 80);
});

test("longer notes shrink until they fit", () => {
  const box = { width: 400, height: 400, minFontSize: 10, maxFontSize: 80 };
  const short = fitNoteText(measure, "Back in five minutes", box);
  const long = fitNoteText(measure, "word ".repeat(200), box);
  assert.ok(long.fontSize < short.fontSize);
  assert.equal(long.truncated, false);
  assert.ok(long.lines.length * long.lineHeight <= box.height);
  assert.ok(long.lines.every((line) => measure(line, long.fontSize) <= 400));
});

test("text that cannot fit at the minimum size ends with an ellipsis", () => {
  const box = { width: 100, height: 50, minFontSize: 10, maxFontSize: 20 };
  const layout = fitNoteText(measure, "word ".repeat(500), box);
  assert.equal(layout.fontSize, 10);
  assert.equal(layout.truncated, true);
  assert.equal(layout.lines.length, 4);
  assert.ok(layout.lines.at(-1)!.endsWith("…"));
  assert.ok(measure(layout.lines.at(-1)!, 10) <= 100);
});

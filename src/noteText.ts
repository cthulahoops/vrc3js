export type MeasureText = (text: string, fontSize: number) => number;

export interface NoteTextLayout {
  fontSize: number;
  lineHeight: number;
  lines: string[];
  truncated: boolean;
}

export interface NoteTextBox {
  width: number;
  height: number;
  minFontSize: number;
  maxFontSize: number;
  lineSpacing?: number;
  /** Shrink the font so no word has to be broken, down to `minFontSize`. */
  keepWords?: boolean;
}

function splitLongWord(
  measure: MeasureText,
  word: string,
  fontSize: number,
  maxWidth: number,
): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const character of word) {
    if (piece && measure(piece + character, fontSize) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else piece += character;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Greedy word wrap. Explicit newlines are kept; blank lines separate paragraphs. */
export function wrapText(
  measure: MeasureText,
  text: string,
  fontSize: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((word) => splitLongWord(measure, word, fontSize, maxWidth));
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate, fontSize) > maxWidth) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/**
 * Choose the largest font size whose wrapped text fits the box. Text that does
 * not fit at the minimum size is cut off with an ellipsis.
 */
export function fitNoteText(
  measure: MeasureText,
  text: string,
  box: NoteTextBox,
): NoteTextLayout {
  const lineSpacing = box.lineSpacing ?? 1.25;
  const layoutAt = (fontSize: number) => {
    const lines = wrapText(measure, text, fontSize, box.width);
    return { lines, fits: lines.length * fontSize * lineSpacing <= box.height };
  };

  let low = box.minFontSize;
  let high = box.maxFontSize;
  if (box.keepWords) {
    // Text width scales roughly with font size, so the widest word sets a
    // ceiling. Hinting makes the scaling inexact; step down until it fits.
    const words = text.split(/\s+/);
    const widest = (fontSize: number) =>
      Math.max(0, ...words.map((word) => measure(word, fontSize)));
    if (widest(high) > box.width)
      high = Math.max(low, Math.floor((high * box.width) / widest(high)));
    while (high > low && widest(high) > box.width) high -= 1;
  }
  if (layoutAt(high).fits) low = high;
  // Font sizes are whole pixels, so a binary search settles in a few passes.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (layoutAt(middle).fits) low = middle;
    else high = middle;
  }

  const fontSize = low;
  const lineHeight = fontSize * lineSpacing;
  const { lines, fits } = layoutAt(fontSize);
  if (fits) return { fontSize, lineHeight, lines, truncated: false };

  const visible = lines.slice(
    0,
    Math.max(1, Math.floor(box.height / lineHeight)),
  );
  let last = visible.pop()!;
  while (last && measure(`${last}…`, fontSize) > box.width)
    last = last.slice(0, -1);
  visible.push(`${last.trimEnd()}…`);
  return { fontSize, lineHeight, lines: visible, truncated: true };
}

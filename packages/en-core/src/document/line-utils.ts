// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

/**
 * Line ↔ byte offset translation and line-range editing for en-scribe.
 *
 * Lines are 1-indexed throughout. A trailing newline is treated as part of
 * the preceding line, not as a new empty line — "foo\n" has one line, not two.
 *
 * Inclusive ranges: readLineRange(content, 2, 4) returns lines 2, 3, and 4.
 *
 * Insertion via replaceLineRange: passing endLine = startLine - 1 replaces
 * a zero-length range at startLine, which is semantically "insert before
 * startLine". See text_insert_at_anchor for the calling convention.
 */

/**
 * Count the number of lines in content. A trailing newline does not
 * introduce a new line ("foo\n" → 1 line, "foo\nbar" → 2 lines, "" → 0).
 */
export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n' && i < content.length - 1) count++;
  }
  return count;
}

/**
 * 1-indexed line number for a byte offset. Offsets past EOF clamp to the
 * last line.
 */
export function offsetToLine(content: string, offset: number): number {
  let line = 1;
  const stop = Math.min(offset, content.length);
  for (let i = 0; i < stop; i++) {
    if (content[i] === '\n') line++;
  }
  // Clamp to actual line count: offsets past a final \n shouldn't return
  // line N+1 when the document only has N lines.
  const max = Math.max(1, countLines(content));
  return Math.min(line, max);
}

/**
 * Byte offset where a 1-indexed line begins. Lines past EOF return
 * content.length (i.e., "the position just past the last character"),
 * which is the correct insertion point for "append one line past the end".
 */
export function lineToOffset(content: string, line: number): number {
  if (line <= 1) return 0;
  let seen = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      seen++;
      if (seen === line) return i + 1;
    }
  }
  return content.length;
}

/**
 * Read a 1-indexed inclusive line range. Returns content spanning the
 * beginning of `startLine` up to and including the trailing newline of
 * `endLine` (or EOF if endLine is the last line).
 *
 * Throws on invalid ranges (startLine < 1, endLine < startLine, startLine
 * past EOF).
 */
export function readLineRange(content: string, startLine: number, endLine: number): string {
  validateRange(content, startLine, endLine);
  const start = lineToOffset(content, startLine);
  const end = endOfLineOffset(content, endLine);
  return content.slice(start, end);
}

/**
 * Replace a 1-indexed inclusive line range with `replacement`. To insert
 * before a line without deleting anything, pass endLine = startLine - 1
 * (a zero-length range whose position equals the start of startLine).
 *
 * Does not validate the replacement itself — callers that need to
 * guarantee trailing newlines should ensure replacement ends with "\n"
 * where the range ends mid-file.
 */
export function replaceLineRange(
  content: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  if (startLine < 1) {
    throw new RangeError(`startLine must be >= 1, got ${startLine}`);
  }
  // Insertion mode: endLine === startLine - 1
  if (endLine === startLine - 1) {
    const start = lineToOffset(content, startLine);
    return content.slice(0, start) + replacement + content.slice(start);
  }
  validateRange(content, startLine, endLine);
  const start = lineToOffset(content, startLine);
  const end = endOfLineOffset(content, endLine);
  return content.slice(0, start) + replacement + content.slice(end);
}

function validateRange(content: string, startLine: number, endLine: number): void {
  if (startLine < 1) {
    throw new RangeError(`startLine must be >= 1, got ${startLine}`);
  }
  if (endLine < startLine) {
    throw new RangeError(
      `endLine (${endLine}) must be >= startLine (${startLine}); ` +
      `use endLine = startLine - 1 for zero-length insertion`,
    );
  }
  const total = countLines(content);
  if (startLine > total) {
    throw new RangeError(`startLine ${startLine} exceeds document length (${total} lines)`);
  }
}

/** Offset immediately after the trailing newline of the given line, or EOF for the last line. */
function endOfLineOffset(content: string, line: number): number {
  const nextLineStart = lineToOffset(content, line + 1);
  // If lineToOffset returned content.length because we're at EOF already,
  // that's the correct end. Otherwise nextLineStart is the first byte of
  // line+1, which is also the byte just past line's trailing \n.
  return nextLineStart;
}

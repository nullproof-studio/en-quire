// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { countLines, lineToOffset, offsetToLine, readLineRange } from './line-utils.js';

export interface TextMatch {
  /** 1-indexed line where the match starts. */
  line: number;
  /** 1-indexed column (character offset within the line) where the match starts. */
  col: number;
  /** Byte offset of the match start within the whole content. */
  offset: number;
  /** The substring that actually matched (case may differ from query when case_sensitive is false). */
  matched_text: string;
  /** Up to `context_lines` lines preceding the match's line (trailing newline preserved). */
  context_before: string;
  /** Up to `context_lines` lines following the match's line (trailing newline preserved). */
  context_after: string;
}

export interface TextFindOptions {
  /** Default true. When false, `A` matches `a`. */
  case_sensitive?: boolean;
  /** Default false. When true, `log` does not match inside `Logger`. Word chars: [A-Za-z0-9_]. */
  whole_word?: boolean;
  /** Default 5. Number of surrounding lines to include in context_before/context_after. */
  context_lines?: number;
}

/**
 * Find all literal occurrences of `query` in `content`.
 *
 * Not a regex — query is treated as a literal substring. Overlapping matches
 * are not returned: after each hit, the scanner advances past the matched
 * range. Empty query returns an empty array (no-op) rather than matching
 * zero-length substrings everywhere.
 */
export function findText(
  content: string,
  query: string,
  options: TextFindOptions = {},
): TextMatch[] {
  if (query.length === 0) return [];

  const caseSensitive = options.case_sensitive ?? true;
  const wholeWord = options.whole_word ?? false;
  const contextLines = options.context_lines ?? 5;

  const haystack = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextMatch[] = [];

  let i = 0;
  while (i <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) break;

    if (wholeWord && !isWordBoundaryMatch(content, idx, needle.length)) {
      i = idx + 1;
      continue;
    }

    const line = offsetToLine(content, idx);
    const col = idx - lineStart(content, line) + 1;
    const matched = content.slice(idx, idx + needle.length);

    matches.push({
      line,
      col,
      offset: idx,
      matched_text: matched,
      context_before: getContextBefore(content, line, contextLines),
      context_after: getContextAfter(content, line, contextLines),
    });

    i = idx + needle.length;
  }

  return matches;
}

function lineStart(content: string, line: number): number {
  return lineToOffset(content, line);
}

function isWordBoundaryMatch(content: string, start: number, len: number): boolean {
  const before = start === 0 ? '' : content[start - 1];
  const after = start + len >= content.length ? '' : content[start + len];
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(c: string): boolean {
  if (c === '') return false;
  return /[A-Za-z0-9_]/.test(c);
}

function getContextBefore(content: string, line: number, contextLines: number): string {
  if (contextLines <= 0 || line <= 1) return '';
  const startLine = Math.max(1, line - contextLines);
  const endLine = line - 1;
  return readLineRange(content, startLine, endLine);
}

function getContextAfter(content: string, line: number, contextLines: number): string {
  if (contextLines <= 0) return '';
  const total = countLines(content);
  if (line >= total) return '';
  const startLine = line + 1;
  const endLine = Math.min(total, line + contextLines);
  return readLineRange(content, startLine, endLine);
}

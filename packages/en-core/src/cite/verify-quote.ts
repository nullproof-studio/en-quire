// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { findText } from '../document/text-find.js';
import { ValidationError } from '../shared/errors.js';
import { normaliseForFallback } from './normalise.js';

export interface MatchPosition {
  /** 0-based byte offset in the source text. */
  offset: number;
  /** 1-indexed line number. */
  line: number;
  /** 1-indexed column number. */
  col: number;
}

export type WarningCode =
  | 'numeric_truncation'
  | 'boundary_warning'
  | 'formatting_difference';

export type VerifyResult =
  | { status: 'verified'; match: MatchPosition }
  | { status: 'warning'; warning_code: WarningCode; match: MatchPosition }
  | { status: 'not_found'; reason: 'not_found' };

const DIGIT = /[0-9]/;
const WORD_CHAR = /[A-Za-z_]/;

/**
 * Verify that a quote appears verbatim in a source. Pure: input is two
 * strings, output is a small fixed-shape result. No fetched-content fields
 * cross the return boundary.
 *
 * Pipeline:
 *   1. Reject empty quote.
 *   2. Exact substring search.
 *   3. If found: numeric-truncation guard, then word-boundary guard.
 *   4. If not found: normalised-form fallback (NFKC + smart quotes / dashes /
 *      whitespace) — match → formatting_difference; no match → not_found.
 */
export function verifyQuote(sourceText: string, quote: string): VerifyResult {
  if (quote.length === 0) {
    throw new ValidationError('quote must be a non-empty string');
  }

  const matches = findText(sourceText, quote, { case_sensitive: true });
  if (matches.length > 0) {
    const m = matches[0];
    const match: MatchPosition = { offset: m.offset, line: m.line, col: m.col };

    if (isNumericTruncation(sourceText, quote, m.offset)) {
      return { status: 'warning', warning_code: 'numeric_truncation', match };
    }
    if (isWordBoundaryViolation(sourceText, quote, m.offset)) {
      return { status: 'warning', warning_code: 'boundary_warning', match };
    }
    return { status: 'verified', match };
  }

  const normalisedSource = normaliseForFallback(sourceText);
  const normalisedQuote = normaliseForFallback(quote);
  if (normalisedQuote.length > 0 && normalisedSource.includes(normalisedQuote)) {
    // Position is approximate — normalisation moves offsets. Report (0,1,1)
    // to keep the type uniform; precise position is unrecoverable here.
    return {
      status: 'warning',
      warning_code: 'formatting_difference',
      match: { offset: 0, line: 1, col: 1 },
    };
  }

  return { status: 'not_found', reason: 'not_found' };
}

function isNumericTruncation(source: string, quote: string, offset: number): boolean {
  const matchEnd = offset + quote.length;
  const lastQuoteChar = quote[quote.length - 1];
  const firstQuoteChar = quote[0];
  const sourceNextChar = matchEnd < source.length ? source[matchEnd] : '';
  const sourcePrevChar = offset > 0 ? source[offset - 1] : '';

  const trailing = DIGIT.test(lastQuoteChar) && sourceNextChar !== '' && DIGIT.test(sourceNextChar);
  const leading = DIGIT.test(firstQuoteChar) && sourcePrevChar !== '' && DIGIT.test(sourcePrevChar);
  return trailing || leading;
}

function isWordBoundaryViolation(source: string, quote: string, offset: number): boolean {
  const matchEnd = offset + quote.length;
  const lastQuoteChar = quote[quote.length - 1];
  const firstQuoteChar = quote[0];
  const sourceNextChar = matchEnd < source.length ? source[matchEnd] : '';
  const sourcePrevChar = offset > 0 ? source[offset - 1] : '';

  const trailing = WORD_CHAR.test(lastQuoteChar) && sourceNextChar !== '' && WORD_CHAR.test(sourceNextChar);
  const leading = WORD_CHAR.test(firstQuoteChar) && sourcePrevChar !== '' && WORD_CHAR.test(sourcePrevChar);
  return trailing || leading;
}

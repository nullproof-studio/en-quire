// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { ValidationError } from '../shared/errors.js';

const URL_DISALLOWED = /[\s\x00-\x1F\x7F\]]/;
const HEX = /^[0-9a-f]+$/;
const REFERENCE_LINE = /^\((\d+)\)\s+(\S+)\s+\[hash:sha256:([0-9a-f]+)\]$/;

export interface CitationReference {
  source_uri: string;
  citation_number: number;
  source_hash: string;
}

/**
 * Format an inline citation marker — what the agent pastes into prose. The
 * tool does not auto-write this; the agent places it where appropriate.
 */
export function formatInline(quote: string, citation_number: number): string {
  return `${quote} (${citation_number})`;
}

/**
 * Format the reference line that gets auto-appended to the Citations section.
 * Content-free by design: only the canonical URL the agent supplied, the
 * server-allocated number, and the server-computed hash. No fetched fields.
 *
 * Validates that the URL won't break the round-trip parser. The fetcher
 * already canonicalises and rejects malformed URLs upstream — this is the
 * belt-and-braces gate at the formatter boundary.
 */
export function formatReferenceLine(ref: CitationReference): string {
  const { source_uri, citation_number, source_hash } = ref;

  if (source_uri.length === 0) {
    throw new ValidationError('source_uri must not be empty');
  }
  if (URL_DISALLOWED.test(source_uri)) {
    throw new ValidationError(
      'source_uri contains characters disallowed in a citation reference (whitespace, control chars, or `]`)',
      { source_uri },
    );
  }
  if (!Number.isInteger(citation_number) || citation_number < 1) {
    throw new ValidationError('citation_number must be a positive integer');
  }
  if (!HEX.test(source_hash)) {
    throw new ValidationError('source_hash must be lowercase hex');
  }

  return `(${citation_number}) ${source_uri} [hash:sha256:${source_hash}]`;
}

/**
 * Parse a reference line back into its components, or return null if the line
 * doesn't match the strict canonical shape. Never throws — calling code uses
 * a null return to ignore unrecognised lines rather than crash.
 */
export function parseReferenceLine(line: string): CitationReference | null {
  const m = REFERENCE_LINE.exec(line);
  if (!m) return null;
  const citation_number = Number.parseInt(m[1], 10);
  if (!Number.isFinite(citation_number) || citation_number < 1) return null;
  return {
    citation_number,
    source_uri: m[2],
    source_hash: m[3],
  };
}

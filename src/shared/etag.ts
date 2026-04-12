// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createHash } from 'node:crypto';
import { PreconditionFailedError } from './errors.js';

/**
 * Compute an opaque ETag from file content.
 * Uses SHA-256 truncated to 16 hex chars — compact and collision-resistant.
 */
export function computeEtag(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Validate an if_match token against the current ETag.
 * Throws PreconditionFailedError on mismatch or missing token (when enabled).
 * No-op when requireReadBeforeWrite is false.
 */
export function validateEtag(
  ifMatch: string | undefined,
  currentEtag: string,
  file: string,
  requireReadBeforeWrite: boolean,
): void {
  if (!requireReadBeforeWrite) return;

  if (ifMatch === undefined) {
    throw new PreconditionFailedError(
      file,
      currentEtag,
      `Missing if_match — read the document first (doc_outline, doc_read_section, or doc_read) to obtain an ETag, then pass it as if_match.`,
    );
  }

  if (ifMatch !== currentEtag) {
    throw new PreconditionFailedError(
      file,
      currentEtag,
      `ETag mismatch — the document has been modified since your last read. Re-read with doc_outline or doc_read_section to get a current ETag, then retry.`,
    );
  }
}

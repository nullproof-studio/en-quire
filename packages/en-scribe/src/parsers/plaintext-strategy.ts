// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { OpsStrategy, ParserCapabilities } from '@nullproof-studio/en-core';

/**
 * Plain-text has no heading syntax, so every strategy method is a no-op.
 * PlaintextParser exposes this strategy purely to satisfy the DocumentParser
 * interface — en-scribe's tools (text_read, text_replace_range, etc.) operate
 * on line ranges, not sections, and never call into section-ops.
 *
 * Kept as explicit no-ops (rather than omitted) so that any code path that
 * mistakenly reaches section-ops via a plaintext parser fails loudly with a
 * type error at call sites, or silently passes through without mangling.
 */
export const plaintextStrategy: OpsStrategy = {
  renderHeading: (_level, text) => text,
  stripHeadingMarkers: (raw) => raw,
  hasChildHeadings: () => false,
  checkForBreakingHeadings: () => { /* no-op: no headings in plaintext */ },
  adjustHeadingLevels: (text) => text,
  stripLeadingDuplicateHeading: (content) => content,
};

export const plaintextCapabilities: ParserCapabilities = {
  generateToc: false,
};

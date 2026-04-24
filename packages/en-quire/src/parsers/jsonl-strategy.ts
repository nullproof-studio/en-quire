// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { OpsStrategy, ParserCapabilities } from '@nullproof-studio/en-core';

/**
 * JSONL ops strategy.
 *
 * JSONL has no heading syntax — each record is a JSON object on its own
 * line. The "heading" displayed in doc_outline is derived from the record's
 * content (see buildJsonlHeading in jsonl-parser); agents pass JSON as the
 * content of insert/replace operations and the strategy simply returns the
 * content as-is so section-ops splices it verbatim into place.
 *
 * None of the markdown-specific hooks (adjustHeadingLevels, breaking heading
 * checks, duplicate-heading stripping, TOC generation) apply to a flat
 * record list; they're explicit no-ops rather than silent ones so reviewers
 * can see the divergence intentionally.
 */
export const jsonlStrategy: OpsStrategy = {
  // The `text` arg to renderHeading is the user-supplied heading parameter,
  // which JSONL ignores — records have no standalone heading line. The
  // caller is expected to pass the full JSON record via `content`; the
  // level is unused.
  renderHeading: (_level, _text) => '',

  stripHeadingMarkers: (raw) => raw,
  hasChildHeadings: () => false,
  checkForBreakingHeadings: () => { /* no-op: no headings to break */ },
  adjustHeadingLevels: (text) => text,
  stripLeadingDuplicateHeading: (content) => content,
};

export const jsonlCapabilities: ParserCapabilities = {
  generateToc: false,
};

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { OpsStrategy, ParserCapabilities } from '@nullproof-studio/en-core';

/**
 * YAML ops strategy.
 *
 * yaml has no markdown heading syntax; keys ARE the "headings". Most of the
 * strategy methods are no-ops because md-specific regex scanning doesn't apply.
 * generateToc is omitted — handlers check parser.capabilities.generateToc first
 * and reject yaml with a clear error before reaching this code.
 */
export const yamlStrategy: OpsStrategy = {
  renderHeading(_level, text) {
    return text;
  },

  stripHeadingMarkers(raw) {
    return raw;
  },

  hasChildHeadings() {
    return false;
  },

  checkForBreakingHeadings() {
    // yaml: no markdown heading syntax to break on
  },

  adjustHeadingLevels(text) {
    return text;
  },

  stripLeadingDuplicateHeading(content) {
    return content;
  },
};

export const yamlCapabilities: ParserCapabilities = {
  generateToc: false,
};

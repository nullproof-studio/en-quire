// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { SectionNode } from '../shared/types.js';

/**
 * Format-specific rendering and heading-detection logic used by section-ops.
 *
 * Each parser exposes an OpsStrategy so that section-ops (format-agnostic offset
 * manipulation) can delegate the handful of places where markdown heading syntax
 * (#, ##) leaks in. yaml's strategy is mostly no-op since keys don't use hash
 * markers and content rarely contains md-style headings.
 */
export interface OpsStrategy {
  /** Render a heading line for insertion (e.g. md: "## Text"; yaml: "Text"). */
  renderHeading(level: number, text: string): string;

  /** Strip any heading markers the agent may have included in a heading string. */
  stripHeadingMarkers(raw: string): string;

  /** True if content contains headings deeper than parentLevel. */
  hasChildHeadings(content: string, parentLevel: number): boolean;

  /**
   * Throw if content contains headings at or above sectionLevel.
   * Used by appendToSection to prevent accidental section breaks.
   */
  checkForBreakingHeadings(content: string, sectionLevel: number): void;

  /** Shift all heading levels in text by delta. Used by moveSection. */
  adjustHeadingLevels(text: string, delta: number): string;

  /**
   * Strip a leading duplicate heading from content (when the agent includes
   * the heading in replacement content even though the heading is preserved).
   */
  stripLeadingDuplicateHeading(content: string, headingText: string): string;

  /** Generate a table of contents from the section tree. Optional — not all formats support it. */
  generateToc?(tree: SectionNode[], maxDepth: number, style: 'links' | 'plain'): string;
}

export interface ParserCapabilities {
  readonly generateToc: boolean;
}

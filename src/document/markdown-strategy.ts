// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { SectionNode } from '../shared/types.js';
import type { OpsStrategy, ParserCapabilities } from './ops-strategy.js';
import { ValidationError } from '../shared/errors.js';

/**
 * Markdown-specific rendering and heading logic.
 * Extracted from section-ops.ts so that section-ops stays format-agnostic.
 */
export const markdownStrategy: OpsStrategy = {
  renderHeading(level, text) {
    return '#'.repeat(level) + ' ' + text;
  },

  stripHeadingMarkers(heading) {
    return heading.replace(/^#+\s*/, '');
  },

  hasChildHeadings(content, parentLevel) {
    let inCodeBlock = false;
    for (const line of content.split('\n')) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const match = trimmed.match(/^(#{1,6})\s/);
      if (match && match[1].length > parentLevel) {
        return true;
      }
    }
    return false;
  },

  checkForBreakingHeadings(content, sectionLevel) {
    let inCodeBlock = false;
    for (const line of content.split('\n')) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const match = trimmed.match(/^(#{1,6})\s/);
      if (match) {
        const headingLevel = match[1].length;
        if (headingLevel <= sectionLevel) {
          throw new ValidationError(
            `Cannot append content containing a level-${headingLevel} heading to a level-${sectionLevel} section. ` +
            `Use doc_insert_section to add sibling or higher-level sections.`,
          );
        }
      }
    }
  },

  adjustHeadingLevels(text, delta) {
    let inCodeBlock = false;
    const lines = text.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        result.push(line);
        continue;
      }
      if (inCodeBlock) {
        result.push(line);
        continue;
      }

      const match = trimmed.match(/^(#{1,6})\s/);
      if (match) {
        const oldLevel = match[1].length;
        const newLevel = oldLevel + delta;
        if (newLevel < 1 || newLevel > 6) {
          throw new ValidationError(
            `Cannot adjust heading level from h${oldLevel} by ${delta > 0 ? '+' : ''}${delta}: ` +
            `h${newLevel} is outside the valid range (h1–h6).`,
          );
        }
        result.push('#'.repeat(newLevel) + line.slice(line.indexOf(match[1]) + match[1].length));
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  },

  stripLeadingDuplicateHeading(content, headingText) {
    const trimmed = content.replace(/^\n*/, '');
    const match = trimmed.match(/^#{1,6}\s+(.+?)(?:\s+#+\s*)?$/m);
    if (!match) return content;
    const contentHeadingText = match[1].trim();
    if (contentHeadingText === headingText) {
      const headingEnd = trimmed.indexOf('\n', match.index!);
      if (headingEnd === -1) return '';
      return trimmed.slice(headingEnd).replace(/^\n*/, '');
    }
    return content;
  },

  generateToc(tree, maxDepth, style) {
    const lines: string[] = [];

    function walk(nodes: SectionNode[], depth: number) {
      for (const node of nodes) {
        if (depth >= maxDepth) continue;

        const indent = '  '.repeat(depth);
        const text = node.heading.text;

        if (style === 'links') {
          const anchor = text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-');
          lines.push(`${indent}- [${text}](#${anchor})`);
        } else {
          lines.push(`${indent}- ${text}`);
        }

        walk(node.children, depth + 1);
      }
    }

    // Skip the root h1 and start with its children
    for (const root of tree) {
      if (root.heading.level === 1) {
        walk(root.children, 0);
      } else {
        walk([root], 0);
      }
    }

    return lines.join('\n');
  },
};

export const markdownCapabilities: ParserCapabilities = {
  generateToc: true,
};

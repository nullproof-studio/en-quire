// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { SectionNode } from '@nullproof-studio/en-core';
import type { OpsStrategy, ParserCapabilities } from '@nullproof-studio/en-core';
import { ValidationError, extractAnchor, slugify, uniqueSlug } from '@nullproof-studio/en-core';

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

  deriveAnchorId(headingText, taken) {
    return uniqueSlug(slugify(headingText), taken);
  },

  formatAnchor(id) {
    return ` ^${id}`;
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
            `Cannot place a level-${headingLevel} heading inside a level-${sectionLevel} section — ` +
            `it terminates the section and breaks out as a sibling. ` +
            `Content may only contain deeper (child) headings; ` +
            `use doc_insert_section to add a sibling or higher-level section.`,
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
    // Same matching as stripDuplicateHeading (code-fence aware, `^id`
    // ignored, preamble kept); the target keeps its own heading and anchor.
    return markdownStrategy.stripDuplicateHeading!(content, headingText)?.content ?? content;
  },

  stripDuplicateHeading(content, headingText) {
    const lines = content.split('\n');
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const match = trimmed.match(/^#{1,6}\s+(.*?)(?:\s+#+)?\s*$/);
      if (!match) continue;
      // Only the first real heading is a candidate — a later match is a
      // genuine child/sibling the agent meant to write.
      const { text, anchorId } = extractAnchor(match[1]);
      if (text.trim() !== headingText) return null;

      const preamble = lines.slice(0, i).join('\n').trim();
      const rest = lines.slice(i + 1).join('\n').replace(/^\n*/, '');
      const stripped = preamble && rest ? `${preamble}\n\n${rest}` : preamble || rest;
      return { content: stripped, ...(anchorId && { anchorId }) };
    }
    return null;
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
  fullTextIndex: true,
};

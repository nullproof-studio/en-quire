// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { DocumentParser } from './parser-registry.js';
import type { SectionNode, SectionAddress } from '../shared/types.js';
import { parseMarkdown } from './parser.js';
import { buildSectionTree, buildPreambleNode } from './section-tree.js';
import { parseAddress } from './section-address.js';
import { parserRegistry } from './parser-registry.js';

class MarkdownParser implements DocumentParser {
  readonly extensions = ['.md', '.mdx'];

  parse(content: string): SectionNode[] {
    const ast = parseMarkdown(content);
    const tree = buildSectionTree(ast, content);

    // Inject preamble pseudo-section for content before first heading
    const firstHeadingOffset = tree.length > 0
      ? tree[0].headingStartOffset
      : null;

    const preamble = buildPreambleNode(content, firstHeadingOffset);
    if (preamble) {
      // Shift sibling indices of existing roots
      for (const node of tree) {
        node.index += 1;
      }
      tree.unshift(preamble);
    }

    return tree;
  }

  parseAddress(raw: string): SectionAddress {
    return parseAddress(raw);
  }

  validate(content: string): string[] {
    if (content.trim().length === 0) return [];
    try {
      const tree = this.parse(content);
      return findDuplicateSiblings(tree);
    } catch (err) {
      return [`Markdown parse error: ${err instanceof Error ? err.message : String(err)}`];
    }
  }
}

/**
 * Walk the section tree and find duplicate sibling headings
 * (same heading text under the same parent).
 */
function findDuplicateSiblings(nodes: SectionNode[], parentPath?: string): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    // Skip preamble — it's synthetic and always unique
    if (node.heading.text === '__preamble') continue;

    const key = node.heading.text;
    if (seen.has(key)) {
      const context = parentPath ? ` under "${parentPath}"` : ' at top level';
      warnings.push(`Duplicate sibling heading "${key}"${context} — this will cause ambiguous section addressing.`);
    } else {
      seen.add(key);
    }

    // Recurse into children
    if (node.children.length > 0) {
      warnings.push(...findDuplicateSiblings(node.children, node.heading.text));
    }
  }

  return warnings;
}

parserRegistry.register(new MarkdownParser());

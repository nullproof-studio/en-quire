// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Root } from 'mdast';
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
      const ast = parseMarkdown(content);
      const setextWarnings = findSetextHeadings(ast, content);
      const tree = buildSectionTree(ast, content);
      const preamble = buildPreambleNode(content, tree.length > 0 ? tree[0].headingStartOffset : null);
      if (preamble) {
        for (const node of tree) { node.index += 1; }
        tree.unshift(preamble);
      }
      return [...setextWarnings, ...findDuplicateSiblings(tree), ...findUnbalancedFences(content)];
    } catch (err) {
      return [`Markdown parse error: ${err instanceof Error ? err.message : String(err)}`];
    }
  }
}

/**
 * Detect setext-style headings (text followed by --- or ===).
 * Agents almost always intend --- as a horizontal rule, not a heading underline.
 * Returns actionable warnings so agents can diagnose the issue.
 */
function findSetextHeadings(ast: Root, content: string): string[] {
  const warnings: string[] = [];
  const lines = content.split('\n');

  for (const child of ast.children) {
    if (child.type !== 'heading' || !child.position) continue;
    const { start, end } = child.position;
    // Setext headings span 2+ lines; ATX headings span exactly 1
    if (start.line === end.line) continue;

    const underlineLine = lines[end.line - 1];
    const marker = underlineLine?.trim();
    if (!marker) continue;

    const isSetext = /^-{3,}$/.test(marker) || /^={3,}$/.test(marker);
    if (!isSetext) continue;

    const headingText = lines[start.line - 1]?.trim() ?? '';
    const separator = marker[0] === '=' ? '===' : '---';
    warnings.push(
      `Line ${end.line}: '${separator}' after text creates a heading ("${headingText}") — not a horizontal rule. ` +
      `Add a blank line before '${separator}' if you intended a separator.`,
    );
  }

  return warnings;
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

/**
 * Detect unbalanced code fences (``` or ~~~).
 *
 * An odd count means a fence was opened but never closed (or vice versa).
 * This is the signature of nested code fences, which CommonMark does not
 * support — remark will misidentify section boundaries, causing phantom
 * headings and hidden sections.
 *
 * Returns a blocking error (contains "syntax error") so executeWrite
 * rejects the write.
 */
function findUnbalancedFences(content: string): string[] {
  const lines = content.split('\n');
  let inFence = false;
  let fenceMarker = '';  // ``` or ~~~
  let fenceLength = 0;   // number of backticks/tildes
  let openLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();

    // Check for fence markers (``` or ~~~, optionally with info string)
    const backtickMatch = trimmed.match(/^(`{3,})(.*)/);
    const tildeMatch = trimmed.match(/^(~{3,})(.*)/);
    const match = backtickMatch || tildeMatch;

    if (!match) continue;

    const marker = match[1][0]; // ` or ~
    const markerLen = match[1].length;
    const trailing = match[2].trim();

    if (!inFence) {
      // Opening fence — info string allowed
      inFence = true;
      fenceMarker = marker;
      fenceLength = markerLen;
      openLine = i + 1;
    } else if (marker === fenceMarker && markerLen >= fenceLength && trailing === '') {
      // Closing fence — must match marker type, be at least as long, no trailing text
      inFence = false;
    }
    // Otherwise: a fence marker inside a code block — just literal text
  }

  if (inFence) {
    return [
      `Unbalanced code fence — syntax error: fence opened at line ${openLine} is never closed. ` +
      `This typically means the document contains nested code fences (e.g. \`\`\`markdown containing \`\`\`json), ` +
      `which CommonMark does not support. Extract nested template examples to separate files.`,
    ];
  }

  return [];
}

parserRegistry.register(new MarkdownParser());

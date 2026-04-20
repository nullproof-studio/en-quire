// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Root, Heading } from 'mdast';
import type { DocumentParser } from './parser-registry.js';
import type { SectionNode, SectionAddress } from '../shared/types.js';
import { parseMarkdown } from './parser.js';
import { buildPreambleNode, fixSectionEndOffsets } from './section-tree.js';
import { toString } from './ast-utils.js';
import { parserRegistry } from './parser-registry.js';
import { markdownStrategy, markdownCapabilities } from './markdown-strategy.js';

/**
 * Build a section tree from an mdast AST.
 * Sections are delimited by headings: a heading owns all content
 * up to the next heading of equal or higher level.
 *
 * The tree reflects heading hierarchy: an h2 is a child of the preceding h1,
 * an h3 is a child of the preceding h2, etc.
 */
export function buildSectionTree(ast: Root, markdown: string): SectionNode[] {
  const headings = extractHeadings(ast);

  if (headings.length === 0) {
    return [];
  }

  const roots: SectionNode[] = [];
  const stack: SectionNode[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];

    const headingStartOffset = heading.position!.start.offset!;
    const bodyStartOffset = heading.position!.end.offset!;

    const sectionEndOffset = nextHeading
      ? nextHeading.position!.start.offset!
      : markdown.length;

    const bodyEndOffset = findBodyEnd(headings, i, sectionEndOffset);

    const node: SectionNode = {
      heading: {
        text: toString(heading),
        level: heading.depth,
        position: heading.position!,
      },
      headingStartOffset: headingStartOffset,
      bodyStartOffset,
      bodyEndOffset,
      sectionEndOffset,
      children: [],
      parent: null,
      index: 0,
      depth: 0,
    };

    while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.depth) {
      stack.pop();
    }

    if (stack.length > 0) {
      const parent = stack[stack.length - 1];
      node.parent = parent;
      node.index = parent.children.length;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      node.index = roots.length;
      roots.push(node);
    }

    stack.push(node);
  }

  fixSectionEndOffsets(roots, markdown.length);

  return roots;
}

function extractHeadings(ast: Root): Heading[] {
  const headings: Heading[] = [];
  for (const child of ast.children) {
    if (child.type === 'heading' && child.position) {
      headings.push(child);
    }
  }
  return headings;
}

function findBodyEnd(headings: Heading[], currentIndex: number, sectionEnd: number): number {
  const current = headings[currentIndex];
  for (let i = currentIndex + 1; i < headings.length; i++) {
    const next = headings[i];
    if (next.depth <= current.depth) {
      break;
    }
    return next.position!.start.offset!;
  }
  return sectionEnd;
}

/**
 * Strip leading markdown heading markers (e.g. "## Foo" → "Foo").
 * Agents frequently include these when addressing sections; since the
 * level is structural, the markers are always redundant in addresses.
 */
function stripAddressMarkers(text: string): string {
  return text.replace(/^#+\s+/, '');
}

/**
 * Parse a raw address string into a typed SectionAddress.
 *
 * Rules:
 * - If it's a JSON array of numbers → IndexAddress
 * - If it contains " > " → PathAddress
 * - If it contains glob characters (*, ?) → PatternAddress
 * - Otherwise → TextAddress
 *
 * Leading heading markers (e.g. "## ") are silently stripped from text
 * and path segments so that agents don't get stuck in retry loops.
 */
export function parseAddress(raw: string): SectionAddress {
  const trimmed = raw.trim();

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
        return { type: 'index', indices: parsed };
      }
    } catch {
      // Not valid JSON, fall through
    }
  }

  if (trimmed.includes(' > ')) {
    return {
      type: 'path',
      segments: trimmed.split(' > ').map((s) => stripAddressMarkers(s.trim())),
    };
  }

  if (/[*?]/.test(trimmed)) {
    return { type: 'pattern', pattern: trimmed };
  }

  return { type: 'text', text: stripAddressMarkers(trimmed) };
}

class MarkdownParser implements DocumentParser {
  readonly extensions = ['.md', '.mdx'];
  readonly ops = markdownStrategy;
  readonly capabilities = markdownCapabilities;

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

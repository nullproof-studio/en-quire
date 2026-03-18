// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type {
  SectionNode,
  SectionAddress,
  OutlineEntry,
  FindReplaceMatch,
  FindReplaceOptions,
} from '../shared/types.js';
import { parseMarkdown } from './parser.js';
import { buildSectionTree, getSectionPath, getBreadcrumb, flattenTree } from './section-tree.js';
import { resolveSingleSection, resolveAddress } from './section-address.js';
import { countCodePoints, offsetToLine } from './ast-utils.js';

/**
 * Read a section's content from the markdown string.
 */
export function readSection(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
  includeChildren = true,
): {
  content: string;
  heading: string;
  path: string;
  line_start: number;
  line_end: number;
  prev_sibling?: string;
  next_sibling?: string;
} {
  const node = resolveSingleSection(tree, address);

  const start = node.headingStartOffset;
  const end = includeChildren ? node.sectionEndOffset : node.bodyEndOffset;
  const content = markdown.slice(start, end);

  // Find siblings
  const siblings = node.parent ? node.parent.children : tree;
  const prevSibling = node.index > 0 ? siblings[node.index - 1] : undefined;
  const nextSibling = node.index < siblings.length - 1 ? siblings[node.index + 1] : undefined;

  return {
    content,
    heading: node.heading.text,
    path: getSectionPath(node),
    line_start: offsetToLine(markdown, start),
    line_end: offsetToLine(markdown, end),
    prev_sibling: prevSibling?.heading.text,
    next_sibling: nextSibling?.heading.text,
  };
}

/**
 * Replace a section's body content (and optionally heading).
 * Returns the new markdown string.
 */
export function replaceSection(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
  newContent: string,
  replaceHeading = false,
): string {
  const node = resolveSingleSection(tree, address);

  if (replaceHeading) {
    // Replace from heading start to section end (excluding children)
    const before = markdown.slice(0, node.headingStartOffset);
    const after = markdown.slice(node.bodyEndOffset);
    return before + newContent + after;
  }

  // Replace body only, preserve heading
  const before = markdown.slice(0, node.bodyStartOffset);
  const after = markdown.slice(node.bodyEndOffset);

  // Ensure newContent starts with a newline for proper separation from heading
  const separator = newContent.startsWith('\n') ? '' : '\n';
  return before + separator + newContent + after;
}

/**
 * Insert a new section relative to an anchor section.
 * Returns the new markdown string.
 */
export function insertSection(
  markdown: string,
  tree: SectionNode[],
  anchor: SectionAddress,
  position: 'before' | 'after' | 'child_start' | 'child_end',
  heading: string,
  content: string,
  level?: number,
): string {
  const anchorNode = resolveSingleSection(tree, anchor);

  // Determine heading level
  const headingLevel = level ?? (
    position === 'child_start' || position === 'child_end'
      ? anchorNode.heading.level + 1
      : anchorNode.heading.level
  );

  const headingPrefix = '#'.repeat(headingLevel);
  const newSection = `\n${headingPrefix} ${heading}\n\n${content}\n`;

  let insertOffset: number;

  switch (position) {
    case 'before':
      insertOffset = anchorNode.headingStartOffset;
      break;
    case 'after':
      insertOffset = anchorNode.sectionEndOffset;
      break;
    case 'child_start':
      insertOffset = anchorNode.bodyStartOffset;
      // Add a newline after the heading if body is empty
      break;
    case 'child_end':
      insertOffset = anchorNode.sectionEndOffset;
      break;
  }

  const before = markdown.slice(0, insertOffset);
  const after = markdown.slice(insertOffset);

  return before + newSection + after;
}

/**
 * Append content to the end of a section's body (before its children).
 * Returns the new markdown string.
 */
export function appendToSection(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
  content: string,
): string {
  const node = resolveSingleSection(tree, address);

  const insertOffset = node.bodyEndOffset;
  const before = markdown.slice(0, insertOffset);
  const after = markdown.slice(insertOffset);

  // Ensure proper spacing
  const separator = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';

  return before + separator + content + '\n' + after;
}

/**
 * Delete a section (heading + body + children).
 * Returns the new markdown string.
 */
export function deleteSection(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
): string {
  const node = resolveSingleSection(tree, address);

  const before = markdown.slice(0, node.headingStartOffset);
  const after = markdown.slice(node.sectionEndOffset);

  return before + after;
}

/**
 * Build an outline from the section tree.
 */
export function buildOutline(
  markdown: string,
  tree: SectionNode[],
  rootSection?: SectionAddress,
  maxDepth?: number,
): OutlineEntry[] {
  let roots = tree;
  let baseDepth = 0;

  if (rootSection) {
    const root = resolveSingleSection(tree, rootSection);
    roots = [root];
    baseDepth = root.depth;
  }

  const entries: OutlineEntry[] = [];

  function walk(nodes: SectionNode[], depth: number) {
    for (const node of nodes) {
      if (maxDepth !== undefined && depth - baseDepth >= maxDepth) continue;

      const bodyContent = markdown.slice(node.headingStartOffset, node.sectionEndOffset);

      entries.push({
        level: node.heading.level,
        text: node.heading.text,
        path: getSectionPath(node),
        line_start: node.heading.position.start.line,
        line_end: offsetToLine(markdown, node.sectionEndOffset),
        char_count: countCodePoints(bodyContent),
        has_children: node.children.length > 0,
      });

      walk(node.children, depth + 1);
    }
  }

  walk(roots, baseDepth);
  return entries;
}

/**
 * Find-and-replace across a document.
 * In preview mode, returns matches. In apply mode, performs replacements.
 */
export function findReplace(
  markdown: string,
  tree: SectionNode[],
  find: string,
  replace: string,
  options: FindReplaceOptions = {},
): { matches: FindReplaceMatch[]; result?: string; replacementCount?: number; skippedCount?: number } {
  const { regex = false, flags = 'g', preview = false, apply_matches, expected_count } = options;

  // Validate regex flags — only allow known safe flags
  const VALID_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y']);
  for (const ch of flags) {
    if (!VALID_FLAGS.has(ch)) {
      throw new Error(`Invalid regex flag "${ch}". Allowed flags: g, i, m, s, u, y`);
    }
  }

  // Build the search pattern
  const pattern = regex
    ? new RegExp(find, flags)
    : new RegExp(escapeRegex(find), flags);

  // Find all matches
  const matches: FindReplaceMatch[] = [];
  const flat = flattenTree(tree);
  let match: RegExpExecArray | null;
  let id = 0;

  // Use a copy of the pattern with global flag for iteration
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');

  const startTime = Date.now();
  const TIMEOUT_MS = 1000;

  while ((match = globalPattern.exec(markdown)) !== null) {
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw new Error('Regex execution timeout: pattern may cause catastrophic backtracking.');
    }

    const offset = match.index;
    const line = offsetToLine(markdown, offset);

    // Find the most specific (deepest) section this match is in
    let sectionPath = '';
    let inCodeBlock = false;

    for (const node of flat) {
      if (offset >= node.headingStartOffset && offset < node.sectionEndOffset) {
        sectionPath = getSectionPath(node);
        // Don't break — keep searching for a deeper (more specific) match
      }
    }

    // Check if in a code block (simple heuristic: between ``` markers)
    const beforeMatch = markdown.slice(0, offset);
    const backtickCount = (beforeMatch.match(/^```/gm) || []).length;
    inCodeBlock = backtickCount % 2 === 1;

    // Build context (~10 words either side)
    const contextStart = Math.max(0, markdown.lastIndexOf(' ', Math.max(0, offset - 60)));
    const contextEnd = Math.min(markdown.length, markdown.indexOf(' ', Math.min(markdown.length, offset + match[0].length + 60)));
    const context = markdown.slice(contextStart, contextEnd === -1 ? undefined : contextEnd).trim();

    matches.push({
      id: id++,
      line,
      section_path: sectionPath,
      context,
      in_code_block: inCodeBlock,
    });

    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) {
      globalPattern.lastIndex++;
    }
  }

  if (preview) {
    return { matches };
  }

  // Safety check
  if (expected_count !== undefined && apply_matches === undefined && matches.length !== expected_count) {
    throw new Error(
      `Expected ${expected_count} matches but found ${matches.length}. Use preview mode to inspect matches.`,
    );
  }

  // Apply replacements
  const matchSet = apply_matches ? new Set(apply_matches) : null;
  let result = '';
  let lastEnd = 0;
  let replacementCount = 0;
  let skippedCount = 0;

  // Re-run the pattern to get exact positions
  const applyPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  let applyId = 0;

  while ((match = applyPattern.exec(markdown)) !== null) {
    if (matchSet && !matchSet.has(applyId)) {
      skippedCount++;
      applyId++;
      if (match[0].length === 0) applyPattern.lastIndex++;
      continue;
    }

    result += markdown.slice(lastEnd, match.index);
    result += regex ? match[0].replace(new RegExp(find, flags.replace('g', '')), replace) : replace;
    lastEnd = match.index + match[0].length;
    replacementCount++;
    applyId++;

    if (match[0].length === 0) applyPattern.lastIndex++;
  }

  result += markdown.slice(lastEnd);

  return { matches, result, replacementCount, skippedCount };
}

/**
 * Generate a Table of Contents from the section tree.
 */
export function generateToc(
  tree: SectionNode[],
  maxDepth = 3,
  style: 'links' | 'plain' = 'links',
): string {
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
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

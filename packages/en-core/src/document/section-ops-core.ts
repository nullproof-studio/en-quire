// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type {
  SectionNode,
  SectionAddress,
  OutlineEntry,
  FindReplaceMatch,
  FindReplaceOptions,
} from '../shared/types.js';
import { getSectionPath, getBreadcrumb, flattenTree } from './section-tree.js';
import { resolveSingleSection, resolveAddress } from './section-address.js';
import { countCodePoints, offsetToLine } from './ast-utils.js';
import { countWords } from '../shared/word-count.js';
import { ValidationError } from '../shared/errors.js';
import type { OpsStrategy } from './ops-strategy.js';

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
 * Replace a section's body content (and optionally heading text).
 * Returns the new markdown string.
 *
 * When `replaceHeading` is a string, the heading text is replaced while
 * preserving the correct heading level and markdown structure.
 * When `replaceHeading` is `true`, the newContent must include the full
 * heading line (e.g. "## New Heading\n\nBody"); the existing heading is
 * replaced from headingStart to bodyEnd.
 * When `replaceHeading` is `false` (default), only the body is replaced.
 */
export function replaceSection(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
  newContent: string,
  replaceHeading: boolean | string = false,
  ops: OpsStrategy,
): string {
  const node = resolveSingleSection(tree, address);

  if (typeof replaceHeading === 'string') {
    // Replace heading text only, then replace body
    const cleanHeading = ops.stripHeadingMarkers(replaceHeading);
    const newHeadingLine = ops.renderHeading(node.heading.level, cleanHeading);
    const before = markdown.slice(0, node.headingStartOffset);
    const after = markdown.slice(node.bodyEndOffset);
    const normalized = newContent.replace(/^\n*/, '');
    return before + newHeadingLine + '\n\n' + ensureTrailingNewlines(normalized) + after;
  }

  if (replaceHeading === true) {
    // Replace from heading start to body end — newContent must include heading line.
    // Guard: if newContent doesn't start with a heading marker, preserve the
    // existing heading to prevent accidental heading deletion.
    const before = markdown.slice(0, node.headingStartOffset);
    const after = markdown.slice(node.bodyEndOffset);
    if (!newContent.trimStart().startsWith('#')) {
      // Content doesn't include a heading — preserve the original heading
      const headingLine = markdown.slice(node.headingStartOffset, node.bodyStartOffset);
      const normalized = newContent.replace(/^\n*/, '');
      return before + headingLine + '\n\n' + ensureTrailingNewlines(normalized) + after;
    }
    return before + ensureTrailingNewlines(newContent) + after;
  }

  // Replace body only, preserve heading
  // Auto-strip a leading heading from content if it matches the target section.
  // Agents frequently include "### Heading\n\n" at the start of replacement content,
  // which would create a duplicate heading since replaceSection preserves the original.
  const strippedContent = ops.stripLeadingDuplicateHeading(newContent, node.heading.text);

  // If replacement content contains child-level headings, replace the entire section
  // body including children (sectionEndOffset) to avoid duplicating existing children.
  // Otherwise replace only the body text (bodyEndOffset), preserving children.
  const contentHasChildHeadings = ops.hasChildHeadings(strippedContent, node.heading.level);
  const endOffset = contentHasChildHeadings ? node.sectionEndOffset : node.bodyEndOffset;

  const before = markdown.slice(0, node.bodyStartOffset);
  const after = markdown.slice(endOffset);

  // For sections without a heading line (e.g. __preamble, YAML keys),
  // don't add a blank line separator — just replace the body directly.
  if (node.headingStartOffset === node.bodyStartOffset) {
    return before + ensureTrailingNewlines(strippedContent) + after;
  }

  // YAML keys: `before` ends with \n (bodyStartOffset is at a line start).
  // No blank line separator needed — strip leading newlines and splice directly.
  if (before.endsWith('\n')) {
    const stripped = strippedContent.replace(/^\n*/, '');
    return before + ensureTrailingNewlines(stripped) + after;
  }

  const normalized = strippedContent.replace(/^\n*/, '');
  return before + '\n\n' + ensureTrailingNewlines(normalized) + after;
}

/**
 * Ensure content ends with a double newline so the next section's
 * heading isn't concatenated to the replaced content.
 */
function ensureTrailingNewlines(content: string): string {
  if (content.endsWith('\n\n')) return content;
  if (content.endsWith('\n')) return content + '\n';
  return content + '\n\n';
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
  ops: OpsStrategy,
  level?: number,
): string {
  const anchorNode = resolveSingleSection(tree, anchor);
  const cleanHeading = ops.stripHeadingMarkers(heading);

  // Check for duplicate sibling
  const siblings = (position === 'child_start' || position === 'child_end')
    ? anchorNode.children
    : (anchorNode.parent ? anchorNode.parent.children : tree);

  if (siblings.some((s) => s.heading.text === cleanHeading)) {
    const parentName = (position === 'child_start' || position === 'child_end')
      ? anchorNode.heading.text
      : (anchorNode.parent?.heading.text ?? 'top level');
    throw new ValidationError(
      `Section "${cleanHeading}" already exists under "${parentName}". Use doc_replace_section to update it.`,
    );
  }

  // Determine heading level
  const headingLevel = level ?? (
    position === 'child_start' || position === 'child_end'
      ? anchorNode.heading.level + 1
      : anchorNode.heading.level
  );

  const newSection = `\n${ops.renderHeading(headingLevel, cleanHeading)}\n\n${content}\n`;

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
  ops: OpsStrategy,
): string {
  const node = resolveSingleSection(tree, address);

  // Guard: reject content containing headings at the same or higher level.
  // Format-specific detection is delegated to the strategy (no-op for yaml).
  if (node.heading.level > 0) {
    ops.checkForBreakingHeadings(content, node.heading.level);
  }

  const insertOffset = node.bodyEndOffset;
  const before = markdown.slice(0, insertOffset);
  const after = markdown.slice(insertOffset);

  // Ensure proper spacing.
  // For YAML (no blank line between heading and body), keep content contiguous.
  const headingToBody = markdown.slice(node.headingStartOffset, node.bodyStartOffset);
  const isContiguous = node.headingStartOffset !== node.bodyStartOffset && !headingToBody.includes('\n\n');

  let separator: string;
  if (isContiguous) {
    // YAML-style: no blank lines, just ensure we're on a new line
    separator = before.endsWith('\n') ? '' : '\n';
  } else {
    // Markdown-style: blank line separation
    separator = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  }

  return before + separator + content + (content.endsWith('\n') ? '' : '\n') + after;
}

/**
 * Set a scalar value at the addressed section.
 *
 * For YAML: splices the value directly at the scalar's byte offsets.
 *   Throws if the target is a container node (map/sequence) — use
 *   replaceSection for wholesale subtree replacement.
 * For markdown: delegates to replaceSection (body-only replacement).
 */
export function setValue(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
  value: string,
  ops: OpsStrategy,
): string {
  const node = resolveSingleSection(tree, address);

  // If the node has children, it's a container — reject for YAML clarity
  if (node.children.length > 0) {
    throw new ValidationError(
      `Cannot set a scalar value on "${node.heading.text}" because it is a container (has child keys). Use doc_replace_section to replace the entire subtree.`,
    );
  }

  // Detect YAML-style scalar: bodyStartOffset is mid-line (after "key: ")
  // vs markdown where bodyStartOffset is at the end of the heading node.
  const beforeBody = markdown.slice(node.headingStartOffset, node.bodyStartOffset);
  const isYamlScalar = beforeBody.includes(':') && !beforeBody.trimStart().startsWith('#');

  if (isYamlScalar) {
    // Direct scalar splice — replace from bodyStart to bodyEnd
    const before = markdown.slice(0, node.bodyStartOffset);
    const after = markdown.slice(node.bodyEndOffset);

    // Preserve the original quote style (", ', or none)
    const originalValue = markdown.slice(node.bodyStartOffset, node.bodyEndOffset).trimEnd();
    let quoted = value;
    if (originalValue.startsWith('"') && !value.startsWith('"')) {
      quoted = `"${value}"`;
    } else if (originalValue.startsWith("'") && !value.startsWith("'")) {
      quoted = `'${value}'`;
    }

    const needsNewline = !quoted.endsWith('\n');
    return before + quoted + (needsNewline ? '\n' : '') + after;
  }

  // Markdown fallback — delegate to body-only replaceSection
  return replaceSection(markdown, tree, address, value, false, ops);
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
 * Move a section (heading + body + children) to a new position in the document.
 * Returns the new markdown string. Heading levels are adjusted automatically.
 */
export function moveSection(
  markdown: string,
  tree: SectionNode[],
  source: SectionAddress,
  anchor: SectionAddress,
  position: 'before' | 'after' | 'child_start' | 'child_end',
  ops: OpsStrategy,
): string {
  const sourceNode = resolveSingleSection(tree, source);
  const anchorNode = resolveSingleSection(tree, anchor);

  // Self-move guard
  if (sourceNode === anchorNode) {
    throw new ValidationError('Cannot move a section relative to itself.');
  }

  // Move-into-own-subtree guard
  let walk: SectionNode | null = anchorNode;
  while (walk) {
    if (walk === sourceNode) {
      throw new ValidationError('Cannot move a section into its own subtree.');
    }
    walk = walk.parent;
  }

  // Compute target level and delta
  const targetLevel = (position === 'child_start' || position === 'child_end')
    ? anchorNode.heading.level + 1
    : anchorNode.heading.level;
  const delta = targetLevel - sourceNode.heading.level;

  // Duplicate sibling check at destination
  const destSiblings = (position === 'child_start' || position === 'child_end')
    ? anchorNode.children
    : (anchorNode.parent ? anchorNode.parent.children : tree);
  const sourceHeading = sourceNode.heading.text;
  if (destSiblings.some((s) => s !== sourceNode && s.heading.text === sourceHeading)) {
    const parentName = (position === 'child_start' || position === 'child_end')
      ? anchorNode.heading.text
      : (anchorNode.parent?.heading.text ?? 'top level');
    throw new ValidationError(
      `Section "${sourceHeading}" already exists under "${parentName}". Cannot move here.`,
    );
  }

  // Extract source content
  const removeStart = sourceNode.headingStartOffset;
  const removeEnd = sourceNode.sectionEndOffset;
  const sourceText = markdown.slice(removeStart, removeEnd);

  // Adjust heading levels
  const adjustedText = delta === 0 ? sourceText : ops.adjustHeadingLevels(sourceText, delta);

  // Compute insertion offset
  let insertAt: number;
  switch (position) {
    case 'before':
      insertAt = anchorNode.headingStartOffset;
      break;
    case 'after':
      insertAt = anchorNode.sectionEndOffset;
      break;
    case 'child_start':
      insertAt = anchorNode.bodyStartOffset;
      break;
    case 'child_end':
      insertAt = anchorNode.sectionEndOffset;
      break;
  }

  // Ensure adjusted text has proper trailing newlines
  const paddedText = ensureTrailingNewlines(adjustedText);

  // Build result in one pass, accounting for offset shift
  if (removeStart < insertAt) {
    // Source is before destination — removal shifts insertion point left
    const adjustedInsertAt = insertAt - (removeEnd - removeStart);
    const withRemoval = markdown.slice(0, removeStart) + markdown.slice(removeEnd);
    return withRemoval.slice(0, adjustedInsertAt) + paddedText + withRemoval.slice(adjustedInsertAt);
  } else {
    // Source is after destination — insert first, then skip the source
    return markdown.slice(0, insertAt) + paddedText + markdown.slice(insertAt, removeStart) + markdown.slice(removeEnd);
  }
}

/**
 * Build an outline from the section tree.
 */
export function buildOutline(
  markdown: string,
  tree: SectionNode[],
  rootSection?: SectionAddress,
  maxDepth?: number,
  previewChars?: number,
  includeWordCount?: boolean,
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

      // Body text is the content between heading end and body end (before children)
      const bodyText = markdown.slice(node.bodyStartOffset, node.bodyEndOffset);
      const hasContent = bodyText.trim().length > 0;

      const entry: OutlineEntry = {
        level: node.heading.level,
        text: node.heading.text,
        path: getSectionPath(node),
        line_start: node.heading.position.start.line,
        line_end: offsetToLine(markdown, node.sectionEndOffset),
        char_count: countCodePoints(bodyContent),
        has_children: node.children.length > 0,
        has_content: hasContent,
      };

      if (includeWordCount) {
        entry.word_count = countWords(bodyContent);
      }

      if (previewChars !== undefined && hasContent) {
        const trimmed = bodyText.trim();
        entry.preview = trimmed.length > previewChars
          ? trimmed.slice(0, previewChars) + '...'
          : trimmed;
      }

      entries.push(entry);

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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface InsertTextResult {
  result: string;
  line: number;
  sectionPath: string;
}

/**
 * Insert text at a position relative to a unique anchor string in the document.
 *
 * The anchor is matched literally (no regex). The anchor must appear exactly
 * once in the document — zero matches and multiple matches both throw with a
 * message that helps the caller pick a better anchor.
 *
 * Whitespace handling: `content` is trimmed, then spliced with `\n\n` on both
 * sides of the insertion point. Any resulting run of 3+ consecutive newlines
 * is normalised down to a single blank-line separator. This produces clean
 * Markdown when the anchor sits at a paragraph boundary (the common case) and
 * still produces valid Markdown for mid-paragraph anchors.
 */
export function insertText(
  markdown: string,
  tree: SectionNode[],
  anchor: string,
  position: 'before' | 'after',
  content: string,
): InsertTextResult {
  if (!anchor) {
    throw new ValidationError('Anchor text is empty. Provide a distinctive string that appears once in the document.');
  }

  // Find all literal occurrences of the anchor
  const offsets: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = markdown.indexOf(anchor, searchFrom);
    if (idx === -1) break;
    offsets.push(idx);
    searchFrom = idx + anchor.length;
  }

  if (offsets.length === 0) {
    throw new ValidationError(`Anchor not found: "${truncate(anchor, 80)}". The anchor must match existing text in the document exactly (whitespace, punctuation, and case all matter).`);
  }

  if (offsets.length > 1) {
    const flat = flattenTree(tree);
    const candidates = offsets.map((offset) => {
      const line = offsetToLine(markdown, offset);
      const sectionPath = findDeepestSectionPath(flat, offset);
      return `  - ${sectionPath || '(document root)'} (line ${line})`;
    }).join('\n');
    throw new ValidationError(
      `Anchor is ambiguous — ${offsets.length} matches found:\n${candidates}\n\n` +
      `Use a longer or more distinctive anchor so exactly one match remains. If you want to replace existing text rather than insert new text, use doc_find_replace instead.`,
    );
  }

  // Exactly one match — splice the trimmed content at the insertion point.
  const offset = offsets[0];
  const trimmed = content.trim();
  const splicePoint = position === 'after' ? offset + anchor.length : offset;
  const before = markdown.slice(0, splicePoint);
  const after = markdown.slice(splicePoint);

  let result = before + '\n\n' + trimmed + '\n\n' + after;
  // Normalise runs of 3+ newlines down to exactly two (one blank line)
  result = result.replace(/\n{3,}/g, '\n\n');

  const flat = flattenTree(tree);
  return {
    result,
    line: offsetToLine(markdown, offset),
    sectionPath: findDeepestSectionPath(flat, offset),
  };
}

/** Find the section breadcrumb containing a given offset, or '' if not in any section. */
function findDeepestSectionPath(flat: SectionNode[], offset: number): string {
  let deepest = '';
  for (const node of flat) {
    if (offset >= node.headingStartOffset && offset < node.sectionEndOffset) {
      deepest = getSectionPath(node);
    }
  }
  return deepest;
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

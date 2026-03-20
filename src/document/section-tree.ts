// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Root, Heading, RootContent } from 'mdast';
import type { SectionNode } from '../shared/types.js';
import { toString } from './ast-utils.js';

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

    // Section ends at the start of the next heading of same or higher level,
    // or at the end of the document
    const sectionEndOffset = nextHeading
      ? nextHeading.position!.start.offset!
      : markdown.length;

    // Body ends at the start of the first child heading, or at section end
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

    // Find the correct parent: walk up the stack until we find a heading
    // with a lower level (higher in hierarchy)
    while (stack.length > 0 && stack[stack.length - 1].heading.level >= heading.depth) {
      stack.pop();
    }

    if (stack.length > 0) {
      const parent = stack[stack.length - 1];
      node.parent = parent;
      node.index = parent.children.length;
      node.depth = parent.depth + 1;
      parent.children.push(node);

      // Update parent's sectionEndOffset to encompass children
      // (it should already be correct from the heading scan, but let's be explicit)
    } else {
      node.index = roots.length;
      roots.push(node);
    }

    stack.push(node);
  }

  // Fix sectionEndOffset for nodes with children:
  // A section's end is the end of its last descendant
  fixSectionEndOffsets(roots, markdown.length);

  return roots;
}

/**
 * Extract all heading nodes from the AST in order.
 */
function extractHeadings(ast: Root): Heading[] {
  const headings: Heading[] = [];
  for (const child of ast.children) {
    if (child.type === 'heading' && child.position) {
      headings.push(child);
    }
  }
  return headings;
}

/**
 * Find where the body of a section ends (before first child heading).
 */
function findBodyEnd(headings: Heading[], currentIndex: number, sectionEnd: number): number {
  const current = headings[currentIndex];
  // Look for the next heading that is deeper (a child)
  for (let i = currentIndex + 1; i < headings.length; i++) {
    const next = headings[i];
    if (next.depth <= current.depth) {
      // Same or higher level — not a child, body extends to here
      break;
    }
    // First child heading found — body ends at its start
    return next.position!.start.offset!;
  }
  // No child headings — body extends to section end
  return sectionEnd;
}

/**
 * Fix sectionEndOffset for sections with children.
 * A parent section should end where its last descendant ends.
 */
function fixSectionEndOffsets(nodes: SectionNode[], docEnd: number): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      fixSectionEndOffsets(node.children, docEnd);
      const lastChild = node.children[node.children.length - 1];
      node.sectionEndOffset = lastChild.sectionEndOffset;
    }
  }
}

/**
 * Build a preamble pseudo-section for content before the first heading.
 * Returns null if there is no non-whitespace content before the first heading.
 */
export function buildPreambleNode(
  markdown: string,
  firstHeadingOffset: number | null,
): SectionNode | null {
  const endOffset = firstHeadingOffset ?? markdown.length;
  const preambleText = markdown.slice(0, endOffset);
  if (preambleText.trim().length === 0) return null;

  return {
    heading: {
      text: '__preamble',
      level: 0,
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: 1, column: 1, offset: 0 },
      },
    },
    headingStartOffset: 0,
    bodyStartOffset: 0,
    bodyEndOffset: endOffset,
    sectionEndOffset: endOffset,
    children: [],
    parent: null,
    index: 0,
    depth: 0,
  };
}

/**
 * Get the breadcrumb path for a section node (e.g., ["RBAC Model", "Permission Types"]).
 */
export function getBreadcrumb(node: SectionNode): string[] {
  const crumbs: string[] = [];
  let current: SectionNode | null = node;
  while (current) {
    crumbs.unshift(current.heading.text);
    current = current.parent;
  }
  return crumbs;
}

/**
 * Get the section path string (e.g., "RBAC Model > Permission Types").
 */
export function getSectionPath(node: SectionNode): string {
  return getBreadcrumb(node).join(' > ');
}

/**
 * Flatten the section tree into a depth-first ordered list.
 */
export function flattenTree(roots: SectionNode[]): SectionNode[] {
  const result: SectionNode[] = [];
  function walk(nodes: SectionNode[]) {
    for (const node of nodes) {
      result.push(node);
      walk(node.children);
    }
  }
  walk(roots);
  return result;
}

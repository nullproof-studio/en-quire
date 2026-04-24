// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { SectionNode } from '../shared/types.js';

/**
 * Fix sectionEndOffset for sections with children.
 * A parent section should end where its last descendant ends.
 */
export function fixSectionEndOffsets(nodes: SectionNode[], docEnd: number): void {
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

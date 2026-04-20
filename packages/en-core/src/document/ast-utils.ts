// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Node, Parent } from 'unist';

/**
 * Extract plain text content from an mdast node and its children.
 * Handles text, inlineCode, emphasis, strong, etc.
 */
export function toString(node: Node): string {
  if ('value' in node && typeof (node as { value: unknown }).value === 'string') {
    return (node as { value: string }).value;
  }

  if ('children' in node && Array.isArray((node as Parent).children)) {
    return (node as Parent).children.map(toString).join('');
  }

  return '';
}

/**
 * Count Unicode code points in a string (not bytes, not UTF-16 code units).
 */
export function countCodePoints(str: string): number {
  return [...str].length;
}

/**
 * Get the line number (1-indexed) for a byte offset in a string.
 */
export function offsetToLine(markdown: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < markdown.length; i++) {
    if (markdown[i] === '\n') {
      line++;
    }
  }
  return line;
}

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import micromatch from 'micromatch';
import type { SectionNode, SectionAddress } from '../shared/types.js';
import { AddressResolutionError } from '../shared/errors.js';
import { flattenTree } from './section-tree.js';

/**
 * Parse a raw address string into a typed SectionAddress.
 *
 * Rules:
 * - If it's a JSON array of numbers → IndexAddress
 * - If it contains " > " → PathAddress
 * - If it contains glob characters (*, ?) → PatternAddress
 * - Otherwise → TextAddress
 */
export function parseAddress(raw: string): SectionAddress {
  const trimmed = raw.trim();

  // Try JSON array index first
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

  // Path address (contains " > " separator)
  if (trimmed.includes(' > ')) {
    return {
      type: 'path',
      segments: trimmed.split(' > ').map((s) => s.trim()),
    };
  }

  // Pattern address (contains glob characters)
  if (/[*?]/.test(trimmed)) {
    return { type: 'pattern', pattern: trimmed };
  }

  // Default: text address
  return { type: 'text', text: trimmed };
}

/**
 * Resolve a section address to one or more matching SectionNodes.
 *
 * - TextAddress: returns the first exact match (throws if none)
 * - PathAddress: walks the tree matching each segment
 * - IndexAddress: navigates by positional indices
 * - PatternAddress: returns all glob matches
 */
export function resolveAddress(
  tree: SectionNode[],
  address: SectionAddress,
): SectionNode[] {
  switch (address.type) {
    case 'text':
      return resolveTextAddress(tree, address.text);
    case 'path':
      return resolvePathAddress(tree, address.segments);
    case 'index':
      return resolveIndexAddress(tree, address.indices);
    case 'pattern':
      return resolvePatternAddress(tree, address.pattern);
  }
}

/**
 * Resolve a single section, throwing if zero or multiple matches.
 */
export function resolveSingleSection(
  tree: SectionNode[],
  address: SectionAddress,
): SectionNode {
  const matches = resolveAddress(tree, address);
  if (matches.length === 0) {
    const allHeadings = flattenTree(tree).map((n) => n.heading.text);
    throw new AddressResolutionError(
      addressToString(address),
      'No matching section found',
      findClosestMatches(addressToString(address), allHeadings),
    );
  }
  if (matches.length > 1) {
    throw new AddressResolutionError(
      addressToString(address),
      `Ambiguous: ${matches.length} sections match. Use a more specific address (e.g., path or index)`,
      matches.map((m) => m.heading.text),
    );
  }
  return matches[0];
}

function resolveTextAddress(tree: SectionNode[], text: string): SectionNode[] {
  const all = flattenTree(tree);
  return all.filter((n) => n.heading.text === text);
}

function resolvePathAddress(tree: SectionNode[], segments: string[]): SectionNode[] {
  if (segments.length === 0) return [];

  let candidates = tree;
  let matches: SectionNode[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    matches = candidates.filter((n) => n.heading.text === segment);

    if (matches.length === 0) {
      return [];
    }

    if (i < segments.length - 1) {
      // Collect all children of current matches for next segment
      candidates = matches.flatMap((n) => n.children);
    }
  }

  return matches;
}

function resolveIndexAddress(tree: SectionNode[], indices: number[]): SectionNode[] {
  let current = tree;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (idx < 0 || idx >= current.length) {
      return [];
    }

    if (i === indices.length - 1) {
      return [current[idx]];
    }

    current = current[idx].children;
  }

  return [];
}

function resolvePatternAddress(tree: SectionNode[], pattern: string): SectionNode[] {
  const all = flattenTree(tree);
  const headings = all.map((n) => n.heading.text);
  const matched = micromatch(headings, pattern);
  return all.filter((n) => matched.includes(n.heading.text));
}

function addressToString(address: SectionAddress): string {
  switch (address.type) {
    case 'text':
      return address.text;
    case 'path':
      return address.segments.join(' > ');
    case 'index':
      return JSON.stringify(address.indices);
    case 'pattern':
      return address.pattern;
  }
}

/**
 * Find closest matching heading texts for error messages.
 */
function findClosestMatches(query: string, headings: string[], limit = 3): string[] {
  const lower = query.toLowerCase();
  return headings
    .filter((h) => h.toLowerCase().includes(lower) || lower.includes(h.toLowerCase()))
    .slice(0, limit);
}

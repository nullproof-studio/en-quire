// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import micromatch from 'micromatch';
import type { SectionNode, SectionAddress } from '../shared/types.js';
import { AddressResolutionError } from '../shared/errors.js';
import { levenshtein } from '../shared/levenshtein.js';
import { flattenTree } from './section-tree.js';

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
    case 'dotpath':
      return resolveDotPathAddress(tree, address.segments);
    case 'anchor':
      return resolveAnchorAddress(tree, address.id);
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
    throw new AddressResolutionError(
      addressToString(address),
      'No matching section found',
      findClosestSections(addressLeaf(address), tree),
    );
  }
  if (matches.length > 1) {
    throw new AddressResolutionError(
      addressToString(address),
      `Ambiguous: ${matches.length} sections match. Retry with one of the disambiguated paths or indices below`,
      matches.map(describeMatchForDisambiguation),
    );
  }
  return matches[0];
}

/**
 * Build a section's full path from root, joined by " > ". This is a
 * ready-to-use path address the caller can echo straight back.
 */
function fullPathString(node: SectionNode): string {
  const pathSegments: string[] = [];
  let curr: SectionNode | null = node;
  while (curr) {
    pathSegments.unshift(curr.heading.text);
    curr = curr.parent;
  }
  return pathSegments.join(' > ');
}

/**
 * Build a disambiguating description of a matched section: its full path
 * from root, plus the index path that uniquely identifies it (always works,
 * even when sibling paths are textually identical).
 */
function describeMatchForDisambiguation(node: SectionNode): string {
  const indexPath: number[] = [];
  let curr: SectionNode | null = node;
  while (curr) {
    indexPath.unshift(curr.index);
    curr = curr.parent;
  }
  return `"${fullPathString(node)}" (index ${JSON.stringify(indexPath)})`;
}

function resolveTextAddress(tree: SectionNode[], text: string): SectionNode[] {
  const all = flattenTree(tree);
  return all.filter((n) => n.heading.text === text);
}

function resolvePathAddress(tree: SectionNode[], segments: string[]): SectionNode[] {
  if (segments.length === 0) return [];

  // First segment: search the entire tree (not just top-level roots)
  // so that partial paths like "Section Two > Subsection 2.1" work
  // without requiring the full path from the document root.
  const all = flattenTree(tree);
  let matches = all.filter((n) => n.heading.text === segments[0]);

  if (matches.length === 0) return [];

  // Subsequent segments: walk children of current matches
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const candidates = matches.flatMap((n) => n.children);
    matches = candidates.filter((n) => n.heading.text === segment);

    if (matches.length === 0) return [];
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

function resolveAnchorAddress(tree: SectionNode[], id: string): SectionNode[] {
  return flattenTree(tree).filter((n) => n.heading.anchorId === id);
}

function resolveDotPathAddress(tree: SectionNode[], segments: string[]): SectionNode[] {
  if (segments.length === 0) return [];

  let candidates = tree;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const matches = candidates.filter((n) => n.heading.text === segment);

    if (matches.length === 0) return [];

    if (i < segments.length - 1) {
      candidates = matches.flatMap((n) => n.children);
    } else {
      return matches;
    }
  }

  return [];
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
    case 'dotpath':
      return address.segments.join('.');
    case 'anchor':
      return `^${address.id}`;
  }
}

/**
 * The most specific text the caller named — what a heading should actually be
 * matched against. For a path/dotpath address that is the leaf segment, not the
 * whole joined path: ranking bare heading texts against the full path string is
 * dominated by length mismatch and surfaces parent headings ("Implementation
 * Notes") ahead of the intended leaf ("Storage Mapping").
 */
function addressLeaf(address: SectionAddress): string {
  switch (address.type) {
    case 'text':
      return address.text;
    case 'path':
    case 'dotpath':
      return address.segments[address.segments.length - 1] ?? '';
    case 'pattern':
      return address.pattern;
    case 'index':
      return JSON.stringify(address.indices);
    case 'anchor':
      return `^${address.id}`;
  }
}

/**
 * Find the sections whose heading text is closest to the address leaf, ranked
 * by length-normalized Levenshtein distance (closest first, ties broken
 * lexically on heading text). Normalizing by the longer string keeps a heading
 * that merely appends a qualifier — "Storage Mapping (Postgres, pending
 * OQ-004)" vs the leaf "Storage Mapping" — close, where raw edit distance would
 * let a short unrelated heading ("Hashing") score better. Each suggestion is
 * returned as a full breadcrumb path so the caller gets an unambiguous,
 * copy-pasteable address rather than a bare heading that may be duplicated
 * elsewhere in the document.
 */
function findClosestSections(leaf: string, tree: SectionNode[], limit = 3): string[] {
  const lq = leaf.toLowerCase();
  return flattenTree(tree)
    .map((n) => {
      const h = n.heading.text.toLowerCase();
      return { n, score: levenshtein(lq, h) / Math.max(lq.length, h.length, 1) };
    })
    .sort((a, b) => a.score - b.score || a.n.heading.text.localeCompare(b.n.heading.text))
    .slice(0, limit)
    .map((x) => fullPathString(x.n));
}

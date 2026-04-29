// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Root, Heading, Link, Yaml, Content } from 'mdast';

type AnyNode = Root | Content;
import { parse as parseYaml } from 'yaml';
import type { RawLink } from '@nullproof-studio/en-core';
import { toString } from '@nullproof-studio/en-core';
import { parseMarkdown } from './parser.js';

const RELATIONSHIP_KEYS: ReadonlyArray<RawLink['relationship']> = [
  'references', 'implements', 'supersedes', 'see_also',
];

const WIKI_LINK_RE = /\[\[([^\[\]]+)\]\]/g;
const CONTEXT_RADIUS = 60;

/**
 * Walk the markdown AST and extract every cross-document link as a RawLink:
 *   - markdown links `[text](path[#section])` with relative or root-anchored
 *     paths (external http(s)/mailto/tel/etc. and image refs are skipped),
 *   - Obsidian-style wiki links `[[name[#section][|alias]]]` found in text
 *     nodes outside code,
 *   - frontmatter relationship arrays (`references` / `implements` /
 *     `supersedes` / `see_also`); these are marked `prefixed: true` because
 *     the values are intended as fully-qualified document refs that the
 *     resolver should not re-base against the source file's directory.
 *
 * Source-section attribution uses the AST heading positions to map a link's
 * byte offset back to the path of the section that contains it. Links that
 * appear before the first heading (or in frontmatter) get `source_section: null`.
 */
export function extractLinks(content: string): RawLink[] {
  const ast = parseMarkdown(content);
  const links: RawLink[] = [];

  // Frontmatter relationships first — they have no position, no source section.
  links.push(...extractFrontmatterLinks(ast));

  const headings = collectHeadings(ast);

  // Markdown link nodes — walk AST, skip code/inlineCode/image alt subtrees.
  walk(ast, (node) => {
    if (node.type === 'link') {
      const link = nodeToLink(node, content, headings);
      if (link) links.push(link);
    }
  }, { skipCode: true, skipImages: true });

  // Wiki links — scan the source text but only the slices that aren't code.
  for (const slice of nonCodeRanges(ast, content)) {
    WIKI_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_LINK_RE.exec(slice.text)) !== null) {
      const offset = slice.start + m.index;
      const link = wikiToLink(m[0], m[1], offset, content, headings);
      if (link) links.push(link);
    }
  }

  return links;
}

// --- frontmatter ---------------------------------------------------------

interface RelationshipArrays {
  references?: unknown;
  implements?: unknown;
  supersedes?: unknown;
  see_also?: unknown;
}

function extractFrontmatterLinks(ast: Root): RawLink[] {
  const yamlNode = ast.children.find((c): c is Yaml => c.type === 'yaml');
  if (!yamlNode) return [];

  let parsed: RelationshipArrays;
  try {
    parsed = parseYaml(yamlNode.value) as RelationshipArrays;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const out: RawLink[] = [];
  for (const key of RELATIONSHIP_KEYS) {
    const value = parsed[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item !== 'string' || item.trim() === '') continue;
      const [target, fragment] = splitFragment(item.trim());
      out.push({
        source_section: null,
        target_path: target,
        target_section: fragment,
        relationship: key,
        context: null,
        prefixed: true,
      });
    }
  }
  return out;
}

// --- markdown links ------------------------------------------------------

function nodeToLink(node: Link, content: string, headings: Heading[]): RawLink | null {
  const url = node.url;
  if (!url) return null;
  if (isExternalScheme(url)) return null;

  const [target, fragment] = splitFragment(url);
  if (target === '') return null;

  const offset = node.position?.start?.offset;
  return {
    source_section: offset !== undefined ? sectionPathAt(offset, headings) : null,
    target_path: target,
    target_section: fragment,
    relationship: 'references',
    context: offset !== undefined ? buildContext(content, offset) : null,
  };
}

function isExternalScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('#');
}

// --- wiki links ----------------------------------------------------------

function wikiToLink(
  raw: string,
  inner: string,
  offset: number,
  content: string,
  headings: Heading[],
): RawLink | null {
  // Strip alias `name|alias` (alias is display-only)
  const beforePipe = inner.split('|', 1)[0].trim();
  if (beforePipe === '') return null;
  const [target, fragment] = splitFragment(beforePipe);
  return {
    source_section: sectionPathAt(offset, headings),
    target_path: target,
    target_section: fragment,
    relationship: 'references',
    context: buildContext(content, offset),
  };
}

// --- AST helpers ---------------------------------------------------------

function collectHeadings(ast: Root): Heading[] {
  const headings: Heading[] = [];
  for (const child of ast.children) {
    if (child.type === 'heading' && child.position) headings.push(child);
  }
  return headings;
}

interface WalkOptions {
  skipCode: boolean;
  skipImages: boolean;
}

function walk(node: AnyNode, visit: (n: Content) => void, opts: WalkOptions): void {
  if (!('children' in node) || !Array.isArray((node as { children?: unknown[] }).children)) return;
  for (const child of (node as { children: Content[] }).children) {
    if (opts.skipCode && (child.type === 'code' || child.type === 'inlineCode' || child.type === 'yaml')) {
      continue;
    }
    if (opts.skipImages && (child.type === 'image' || child.type === 'imageReference')) {
      continue;
    }
    visit(child);
    walk(child as AnyNode, visit, opts);
  }
}

/**
 * Yield byte ranges of the source text that are NOT inside fenced code,
 * inline code, or YAML frontmatter. Used to scan for wiki links without
 * matching them inside code blocks.
 */
function nonCodeRanges(ast: Root, content: string): Array<{ start: number; text: string }> {
  const exclusions: Array<[number, number]> = [];
  const collect = (node: AnyNode): void => {
    if ('type' in node) {
      const t = node.type;
      if ((t === 'code' || t === 'inlineCode' || t === 'yaml') && (node as Content).position) {
        const pos = (node as Content).position!;
        exclusions.push([pos.start.offset!, pos.end.offset!]);
        return;
      }
    }
    if ('children' in node && Array.isArray((node as { children?: unknown[] }).children)) {
      for (const child of (node as { children: Content[] }).children) collect(child);
    }
  };
  collect(ast);

  exclusions.sort((a, b) => a[0] - b[0]);

  const ranges: Array<{ start: number; text: string }> = [];
  let cursor = 0;
  for (const [start, end] of exclusions) {
    if (start > cursor) ranges.push({ start: cursor, text: content.slice(cursor, start) });
    cursor = Math.max(cursor, end);
  }
  if (cursor < content.length) ranges.push({ start: cursor, text: content.slice(cursor) });
  return ranges;
}

// --- shared helpers ------------------------------------------------------

function splitFragment(s: string): [string, string | null] {
  const hashIdx = s.indexOf('#');
  if (hashIdx < 0) return [s, null];
  return [s.slice(0, hashIdx), s.slice(hashIdx + 1) || null];
}

function buildContext(content: string, offset: number): string {
  const start = Math.max(0, offset - CONTEXT_RADIUS);
  const end = Math.min(content.length, offset + CONTEXT_RADIUS);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Build the section path string ("Top > Foo > Bar") for the section that
 * contains `offset`. Returns null when offset falls before any heading.
 */
function sectionPathAt(offset: number, headings: Heading[]): string | null {
  // Find the deepest heading whose start <= offset and whose section
  // hasn't ended (next heading at same/higher level >= offset). The
  // section tree builder owns the same logic for indexing — replicating
  // it here in lighter form keeps the link extractor independent of the
  // tree (no offset coupling on tree mutation).
  const ancestors: Heading[] = [];
  for (const h of headings) {
    const hStart = h.position?.start.offset ?? 0;
    if (hStart > offset) break;
    while (ancestors.length > 0 && ancestors[ancestors.length - 1].depth >= h.depth) {
      ancestors.pop();
    }
    ancestors.push(h);
  }
  if (ancestors.length === 0) return null;
  return ancestors.map((h) => toString(h)).join(' > ');
}

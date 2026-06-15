// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

/**
 * Stable section anchors — Obsidian-style `^id` tokens that give a heading an
 * identity decoupled from its display text and position.
 *
 * A heading carries its anchor as a trailing token on the heading line:
 *
 *     ### Storage Mapping ^store-map
 *
 * The token travels with the heading line through every structural operation
 * (move, rename, renumber), so addresses and cross-document links that target
 * `^store-map` stay valid even as the surrounding text changes. This module
 * owns the token grammar and the slug derivation; the parser strips the token
 * into `SectionNode.heading.anchorId`, and the resolver matches against it.
 */

/**
 * Matches a trailing ` ^id` anchor token at the end of a heading's text.
 * The id must start with an alphanumeric and may contain word chars and
 * hyphens. Whitespace before the caret is required so mid-text carets
 * (e.g. "mc^2") are never mistaken for anchors.
 */
const ANCHOR_RE = /\s+\^([A-Za-z0-9][\w-]*)\s*$/;

/** A heading's text split into its display text and optional anchor id. */
export interface ExtractedAnchor {
  text: string;
  anchorId?: string;
}

/**
 * Split a trailing `^id` anchor token off a heading's text. Returns the clean
 * display text plus the id when present. Leaves text untouched otherwise.
 */
export function extractAnchor(headingText: string): ExtractedAnchor {
  const match = ANCHOR_RE.exec(headingText);
  if (!match) return { text: headingText };
  return {
    text: headingText.slice(0, match.index).trimEnd(),
    anchorId: match[1],
  };
}

/**
 * Derive a URL-style slug from heading text: lowercase, drop punctuation,
 * collapse whitespace and separators to single hyphens, trim edges.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Return `base` if free, otherwise the first `base-N` (N≥2) not in `taken`.
 * Does not mutate `taken`.
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || 'section';
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** One heading that received an anchor during {@link assignAnchors}. */
export interface AssignedAnchor {
  /** Clean heading text (without the new token). */
  heading: string;
  anchorId: string;
  /** 1-based line number of the heading in the source. */
  line: number;
}

/**
 * Backfill anchors: append a derived `^id` to every ATX heading that lacks
 * one, skipping fenced code blocks. Existing anchors are preserved and reserve
 * their id so derived slugs never collide. Returns the rewritten content and
 * the list of headings that were assigned.
 *
 * Operates on raw lines (not the section tree) so it is safe to run on any
 * document, including ones whose structure has not been indexed.
 */
export function assignAnchors(markdown: string): { content: string; assigned: AssignedAnchor[] } {
  const lines = markdown.split('\n');
  const taken = new Set<string>();

  // First pass: reserve ids already present so backfill never collides.
  forEachHeadingLine(lines, (text) => {
    const { anchorId } = extractAnchor(text);
    if (anchorId) taken.add(anchorId);
  });

  const assigned: AssignedAnchor[] = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isFence(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;

    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;

    const headingText = m[2].replace(/\s+#+\s*$/, ''); // tolerate closed ATX (trailing #)
    if (extractAnchor(headingText).anchorId) continue; // already anchored

    const id = uniqueSlug(slugify(headingText), taken);
    taken.add(id);
    lines[i] = `${m[1]} ${headingText} ^${id}`;
    assigned.push({ heading: headingText, anchorId: id, line: i + 1 });
  }

  return { content: lines.join('\n'), assigned };
}

function isFence(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('```') || t.startsWith('~~~');
}

function forEachHeadingLine(lines: string[], visit: (text: string) => void): void {
  let inCode = false;
  for (const line of lines) {
    if (isFence(line)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) visit(m[1].replace(/\s+#+\s*$/, ''));
  }
}

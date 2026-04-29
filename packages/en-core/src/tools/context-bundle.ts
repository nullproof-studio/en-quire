// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { checkPermission } from '../rbac/permissions.js';
import { searchDocuments } from '../search/query.js';
import { resolveFilePath } from '../config/roots.js';
import { readDocument } from '../shared/file-utils.js';
import { parserRegistry } from '../document/parser-registry.js';
import { readSection } from '../document/section-ops-core.js';
import { flattenTree } from '../document/section-tree.js';
import { AddressResolutionError } from '../shared/errors.js';
import { getLogger } from '../shared/logger.js';
import type { SectionNode, SectionAddress } from '../shared/types.js';

/**
 * Convert heading text to a GitHub-flavour markdown slug. Used as the
 * fallback resolution path when a stored target_section is a slugified
 * URL fragment (`#tool-selection`) rather than the actual heading text
 * ("Tool Selection") — markdown links use slugs, our addresses use
 * heading text, so the consumer has to bridge.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Find a section whose slugified heading text matches `slug`. */
function findHeadingBySlug(tree: SectionNode[], slug: string): SectionNode | null {
  for (const node of flattenTree(tree)) {
    if (slugify(node.heading.text) === slug) return node;
  }
  return null;
}

/**
 * Build a context bundle for a topic by composing search + the cross-document
 * link index. Search produces the seed sections; BFS over `doc_links` (both
 * directions) expands the bundle to neighbours up to `max_depth` hops away.
 *
 * Ranking combines a normalised search rank with a hop-distance proximity
 * score (0.7 / 0.3 split). Sections without a search match are still
 * considered through the graph component, weighted down by hop distance.
 *
 * Permission model: caller must hold `search` permission on the queried
 * scope (defaults to global) to call the tool, and `read` permission on
 * each individual section's file for it to appear in the result. Sections
 * the caller cannot read are filtered out silently — the bundle returns
 * what's permitted rather than throwing.
 */

export interface ContextBundleSection {
  file: string;
  section_path: string;
  content: string;
  relevance_score: number;
  hop_distance: number;
}

export const ContextBundleSchema = z.object({
  query: z.string().describe('Topic or question to gather context for. Used as the FTS5 search query.'),
  scope: z.string().optional().describe('Limit the seed search to a specific root or path. Omit to search across all roots.'),
  max_sections: z.number().int().positive().max(50).default(10).describe('Maximum number of sections to include in the bundle (default 10, max 50).'),
  max_depth: z.number().int().min(0).max(3).default(1).describe('Maximum hop distance from a search hit when expanding via the link graph (default 1, max 3). 0 disables graph expansion.'),
});

interface NodeKey {
  file: string;
  section: string;
}

interface NodeRecord {
  hop_distance: number;
  search_score: number;
}

function keyOf(node: NodeKey): string {
  return `${node.file}\x00${node.section}`;
}

interface LinkRow {
  source_file: string;
  source_section: string | null;
  target_file: string;
  target_section: string | null;
}

export async function handleContextBundle(
  args: z.infer<typeof ContextBundleSchema>,
  ctx: ToolContext,
): Promise<{ sections: ContextBundleSection[] }> {
  // The seed phase is a search; the read phase is per-section read.
  // `search` gates the lookup itself; `read` is enforced per-result below.
  const { caller } = ctx;
  if (!checkPermission(caller, 'search', args.scope ?? '**').allowed) {
    // Mirror handleDocSearch: search permission is the entry gate.
    return { sections: [] };
  }

  const max_sections = args.max_sections ?? 10;
  const max_depth = args.max_depth ?? 1;

  // Phase 1 — seed via search (overshoot for re-ranking).
  const hits = searchDocuments(ctx.db, args.query, {
    scope: args.scope,
    max_results: max_sections * 2,
    include_context: false,
  });

  if (hits.length === 0) return { sections: [] };

  const visited = new Map<string, NodeRecord>();
  for (const hit of hits) {
    visited.set(keyOf({ file: hit.file, section: hit.section_path }), {
      hop_distance: 0,
      search_score: hit.score,
    });
  }

  // Phase 2 — BFS over the link graph (both directions).
  const outgoingStmt = ctx.db.prepare(
    `SELECT source_file, source_section, target_file, target_section
     FROM doc_links WHERE source_file = ?`,
  );
  const incomingStmt = ctx.db.prepare(
    `SELECT source_file, source_section, target_file, target_section
     FROM doc_links WHERE target_file = ?`,
  );
  // Document-level links (markdown `[text](file.md)` with no fragment,
  // and frontmatter relationship arrays) carry a null section. Without
  // a representative section we'd skip them entirely, missing the
  // common cross-document pattern. Look up the file's first indexed
  // section as the entry point — cached because the same file can
  // appear on many edges.
  const firstSectionStmt = ctx.db.prepare(
    `SELECT section_path FROM sections_fts
     WHERE file_path = ? AND section_path != ''
     ORDER BY line_start LIMIT 1`,
  );
  const fileEntryCache = new Map<string, string | null>();
  const entrySectionFor = (file: string): string | null => {
    if (fileEntryCache.has(file)) return fileEntryCache.get(file) ?? null;
    const row = firstSectionStmt.get(file) as { section_path: string } | undefined;
    const section = row?.section_path ?? null;
    fileEntryCache.set(file, section);
    return section;
  };

  let frontier: NodeKey[] = hits.map((h) => ({ file: h.file, section: h.section_path }));
  for (let d = 1; d <= max_depth; d++) {
    const next: NodeKey[] = [];
    for (const node of frontier) {
      // Outgoing edges sourced anywhere in this file
      for (const row of outgoingStmt.all(node.file) as LinkRow[]) {
        // Skip unresolved targets (rows tagged with `?` prefix)
        if (row.target_file.startsWith('?')) continue;
        const childSection = row.target_section ?? entrySectionFor(row.target_file);
        if (!childSection) continue; // target file has no indexable sections
        const child: NodeKey = { file: row.target_file, section: childSection };
        if (visited.has(keyOf(child))) continue;
        visited.set(keyOf(child), { hop_distance: d, search_score: 0 });
        next.push(child);
      }
      // Incoming edges targeted anywhere in this file
      for (const row of incomingStmt.all(node.file) as LinkRow[]) {
        const childSection = row.source_section ?? entrySectionFor(row.source_file);
        if (!childSection) continue;
        const child: NodeKey = { file: row.source_file, section: childSection };
        if (visited.has(keyOf(child))) continue;
        visited.set(keyOf(child), { hop_distance: d, search_score: 0 });
        next.push(child);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  // Phase 3 — score and rank.
  let maxSearch = 0;
  for (const r of visited.values()) maxSearch = Math.max(maxSearch, r.search_score);
  if (maxSearch === 0) maxSearch = 1; // avoid division by zero when no search hits

  type Scored = NodeKey & { relevance_score: number; hop_distance: number };
  const ranked: Scored[] = [...visited.entries()].map(([k, r]) => {
    const [file, section] = k.split('\x00');
    const search_norm = r.search_score / maxSearch;
    const graph_norm = 1 / (r.hop_distance + 1);
    const relevance_score = 0.7 * search_norm + 0.3 * graph_norm;
    return { file, section, relevance_score, hop_distance: r.hop_distance };
  });
  ranked.sort((a, b) => b.relevance_score - a.relevance_score);

  // Phase 4 — walk the ranked list, accumulating up to `max_sections`
  // entries that the caller can READ and we can actually load. Sections
  // that fail permission OR fail the section-read step (stale heading,
  // missing file, etc.) are skipped without consuming a bundle slot, so
  // a mixed-permission deployment doesn't end up with the cap consumed
  // by unreadable high-ranked candidates.
  //
  // Dedup is by (file, canonical_section_path) — a search hit that
  // returned the path "Tool Selection" and a graph neighbour stored as
  // the slug "tool-selection" both resolve to the same section, and
  // shouldn't both consume a bundle slot.
  const sections: ContextBundleSection[] = [];
  const emitted = new Set<string>();
  for (const node of ranked) {
    if (sections.length >= max_sections) break;
    if (!checkPermission(caller, 'read', node.file).allowed) continue;
    try {
      const resolved = resolveFilePath(ctx.config.document_roots, node.file);
      const { content: fileContent } = readDocument(resolved.root.path, resolved.relativePath);
      const parser = parserRegistry.getParser(resolved.relativePath);
      const tree = parser.parse(fileContent);

      // Try the stored section as-is. Markdown link fragments
      // (`#tool-selection`) are stored verbatim by the extractor and
      // won't resolve via parseAddress against heading text ("Tool
      // Selection"). On AddressResolutionError, try slug-matching
      // against the file's actual headings before giving up.
      let result: ReturnType<typeof readSection>;
      try {
        const address = parser.parseAddress(node.section);
        result = readSection(fileContent, tree, address, true);
      } catch (parseErr) {
        if (!(parseErr instanceof AddressResolutionError)) throw parseErr;
        const slugMatch = findHeadingBySlug(tree, node.section);
        if (!slugMatch) throw parseErr;
        const address: SectionAddress = { type: 'text', text: slugMatch.heading.text };
        result = readSection(fileContent, tree, address, true);
      }

      // Use the canonical section path returned by readSection so the
      // response is round-trippable for follow-up doc_read_section /
      // doc_history calls. Without this, a slug-fallback hit would
      // surface section_path: "tool-selection" — not a valid address
      // for any other tool.
      const dedupKey = `${node.file}\x00${result.path}`;
      if (emitted.has(dedupKey)) continue;
      emitted.add(dedupKey);

      sections.push({
        file: node.file,
        section_path: result.path,
        content: result.content,
        relevance_score: node.relevance_score,
        hop_distance: node.hop_distance,
      });
    } catch (err) {
      // The link index can carry stale section paths if the source file was
      // edited after a target's headings changed but before the source was
      // re-synced. Skip silently rather than fail the bundle.
      getLogger().debug('context_bundle: skipping unreadable section', {
        file: node.file,
        section: node.section,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { sections };
}

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { checkPermission } from '../rbac/permissions.js';
import { searchDocuments } from '../search/query.js';
import { resolveFilePath } from '../config/roots.js';
import { readDocument } from '../shared/file-utils.js';
import { parserRegistry } from '../document/parser-registry.js';
import { readSection } from '../document/section-ops-core.js';
import { getLogger } from '../shared/logger.js';

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

  let frontier: NodeKey[] = hits.map((h) => ({ file: h.file, section: h.section_path }));
  for (let d = 1; d <= max_depth; d++) {
    const next: NodeKey[] = [];
    for (const node of frontier) {
      // Outgoing edges sourced anywhere in this file
      for (const row of outgoingStmt.all(node.file) as LinkRow[]) {
        if (!row.target_section) continue;
        // Skip unresolved targets (rows tagged with `?` prefix)
        if (row.target_file.startsWith('?')) continue;
        const child: NodeKey = { file: row.target_file, section: row.target_section };
        if (visited.has(keyOf(child))) continue;
        visited.set(keyOf(child), { hop_distance: d, search_score: 0 });
        next.push(child);
      }
      // Incoming edges targeted anywhere in this file
      for (const row of incomingStmt.all(node.file) as LinkRow[]) {
        if (!row.source_section) continue;
        const child: NodeKey = { file: row.source_file, section: row.source_section };
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

  // Phase 4 — cap, then permission-filter + read content.
  const capped = ranked.slice(0, max_sections);
  const sections: ContextBundleSection[] = [];
  for (const node of capped) {
    if (!checkPermission(caller, 'read', node.file).allowed) continue;
    try {
      const resolved = resolveFilePath(ctx.config.document_roots, node.file);
      const { content: fileContent } = readDocument(resolved.root.path, resolved.relativePath);
      const parser = parserRegistry.getParser(resolved.relativePath);
      const tree = parser.parse(fileContent);
      const address = parser.parseAddress(node.section);
      const { content } = readSection(fileContent, tree, address, true);
      sections.push({
        file: node.file,
        section_path: node.section,
        content,
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

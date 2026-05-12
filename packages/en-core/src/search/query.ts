// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import micromatch from 'micromatch';
import type { SearchResult } from '../shared/types.js';
import { vectorSearch } from './vector-store.js';

export type SearchType = 'fulltext' | 'semantic' | 'hybrid';

export interface SearchOptions {
  scope?: string;
  section_filter?: string;
  max_results?: number;
  include_context?: boolean;
  /** Search mode. Defaults to 'fulltext'. */
  search_type?: SearchType;
  /**
   * Pre-computed embedding of the query, required for 'semantic' and
   * 'hybrid' modes. Callers (handlers) own embedding computation so the
   * search function stays synchronous and dependency-free.
   */
  query_embedding?: Float32Array;
}

/**
 * Sanitise a user query for FTS5 MATCH syntax.
 *
 * FTS5 treats certain characters and words as operators:
 * - `-` (NOT), `*` (prefix), `AND`, `OR`, `NOT`, `NEAR`
 * - Bare hyphens in terms like "en-quire" become "en MINUS quire"
 *
 * Strategy: quote each whitespace-delimited token with double quotes.
 * This treats every token as a literal phrase, disabling operator parsing.
 * Internal double quotes are escaped by doubling them.
 */
export function sanitiseFts5Query(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '""';

  return tokens
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' ');
}

/**
 * Search documents. Mode is chosen by `options.search_type`:
 *
 * - `'fulltext'` (default): FTS5 over `sections_fts` with structural
 *   re-ranking (heading boost, depth penalty, breadcrumb boost).
 * - `'semantic'`: kNN over the sqlite-vec `vec_sections` index using
 *   `options.query_embedding`. Skips re-ranking — pure vector distance.
 * - `'hybrid'`: union of fulltext + semantic, re-ranked by an even
 *   blend of the normalised scores.
 *
 * The vector path requires `query_embedding` to be set. When semantic is
 * requested without an embedding (caller misconfiguration, or the
 * sqlite-vec extension failed to load and there are no rows in
 * `vec_sections`), the function returns an empty array silently — agents
 * should treat it as "no semantic match" rather than an error.
 */
export function searchDocuments(
  db: Database.Database,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const search_type: SearchType = options.search_type ?? 'fulltext';

  if (search_type === 'fulltext') {
    return fulltextSearch(db, query, options);
  }
  if (search_type === 'semantic') {
    return semanticSearch(db, options);
  }
  return hybridSearch(db, query, options);
}

function fulltextSearch(
  db: Database.Database,
  query: string,
  options: SearchOptions,
): SearchResult[] {
  const { scope, section_filter, max_results = 10, include_context = true } = options;

  const ftsQuery = sanitiseFts5Query(query);

  let sql = `
    SELECT
      file_path,
      section_heading,
      section_path,
      section_level,
      snippet(sections_fts, 4, '>>>', '<<<', '...', 40) as snippet,
      rank,
      line_start,
      line_end
    FROM sections_fts
    WHERE sections_fts MATCH ?
  `;

  const params: unknown[] = [ftsQuery];

  if (scope) {
    sql += ` AND file_path GLOB ?`;
    params.push(scope.includes('*') ? scope : `${scope}*`);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(max_results * 3);

  const rows = db.prepare(sql).all(...params) as Array<{
    file_path: string;
    section_heading: string;
    section_path: string;
    section_level: number;
    snippet: string;
    rank: number;
    line_start: number;
    line_end: number;
  }>;

  let filtered = rows;
  if (section_filter) {
    filtered = rows.filter((row) =>
      micromatch.isMatch(row.section_heading, section_filter) ||
      micromatch.isMatch(row.section_path, `*${section_filter}*`),
    );
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = filtered.map((row) => {
    let score = -row.rank;

    const headingLower = row.section_heading.toLowerCase();
    const headingMatchCount = queryTerms.filter((t) => headingLower.includes(t)).length;
    if (headingMatchCount > 0) {
      score *= 1.0 + headingMatchCount * 0.5;
    }

    score *= 1.0 - row.section_level * 0.05;

    const pathLower = row.section_path.toLowerCase();
    const breadcrumbMatchCount = queryTerms.filter((t) => pathLower.includes(t)).length;
    if (breadcrumbMatchCount > 0 && headingMatchCount === 0) {
      score *= 1.0 + breadcrumbMatchCount * 0.2;
    }

    const breadcrumb = row.section_path.split(' > ');

    return {
      file: row.file_path,
      section_path: row.section_path,
      section_heading: row.section_heading,
      section_level: row.section_level,
      snippet: include_context ? row.snippet : '',
      score,
      line_start: row.line_start ?? 0,
      line_end: row.line_end ?? 0,
      breadcrumb,
    } satisfies SearchResult;
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max_results);
}

function semanticSearch(
  db: Database.Database,
  options: SearchOptions,
): SearchResult[] {
  if (!options.query_embedding) return [];
  const { scope, section_filter, max_results = 10, include_context = true } = options;

  let rows;
  try {
    rows = vectorSearch(db, options.query_embedding, max_results * 3, scope);
  } catch {
    // sqlite-vec failed (extension missing or query corrupt) — degrade gracefully.
    return [];
  }

  let filtered = rows;
  if (section_filter) {
    filtered = rows.filter((row) =>
      micromatch.isMatch(row.section_heading, section_filter) ||
      micromatch.isMatch(row.section_path, `*${section_filter}*`),
    );
  }

  // Convert vec0 distance (lower = closer) to a score (higher = better) so
  // it composes the same way fulltext score does. Use 1 / (1 + distance)
  // so the score is bounded in (0, 1].
  return filtered.slice(0, max_results).map((row) => ({
    file: row.file_path,
    section_path: row.section_path,
    section_heading: row.section_heading,
    section_level: row.section_level,
    snippet: include_context ? '' : '', // vector hits don't carry snippets
    score: 1 / (1 + row.distance),
    line_start: row.line_start,
    line_end: row.line_end,
    breadcrumb: row.section_path.split(' > '),
  } satisfies SearchResult));
}

function hybridSearch(
  db: Database.Database,
  query: string,
  options: SearchOptions,
): SearchResult[] {
  const max_results = options.max_results ?? 10;

  // Pull each candidate set with a wider window so the blend has room to
  // re-rank. The downstream slice still respects max_results.
  const ftsResults = fulltextSearch(db, query, { ...options, max_results: max_results * 2 });
  const semResults = semanticSearch(db, { ...options, max_results: max_results * 2 });

  const ftsMax = ftsResults.reduce((m, r) => Math.max(m, r.score), 0) || 1;
  const semMax = semResults.reduce((m, r) => Math.max(m, r.score), 0) || 1;

  type BlendKey = string;
  const blend = new Map<BlendKey, SearchResult>();
  const ftsScoreNorm = new Map<BlendKey, number>();
  const semScoreNorm = new Map<BlendKey, number>();

  const keyOf = (r: SearchResult): BlendKey => `${r.file}\x00${r.section_path}`;

  for (const r of ftsResults) {
    blend.set(keyOf(r), r);
    ftsScoreNorm.set(keyOf(r), r.score / ftsMax);
  }
  for (const r of semResults) {
    if (!blend.has(keyOf(r))) blend.set(keyOf(r), r);
    semScoreNorm.set(keyOf(r), r.score / semMax);
  }

  const merged: SearchResult[] = [];
  for (const [k, base] of blend) {
    const fts = ftsScoreNorm.get(k) ?? 0;
    const sem = semScoreNorm.get(k) ?? 0;
    merged.push({ ...base, score: 0.5 * fts + 0.5 * sem });
  }
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, max_results);
}

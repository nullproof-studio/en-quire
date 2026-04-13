// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import micromatch from 'micromatch';
import type { SearchResult } from '../shared/types.js';

export interface SearchOptions {
  scope?: string;
  section_filter?: string;
  max_results?: number;
  include_context?: boolean;
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
 * Search the FTS5 index with structural ranking.
 *
 * Ranking signals:
 * 1. FTS5 rank (text similarity)
 * 2. Heading match boost — if query terms appear in section heading
 * 3. Depth penalty — deeper sections penalised slightly
 * 4. Breadcrumb boost — if query terms in ancestor headings
 */
export function searchDocuments(
  db: Database.Database,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const { scope, section_filter, max_results = 10, include_context = true } = options;

  // Sanitise the query for FTS5 (handles hyphens, operators, special chars)
  const ftsQuery = sanitiseFts5Query(query);

  // Build the FTS5 query
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
  params.push(max_results * 3); // Fetch extra to allow for re-ranking and filtering

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

  // Apply section_filter (post-query, since FTS5 can't filter by heading pattern efficiently)
  let filtered = rows;
  if (section_filter) {
    filtered = rows.filter((row) =>
      micromatch.isMatch(row.section_heading, section_filter) ||
      micromatch.isMatch(row.section_path, `*${section_filter}*`),
    );
  }

  // Re-rank with structural signals
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = filtered.map((row) => {
    let score = -row.rank; // FTS5 rank is negative (closer to 0 = better)

    // Heading match boost
    const headingLower = row.section_heading.toLowerCase();
    const headingMatchCount = queryTerms.filter((t) => headingLower.includes(t)).length;
    if (headingMatchCount > 0) {
      score *= 1.0 + headingMatchCount * 0.5;
    }

    // Depth penalty
    score *= 1.0 - row.section_level * 0.05;

    // Breadcrumb boost
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

  // Sort by score descending, take top results
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max_results);
}

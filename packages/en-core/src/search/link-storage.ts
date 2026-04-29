// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import { posix } from 'node:path';
import type { RawLink } from '../document/parser-registry.js';

/**
 * Persistence layer for the cross-document link index. The schema is
 * defined in `search/schema.ts`; this module owns the resolution rules
 * that turn parser-emitted `RawLink`s into stored rows, and the cleanup
 * that keeps the index in lockstep with the FTS index.
 *
 * Resolution model:
 * - `prefixed: true` on a RawLink means the parser already produced a
 *   fully-qualified, root-prefixed path (e.g. from a frontmatter array).
 *   Stored verbatim.
 * - Otherwise the target string is treated as either a relative path
 *   (contains a `/` or starts with `.`) or a bare basename (Obsidian
 *   wiki link form). Relative paths resolve against the source file's
 *   directory; basenames match indexed files case-insensitively, with
 *   or without an `.md`/`.mdx` extension.
 * - When a basename matches multiple indexed files, the row is stored
 *   with `?` prefix so callers can surface the ambiguity rather than
 *   pretending to have resolved it.
 *
 * Resolution is best-effort against the current index state; links to
 * a target that hasn't been indexed yet are stored with a `?` prefix.
 * The next sync of the source file (mtime change → re-index) re-resolves.
 */

interface ResolvedTarget {
  target_file: string;
  target_section: string | null;
}

function listIndexedPaths(db: Database.Database): string[] {
  const rows = db.prepare('SELECT file_path FROM index_metadata').all() as Array<{ file_path: string }>;
  return rows.map((r) => r.file_path);
}

function matchByBasename(target: string, indexed: string[]): string[] {
  const wanted = target.toLowerCase().replace(/\.(md|mdx)$/, '');
  const matches = new Set<string>();
  for (const path of indexed) {
    const base = posix.basename(path).toLowerCase().replace(/\.(md|mdx)$/, '');
    if (base === wanted) matches.add(path);
  }
  return [...matches];
}

function resolveTarget(
  db: Database.Database,
  sourcePath: string,
  link: RawLink,
): ResolvedTarget {
  if (link.prefixed) {
    return { target_file: link.target_path, target_section: link.target_section };
  }

  const target = link.target_path;
  const indexed = listIndexedPaths(db);

  // Relative or root-anchored path — has a `/` or a leading `.`
  if (target.includes('/') || target.startsWith('.')) {
    const sourceDir = posix.dirname(sourcePath);
    const resolved = posix.normalize(posix.join(sourceDir, target));
    if (indexed.includes(resolved)) {
      return { target_file: resolved, target_section: link.target_section };
    }
    // Path-shaped but not indexed — store with `?` so callers can flag.
    return { target_file: `?${resolved}`, target_section: link.target_section };
  }

  // Bare basename — Obsidian-style wiki target
  const matches = matchByBasename(target, indexed);
  if (matches.length === 1) {
    return { target_file: matches[0], target_section: link.target_section };
  }
  // 0 or >1 matches — store the literal with a `?` prefix.
  return { target_file: `?${target}`, target_section: link.target_section };
}

/**
 * Replace all link rows for `sourcePath` with the resolved form of `links`.
 * Called from `indexDocument`; runs inside the caller's transaction.
 */
export function storeLinks(
  db: Database.Database,
  sourcePath: string,
  links: RawLink[],
): void {
  db.prepare('DELETE FROM doc_links WHERE source_file = ?').run(sourcePath);

  if (links.length === 0) return;

  const insertStmt = db.prepare(
    `INSERT INTO doc_links
       (source_file, source_section, target_file, target_section, relationship, context, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const link of links) {
    const { target_file, target_section } = resolveTarget(db, sourcePath, link);
    insertStmt.run(
      sourcePath,
      link.source_section,
      target_file,
      target_section,
      link.relationship,
      link.context,
      now,
    );
  }
}

/** Remove every link row sourced from `sourcePath`. Called from `removeFromIndex`. */
export function removeLinks(db: Database.Database, sourcePath: string): void {
  db.prepare('DELETE FROM doc_links WHERE source_file = ?').run(sourcePath);
}

/**
 * Re-resolve `?`-prefixed (unresolved) rows globally — across every
 * source root, not just the one currently syncing. Cross-root links
 * are common (a skill in `agents/` references an SOP in `docs/`), and
 * filtering by source root would leave the docs-side row stale until
 * docs is itself re-synced. The scan is cheap (rows tagged `?` are
 * the only candidates and most are indexed by an inequality already)
 * and idempotent, so re-running per-root is a no-op once everything
 * resolves.
 *
 * Returns the count of rows successfully promoted from `?<target>` to
 * a resolved path.
 */
export function resolveStaleLinks(db: Database.Database): number {
  let resolved = 0;
  const indexed = db.prepare('SELECT file_path FROM index_metadata').all() as Array<{ file_path: string }>;
  const indexedSet = new Set(indexed.map((r) => r.file_path));

  // Path-shaped unresolved rows — target after `?` contains `/`.
  const pathRows = db.prepare(
    `SELECT id, target_file FROM doc_links
     WHERE target_file LIKE '?%' AND target_file LIKE '%/%'`,
  ).all() as Array<{ id: number; target_file: string }>;
  const updateStmt = db.prepare('UPDATE doc_links SET target_file = ? WHERE id = ?');
  for (const row of pathRows) {
    const path = row.target_file.slice(1);
    if (indexedSet.has(path)) {
      updateStmt.run(path, row.id);
      resolved++;
    }
  }

  // Wiki-shaped unresolved rows — bare basename, no `/` after `?`.
  const wikiRows = db.prepare(
    `SELECT id, target_file FROM doc_links
     WHERE target_file LIKE '?%' AND target_file NOT LIKE '%/%'`,
  ).all() as Array<{ id: number; target_file: string }>;
  if (wikiRows.length > 0) {
    const indexedList = [...indexedSet];
    for (const row of wikiRows) {
      const wanted = row.target_file.slice(1).toLowerCase().replace(/\.(md|mdx)$/, '');
      const matches = indexedList.filter((path) => {
        const base = posix.basename(path).toLowerCase().replace(/\.(md|mdx)$/, '');
        return base === wanted;
      });
      if (matches.length === 1) {
        updateStmt.run(matches[0], row.id);
        resolved++;
      }
    }
  }

  return resolved;
}

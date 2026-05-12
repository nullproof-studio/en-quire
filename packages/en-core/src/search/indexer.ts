// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import type { SectionNode } from '../shared/types.js';
import { flattenTree, getSectionPath } from '../document/section-tree.js';
import type { RawLink } from '../document/parser-registry.js';
import { storeLinks, removeLinks } from './link-storage.js';
import { removeEmbeddingsForFile } from './vector-store.js';

/**
 * Index all sections of a document into the FTS5 table.
 * Deletes existing entries for the file first (full re-index per file).
 *
 * `links` semantics — three-way:
 *   - `undefined`: doc_links rows for this file are LEFT ALONE. Use this
 *     when the caller intends to update links separately (e.g. syncIndex
 *     defers link storage until all index_metadata is populated so
 *     resolution sees the complete file set).
 *   - `[]`: existing rows are CLEARED, no new rows inserted.
 *   - `RawLink[]`: existing rows are cleared and replaced with the
 *     extracted set; the result is in lockstep with FTS in the same
 *     transaction.
 */
export function indexDocument(
  db: Database.Database,
  filePath: string,
  tree: SectionNode[],
  markdown: string,
  mtimeMs?: number,
  links?: RawLink[],
): void {
  const deleteStmt = db.prepare('DELETE FROM sections_fts WHERE file_path = ?');
  const insertStmt = db.prepare(`
    INSERT INTO sections_fts (file_path, section_heading, section_path, section_level, body_content, line_start, line_end)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const metaStmt = db.prepare(`
    INSERT OR REPLACE INTO index_metadata (file_path, mtime_ms, indexed_at)
    VALUES (?, ?, ?)
  `);

  const flat = flattenTree(tree);

  const runIndex = db.transaction(() => {
    deleteStmt.run(filePath);

    for (const node of flat) {
      const bodyContent = markdown.slice(node.bodyStartOffset, node.bodyEndOffset).trim();
      const sectionPath = getSectionPath(node);

      // Compute line numbers from character offsets
      const lineStart = node.heading.position?.start?.line ?? 0;
      const sectionEndStr = markdown.slice(0, node.sectionEndOffset);
      const lineEnd = sectionEndStr.split('\n').length;

      insertStmt.run(
        filePath,
        node.heading.text,
        sectionPath,
        node.heading.level,
        bodyContent,
        lineStart,
        lineEnd,
      );
    }

    // If there are no headings, index the whole document as a single entry
    if (flat.length === 0 && markdown.trim().length > 0) {
      const totalLines = markdown.split('\n').length;
      insertStmt.run(filePath, '', filePath, 0, markdown.trim(), 1, totalLines);
    }

    metaStmt.run(filePath, mtimeMs ?? Date.now(), new Date().toISOString());

    if (links !== undefined) {
      storeLinks(db, filePath, links);
    }
  });

  runIndex();
}

/**
 * Remove a document from every index — FTS5, metadata, link index, and
 * the optional sqlite-vec vector index. Also downgrades incoming
 * `doc_links` rows that pointed AT this file: their `target_file` is
 * tagged with the unresolved `?` prefix so consumers (doc_references,
 * doc_referenced_by, doc_context_bundle) report a broken link instead
 * of one that looks resolved but points at nothing. The vec call is a
 * no-op when semantic search is disabled or the extension wasn't loaded.
 *
 * Centralising the downgrade here means every removal path — sync's
 * vanished-on-disk pass, doc_rename, doc_delete — gets the same
 * incoming-link cleanup without each having to remember it.
 */
export function removeFromIndex(db: Database.Database, filePath: string): void {
  // Downgrade incoming references first, while target_file still equals
  // the un-prefixed path. Doing it after the FTS / metadata deletes
  // would still work (doc_links is not joined to either), but pulling
  // the order forward keeps the function trivially safe to reorder.
  db.prepare(
    `UPDATE doc_links SET target_file = '?' || target_file WHERE target_file = ?`,
  ).run(filePath);

  db.prepare('DELETE FROM sections_fts WHERE file_path = ?').run(filePath);
  db.prepare('DELETE FROM index_metadata WHERE file_path = ?').run(filePath);
  removeLinks(db, filePath);
  removeEmbeddingsForFile(db, filePath);
}

/**
 * Get the indexed modification time for a file.
 * Returns null if not indexed.
 */
export function getIndexedMtime(db: Database.Database, filePath: string): number | null {
  const row = db.prepare('SELECT mtime_ms FROM index_metadata WHERE file_path = ?').get(filePath) as
    | { mtime_ms: number }
    | undefined;
  return row?.mtime_ms ?? null;
}

/**
 * Get count of indexed files.
 */
export function getIndexedCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(DISTINCT file_path) as count FROM index_metadata').get() as { count: number };
  return row.count;
}

/**
 * Get the set of all indexed file paths.
 */
export function getIndexedFiles(db: Database.Database): string[] {
  const rows = db.prepare('SELECT file_path FROM index_metadata').all() as Array<{ file_path: string }>;
  return rows.map((r) => r.file_path);
}

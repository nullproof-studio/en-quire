// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import type { SectionNode } from '../shared/types.js';
import { flattenTree, getSectionPath } from '../document/section-tree.js';

/**
 * Index all sections of a document into the FTS5 table.
 * Deletes existing entries for the file first (full re-index per file).
 */
export function indexDocument(
  db: Database.Database,
  filePath: string,
  tree: SectionNode[],
  markdown: string,
  mtimeMs?: number,
): void {
  const deleteStmt = db.prepare('DELETE FROM sections_fts WHERE file_path = ?');
  const insertStmt = db.prepare(`
    INSERT INTO sections_fts (file_path, section_heading, section_path, section_level, body_content)
    VALUES (?, ?, ?, ?, ?)
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

      insertStmt.run(
        filePath,
        node.heading.text,
        sectionPath,
        node.heading.level,
        bodyContent,
      );
    }

    // If there are no headings, index the whole document as a single entry
    if (flat.length === 0 && markdown.trim().length > 0) {
      insertStmt.run(filePath, '', filePath, 0, markdown.trim());
    }

    metaStmt.run(filePath, mtimeMs ?? Date.now(), new Date().toISOString());
  });

  runIndex();
}

/**
 * Remove a document from the search index.
 */
export function removeFromIndex(db: Database.Database, filePath: string): void {
  db.prepare('DELETE FROM sections_fts WHERE file_path = ?').run(filePath);
  db.prepare('DELETE FROM index_metadata WHERE file_path = ?').run(filePath);
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

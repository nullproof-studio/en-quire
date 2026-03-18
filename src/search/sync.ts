// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { listMarkdownFiles, readDocument } from '../shared/file-utils.js';
import { parseMarkdown } from '../document/parser.js';
import { buildSectionTree } from '../document/section-tree.js';
import { indexDocument, removeFromIndex } from './indexer.js';

/** Default number of files to index per transaction batch. */
const BATCH_SIZE = 500;

export interface SyncResult {
  indexed: number;
  skipped: number;
  removed: number;
  elapsed_ms: number;
}

/**
 * Synchronise the search index with the document root.
 * Re-indexes files that have changed since they were last indexed.
 * Removes files from the index that no longer exist.
 *
 * Optimised for large document roots (100k+ files):
 * - Bulk-loads all indexed mtimes into a Map (single query, no per-file lookups)
 * - Batches index writes into transactions of BATCH_SIZE files
 * - Reports elapsed time for observability
 */
export function syncIndex(
  db: Database.Database,
  documentRoot: string,
  batchSize: number = BATCH_SIZE,
): SyncResult {
  const start = performance.now();

  const files = listMarkdownFiles(documentRoot);
  let indexed = 0;
  let skipped = 0;
  let removed = 0;

  // Bulk-load all indexed mtimes in a single query
  const indexedMtimes = new Map<string, number>(
    (db.prepare('SELECT file_path, mtime_ms FROM index_metadata').all() as Array<{ file_path: string; mtime_ms: number }>)
      .map((row) => [row.file_path, row.mtime_ms]),
  );

  // Collect files that need (re-)indexing
  const toIndex: Array<{ file: string; absolutePath: string; mtime: number }> = [];
  const fileSet = new Set<string>();

  for (const file of files) {
    fileSet.add(file);
    const absolutePath = join(documentRoot, file);
    let mtime: number;
    try {
      mtime = statSync(absolutePath).mtimeMs;
    } catch {
      continue;
    }

    const lastIndexed = indexedMtimes.get(file);
    if (lastIndexed !== undefined && lastIndexed >= mtime) {
      skipped++;
      continue;
    }

    toIndex.push({ file, absolutePath, mtime });
  }

  // Index in batched transactions
  for (let i = 0; i < toIndex.length; i += batchSize) {
    const batch = toIndex.slice(i, i + batchSize);

    const runBatch = db.transaction(() => {
      for (const { file, mtime } of batch) {
        try {
          const { content } = readDocument(documentRoot, file);
          const ast = parseMarkdown(content);
          const tree = buildSectionTree(ast, content);
          indexDocument(db, file, tree, content, mtime);
          indexed++;
        } catch {
          // Skip files that can't be parsed (encoding errors, etc.)
          skipped++;
        }
      }
    });

    runBatch();
  }

  // Remove files from index that no longer exist on disk
  const toRemove: string[] = [];
  for (const [filePath] of indexedMtimes) {
    if (!fileSet.has(filePath)) {
      toRemove.push(filePath);
    }
  }

  if (toRemove.length > 0) {
    const runRemove = db.transaction(() => {
      for (const filePath of toRemove) {
        removeFromIndex(db, filePath);
        removed++;
      }
    });

    runRemove();
  }

  const elapsed_ms = Math.round(performance.now() - start);
  return { indexed, skipped, removed, elapsed_ms };
}

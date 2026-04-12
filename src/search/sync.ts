// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { listDocumentFiles, readDocument } from '../shared/file-utils.js';
import { parserRegistry } from '../document/parser-registry.js';
import { indexDocument, removeFromIndex } from './indexer.js';
import { getLogger } from '../shared/logger.js';

/** Default number of files to index per transaction batch. */
const BATCH_SIZE = 500;

export interface SyncResult {
  indexed: number;
  skipped: number;
  removed: number;
  elapsed_ms: number;
}

/**
 * Synchronise the search index for a single document root.
 *
 * File paths are stored in the index with a rootName prefix
 * (e.g. "codex/article.md") so cross-root search works via
 * file_path GLOB 'rootName/*'.
 *
 * Optimised for large document roots (100k+ files):
 * - Bulk-loads all indexed mtimes into a Map (single query, no per-file lookups)
 * - Batches index writes into transactions of BATCH_SIZE files
 * - Reports elapsed time for observability
 */
export function syncIndex(
  db: Database.Database,
  rootName: string,
  documentRoot: string,
  batchSize: number = BATCH_SIZE,
): SyncResult {
  const start = performance.now();
  const prefix = rootName + '/';

  let files: string[];
  try {
    files = listDocumentFiles(documentRoot);
  } catch (err) {
    const log = getLogger();
    log.warn('Index sync skipped — cannot scan root', {
      root: rootName,
      path: documentRoot,
      error: String(err),
    });
    const elapsed_ms = Math.round(performance.now() - start);
    return { indexed: 0, skipped: 0, removed: 0, elapsed_ms };
  }

  let indexed = 0;
  let skipped = 0;
  let removed = 0;

  // Bulk-load indexed mtimes for this root only (prefixed paths)
  const allMtimes = db.prepare('SELECT file_path, mtime_ms FROM index_metadata').all() as Array<{ file_path: string; mtime_ms: number }>;
  const indexedMtimes = new Map<string, number>(
    allMtimes
      .filter((row) => row.file_path.startsWith(prefix))
      .map((row) => [row.file_path, row.mtime_ms]),
  );

  // Collect files that need (re-)indexing
  const toIndex: Array<{ file: string; prefixedPath: string; absolutePath: string; mtime: number }> = [];
  const prefixedFileSet = new Set<string>();

  for (const file of files) {
    const prefixedPath = prefix + file;
    prefixedFileSet.add(prefixedPath);
    const absolutePath = join(documentRoot, file);
    let mtime: number;
    try {
      mtime = statSync(absolutePath).mtimeMs;
    } catch {
      continue;
    }

    const lastIndexed = indexedMtimes.get(prefixedPath);
    if (lastIndexed !== undefined && lastIndexed >= mtime) {
      skipped++;
      continue;
    }

    toIndex.push({ file, prefixedPath, absolutePath, mtime });
  }

  // Index in batched transactions
  for (let i = 0; i < toIndex.length; i += batchSize) {
    const batch = toIndex.slice(i, i + batchSize);

    const runBatch = db.transaction(() => {
      for (const { file, prefixedPath, mtime } of batch) {
        try {
          const { content } = readDocument(documentRoot, file);
          const parser = parserRegistry.getParser(file);
          const tree = parser.parse(content);
          indexDocument(db, prefixedPath, tree, content, mtime);
          indexed++;
        } catch {
          // Skip files that can't be parsed (encoding errors, etc.)
          skipped++;
        }
      }
    });

    runBatch();
  }

  // Remove files from index that no longer exist on disk (for this root)
  const toRemove: string[] = [];
  for (const [filePath] of indexedMtimes) {
    if (!prefixedFileSet.has(filePath)) {
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

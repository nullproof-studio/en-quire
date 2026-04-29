// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { listDocumentFiles, readDocument } from '../shared/file-utils.js';
import { parserRegistry } from '../document/parser-registry.js';
import { indexDocument, removeFromIndex } from './indexer.js';
import { storeLinks, resolveStaleLinks } from './link-storage.js';
import { getLogger } from '../shared/logger.js';
import type { SectionNode } from '../shared/types.js';
import type { RawLink } from '../document/parser-registry.js';
import type { EmbeddingsClient } from './embeddings.js';
import { upsertEmbedding, removeEmbeddingsForFile } from './vector-store.js';
import { flattenTree, getSectionPath } from '../document/section-tree.js';

/** Default number of files to index per transaction batch. */
const BATCH_SIZE = 500;
/** Default number of section bodies sent per embeddings request. */
const EMBED_BATCH_SIZE = 32;
/** Skip empty / near-empty bodies for embeddings — they don't carry signal. */
const MIN_BODY_CHARS_FOR_EMBED = 16;

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

  // Index in batched transactions.
  // Critical: read + parse OUTSIDE the transaction so the WAL write lock is
  // only held while the actual SQL inserts run. Holding the lock during disk
  // I/O starves other writers (see #49).
  //
  // Link storage is DEFERRED to a second pass after every batch finishes:
  // resolveTarget needs to see every file in the root (in `index_metadata`)
  // before it can correctly resolve cross-file references. Resolving
  // per-file inline produces order-dependent `?`-tagged unresolved rows
  // that, because the next sync skips unchanged sources by mtime, never
  // get re-resolved.
  const linkBacklog: Array<{ prefixedPath: string; links: RawLink[] }> = [];

  for (let i = 0; i < toIndex.length; i += batchSize) {
    const batch = toIndex.slice(i, i + batchSize);

    // Phase 1 — read + parse (no lock held)
    const prepared: Array<{
      prefixedPath: string;
      tree: SectionNode[];
      content: string;
      mtime: number;
      links: RawLink[];
    }> = [];
    for (const { file, prefixedPath, mtime } of batch) {
      try {
        const { content } = readDocument(documentRoot, file);
        const parser = parserRegistry.getParser(file);
        const tree = parser.parse(content);
        const links = parser.extractLinks?.(content) ?? [];
        prepared.push({ prefixedPath, tree, content, mtime, links });
      } catch {
        // Skip files that can't be parsed (encoding errors, etc.)
        skipped++;
      }
    }

    // Phase 2 — SQL inserts only (lock held briefly).
    // Pass `links: undefined` so indexDocument doesn't touch doc_links;
    // we collect them for the deferred Phase 3 below.
    const runBatch = db.transaction(() => {
      for (const p of prepared) {
        indexDocument(db, p.prefixedPath, p.tree, p.content, p.mtime, undefined);
        linkBacklog.push({ prefixedPath: p.prefixedPath, links: p.links });
        indexed++;
      }
    });
    runBatch();
  }

  // Phase 2.5 — remove files no longer on disk BEFORE link operations.
  // Order matters: if a target file was deleted, every doc_links row
  // pointing at it should be downgraded to `?<path>` so doc_references
  // / doc_referenced_by / doc_context_bundle report a broken link
  // instead of a resolved-looking path that doesn't exist. Doing the
  // removal after Phase 3 would leave incoming rows looking valid
  // until the next sync — too long a window of "looks fine, isn't".
  const toRemove: string[] = [];
  for (const [filePath] of indexedMtimes) {
    if (!prefixedFileSet.has(filePath)) {
      toRemove.push(filePath);
    }
  }
  if (toRemove.length > 0) {
    const runRemove = db.transaction(() => {
      for (const filePath of toRemove) {
        // Downgrade incoming-reference rows to `?<filePath>` first —
        // outgoing rows are dropped wholesale by removeFromIndex's
        // delete-by-source clause, which is correct (the source no
        // longer exists), but incoming rows are sourced from OTHER
        // files that ARE still around and need their target_file
        // re-tagged.
        db.prepare(
          `UPDATE doc_links SET target_file = '?' || target_file WHERE target_file = ?`,
        ).run(filePath);
        removeFromIndex(db, filePath);
        removed++;
      }
    });
    runRemove();
  }

  // Phase 3 — deferred link storage. Every file processed this run is
  // now in `index_metadata`, and every file present from a previous sync
  // (mtime-skipped above) is also in `index_metadata`. resolveTarget
  // therefore sees the complete file set for the root and produces
  // resolved targets where the per-file inline path produced `?`-tagged
  // unresolved rows.
  if (linkBacklog.length > 0) {
    const runLinks = db.transaction(() => {
      for (const entry of linkBacklog) {
        storeLinks(db, entry.prefixedPath, entry.links);
      }
    });
    runLinks();
  }

  // Phase 3.5 — re-resolve `?`-tagged rows GLOBALLY (across every source
  // root). Cross-root references are common — a skill in `agents/` links
  // to an SOP in `docs/` — so a per-root scan would leave the docs-side
  // row stale when only the agents root is the one being synced. The
  // scan is idempotent and cheap; running it on every per-root sync is
  // a no-op once everything resolves.
  const runResolveStale = db.transaction(() => {
    resolveStaleLinks(db);
  });
  runResolveStale();

  const elapsed_ms = Math.round(performance.now() - start);
  return { indexed, skipped, removed, elapsed_ms };
}

export interface EmbedSyncResult {
  embedded: number;
  skipped: number;
  errors: number;
  elapsed_ms: number;
}

/**
 * Populate the sqlite-vec index for a document root. Run AFTER `syncIndex`
 * has refreshed the FTS index — this function reads the same files,
 * re-parses, and embeds each section that has enough body text to be
 * worth indexing.
 *
 * Embedding requests are batched (default 32 inputs per request); the
 * upserts themselves run inside a single SQLite transaction per file.
 * Failures on individual batches are logged and counted but don't abort
 * the run — half a populated index is more useful than none.
 */
export async function syncEmbeddings(
  db: Database.Database,
  rootName: string,
  documentRoot: string,
  embeddings: EmbeddingsClient,
  embedBatchSize: number = EMBED_BATCH_SIZE,
): Promise<EmbedSyncResult> {
  const log = getLogger();
  const start = performance.now();
  const prefix = rootName + '/';

  let files: string[];
  try {
    files = listDocumentFiles(documentRoot);
  } catch (err) {
    log.warn('Embedding sync skipped — cannot scan root', {
      root: rootName,
      path: documentRoot,
      error: String(err),
    });
    return { embedded: 0, skipped: 0, errors: 0, elapsed_ms: Math.round(performance.now() - start) };
  }

  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  // Drop stale embeddings for files that no longer exist on disk.
  const onDisk = new Set(files.map((f) => prefix + f));
  const knownEmbedded = db.prepare(
    `SELECT DISTINCT file_path FROM vec_section_meta WHERE file_path LIKE ?`,
  ).all(`${prefix}%`) as Array<{ file_path: string }>;
  for (const { file_path } of knownEmbedded) {
    if (!onDisk.has(file_path)) {
      removeEmbeddingsForFile(db, file_path);
    }
  }

  // Phase 1 — parse + collect every embeddable section across all files.
  type Pending = {
    prefixedPath: string;
    sectionPath: string;
    heading: string;
    level: number;
    line_start: number;
    line_end: number;
    body: string;
  };
  const pending: Pending[] = [];

  // Track every on-disk file we successfully parsed (regardless of whether
  // any of its sections cleared the embed threshold). The vec rows for
  // these files are pre-emptively cleared in Phase 1.5 so renamed,
  // deleted, or trimmed-below-threshold sections don't leave stale
  // searchable vectors behind.
  const filesProcessed = new Set<string>();

  for (const file of files) {
    const prefixedPath = prefix + file;
    let content: string;
    try {
      const result = readDocument(documentRoot, file);
      content = result.content;
    } catch {
      skipped++;
      continue;
    }
    let tree: SectionNode[];
    try {
      const parser = parserRegistry.getParser(file);
      tree = parser.parse(content);
    } catch {
      skipped++;
      continue;
    }
    filesProcessed.add(prefixedPath);
    const flat = flattenTree(tree);
    for (const node of flat) {
      const body = content.slice(node.bodyStartOffset, node.bodyEndOffset).trim();
      if (body.length < MIN_BODY_CHARS_FOR_EMBED) {
        skipped++;
        continue;
      }
      pending.push({
        prefixedPath,
        sectionPath: getSectionPath(node),
        heading: node.heading.text,
        level: node.heading.level,
        line_start: node.heading.position?.start.line ?? 0,
        line_end: content.slice(0, node.sectionEndOffset).split('\n').length,
        body,
      });
    }
  }

  // Phase 1.5 — clear old embeddings for every file we just parsed.
  // Without this, sections that were renamed, removed, or shortened below
  // the embed threshold remain queryable via stale vectors even though
  // they no longer exist in the document. The brief gap between this
  // clear and the upsert in Phase 2 is acceptable for a startup-only
  // sync; the trade is correctness over uninterrupted query results.
  if (filesProcessed.size > 0) {
    const runClear = db.transaction(() => {
      for (const filePath of filesProcessed) {
        removeEmbeddingsForFile(db, filePath);
      }
    });
    runClear();
  }

  // Phase 2 — embed in batches, upsert results.
  for (let i = 0; i < pending.length; i += embedBatchSize) {
    const batch = pending.slice(i, i + embedBatchSize);
    let vectors: Float32Array[];
    try {
      vectors = await embeddings.embedBatch(batch.map((p) => p.body));
    } catch (err) {
      log.warn('Embedding batch failed — skipping batch', {
        root: rootName,
        batch_index: i,
        size: batch.length,
        error: err instanceof Error ? err.message : String(err),
      });
      errors += batch.length;
      continue;
    }
    if (vectors.length !== batch.length) {
      log.warn('Embedding batch returned wrong count — skipping', {
        expected: batch.length, got: vectors.length,
      });
      errors += batch.length;
      continue;
    }
    const runUpsert = db.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        const p = batch[j];
        upsertEmbedding(db, {
          file_path: p.prefixedPath,
          section_path: p.sectionPath,
          section_heading: p.heading,
          section_level: p.level,
          line_start: p.line_start,
          line_end: p.line_end,
        }, vectors[j]);
        embedded++;
      }
    });
    runUpsert();
  }

  return { embedded, skipped, errors, elapsed_ms: Math.round(performance.now() - start) };
}

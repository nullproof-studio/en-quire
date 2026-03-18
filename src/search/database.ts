// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { initSearchSchema } from './schema.js';

const DB_FILENAME = '.enquire.db';

/**
 * Open (or create) the SQLite database for search indexing.
 */
export function openDatabase(documentRoot: string): Database.Database {
  const dbPath = join(documentRoot, DB_FILENAME);
  const db = new Database(dbPath);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64 MB page cache (negative = kibibytes)
  db.pragma('mmap_size = 268435456'); // 256 MB memory-mapped I/O
  db.pragma('temp_store = MEMORY'); // Keep temp tables in memory

  initSearchSchema(db);

  return db;
}

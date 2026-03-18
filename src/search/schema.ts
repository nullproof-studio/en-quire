// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';

/**
 * Initialise the search index schema (FTS5 + metadata tables).
 */
export function initSearchSchema(db: Database.Database): void {
  // FTS5 virtual table for section-level full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
      file_path,
      section_heading,
      section_path,
      section_level UNINDEXED,
      body_content,
      tokenize='porter unicode61'
    );
  `);

  // Metadata table for tracking indexed file modification times
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      file_path TEXT PRIMARY KEY,
      mtime_ms INTEGER NOT NULL,
      indexed_at TEXT NOT NULL
    );
  `);

  // Audit log for doc_exec calls
  db.exec(`
    CREATE TABLE IF NOT EXISTS exec_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caller TEXT NOT NULL,
      command TEXT NOT NULL,
      working_dir TEXT,
      stdout TEXT,
      stderr TEXT,
      exit_code INTEGER,
      timestamp TEXT NOT NULL
    );
  `);
}

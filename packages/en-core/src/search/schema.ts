// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';

/**
 * Initialise the search index schema (FTS5 + metadata tables).
 */
export function initSearchSchema(db: Database.Database): void {
  // Migrate FTS5 schema if it predates the line_start/line_end columns.
  // FTS5 tables can't be ALTERed — drop and recreate. The index is fully
  // rebuildable from documents, so this is safe (triggers a full re-sync).
  migrateSearchSchema(db);

  // FTS5 virtual table for section-level full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
      file_path,
      section_heading,
      section_path,
      section_level UNINDEXED,
      body_content,
      line_start UNINDEXED,
      line_end UNINDEXED,
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

  // Cross-document reference index. Derived from document content (markdown
  // links, Obsidian-style wiki links, frontmatter relationship arrays); fully
  // rebuilt on every write/sync — disposable. Powers doc_references /
  // doc_referenced_by / doc_context_bundle.
  //
  // - `source_section` is null for links that appear before the first heading
  //   (frontmatter, preamble).
  // - `target_file` may be the literal `?<unresolved>` form when a wiki link
  //   couldn't be resolved unambiguously to an indexed file basename.
  // - `target_section` is null when the link points to a whole document.
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file TEXT NOT NULL,
      source_section TEXT,
      target_file TEXT NOT NULL,
      target_section TEXT,
      relationship TEXT NOT NULL,
      context TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_doc_links_source ON doc_links(source_file, source_section);
    CREATE INDEX IF NOT EXISTS idx_doc_links_target ON doc_links(target_file, target_section);
  `);
}

/**
 * Check if the FTS5 table has the expected columns and recreate if not.
 * This handles upgrading from the pre-line-number schema.
 */
function migrateSearchSchema(db: Database.Database): void {
  // Check if the table exists at all
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sections_fts'",
  ).get();
  if (!tableExists) return; // Will be created by the caller

  // Check column count — the new schema has 7 columns (added line_start, line_end)
  // FTS5 tables don't support pragma table_info, so we probe with a known column count
  try {
    db.prepare('SELECT line_start FROM sections_fts LIMIT 0').run();
    // Column exists — no migration needed
  } catch {
    // Column missing — drop and recreate (also clear metadata to trigger full re-index)
    db.exec('DROP TABLE IF EXISTS sections_fts');
    db.exec('DELETE FROM index_metadata');
  }
}

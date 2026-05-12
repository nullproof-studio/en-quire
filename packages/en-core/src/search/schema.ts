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

  // Citation registry. Stores agent-supplied inputs (already canonicalised by
  // the fetch layer) plus server-computed values: hash, allocated number, and
  // verify timestamps. By design no fetched content (titles, snippets, source
  // text) lands here — that would re-introduce stored-prompt-injection
  // surface. status ∈ {'verified','warning'}; warning_code ∈
  // {'numeric_truncation','boundary_warning','formatting_difference', NULL}.
  //
  // - target_file is null for cites without auto-append; concurrent
  //   null-target allocations use the sentinel '__null__' inside the
  //   allocateAndInsert transaction so MAX(citation_number) is well-defined.
  // - The partial unique index gives idempotency: re-citing the same
  //   (target_file, source_hash, quote_text) returns the existing row unless
  //   the caller passes force:true.
  db.exec(`
    CREATE TABLE IF NOT EXISTS citations (
      citation_id        TEXT PRIMARY KEY,
      target_file        TEXT,
      citation_number    INTEGER NOT NULL,
      source_uri         TEXT NOT NULL,
      source_scheme      TEXT NOT NULL,
      source_hash        TEXT NOT NULL,
      quote_text         TEXT NOT NULL,
      quote_offset       INTEGER NOT NULL,
      quote_line         INTEGER NOT NULL,
      status             TEXT NOT NULL,
      warning_code       TEXT,
      caller_id          TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      last_verified_at   TEXT,
      last_verified_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_citations_target ON citations(target_file, citation_number);
    CREATE INDEX IF NOT EXISTS idx_citations_source ON citations(source_uri);
    -- Dedupe lookup index (not UNIQUE: force:true intentionally allows multiple
    -- rows for the same target/source/quote tuple; deduplication is enforced
    -- in registry.ts inside the allocateAndInsert transaction).
    CREATE INDEX IF NOT EXISTS idx_citations_dedupe
      ON citations(target_file, source_hash, quote_text);
  `);

  // Cite audit log — one row per cite attempt, success or denied. Distinct
  // from exec_audit_log so cite traffic doesn't drown out exec audit and can
  // be queried independently. canonical_path may already be redacted (e.g.
  // '/api/[secret-pattern:openai-key]') when secret-pattern detection fired:
  // the matched segment is replaced before persistence so the audit log does
  // not become a database of exfiltrated secrets.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cite_audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_id       TEXT NOT NULL,
      target_file     TEXT,
      source_scheme   TEXT NOT NULL,
      canonical_host  TEXT,
      canonical_path  TEXT,
      status          TEXT NOT NULL,
      reason          TEXT,
      citation_id     TEXT,
      source_hash     TEXT,
      timestamp       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cite_audit_caller_time ON cite_audit_log(caller_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_cite_audit_host ON cite_audit_log(canonical_host, timestamp);
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

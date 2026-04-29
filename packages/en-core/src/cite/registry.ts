// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';

export type CitationStatus = 'verified' | 'warning';
export type CitationWarningCode =
  | 'numeric_truncation'
  | 'boundary_warning'
  | 'formatting_difference'
  | null;
export type CitationSourceScheme = 'https' | 'http' | 'file' | 'enquire' | 'pdf';

export interface CitationRecord {
  citation_id: string;
  target_file: string | null;
  citation_number: number;
  source_uri: string;
  source_scheme: string;
  source_hash: string;
  quote_text: string;
  quote_offset: number;
  quote_line: number;
  status: CitationStatus;
  warning_code: CitationWarningCode;
  caller_id: string;
  created_at: string;
  last_verified_at: string | null;
  last_verified_hash: string | null;
}

export interface AllocateCitationArgs {
  target_file: string | null;
  source_uri: string;
  source_scheme: string;
  source_hash: string;
  quote_text: string;
  quote_offset: number;
  quote_line: number;
  status: CitationStatus;
  warning_code: CitationWarningCode;
  caller_id: string;
  /** Bypass dedupe — always allocate a new number. Default false. */
  force?: boolean;
}

const NULL_TARGET_SENTINEL = '__null__';

/**
 * Allocate a per-target sequential citation_number and insert a row, atomic
 * under the sqlite write lock so concurrent calls don't collide on MAX(...).
 *
 * Dedupe: if a row already exists for the same (target_file, source_hash,
 * quote_text) and force is not set, the existing row is returned and no new
 * number is allocated. target_file null bypasses dedupe (the partial unique
 * index excludes null targets).
 */
export function allocateAndInsertCitation(
  db: Database.Database,
  args: AllocateCitationArgs,
): CitationRecord {
  const tx = db.transaction((): CitationRecord => {
    if (!args.force && args.target_file !== null) {
      const existing = getCitationByDedupeUnsafe(
        db,
        args.target_file,
        args.source_hash,
        args.quote_text,
      );
      if (existing) return existing;
    }

    const numberingTarget = args.target_file ?? NULL_TARGET_SENTINEL;
    const next = db.prepare(
      `SELECT COALESCE(MAX(citation_number), 0) + 1 AS n
         FROM citations
         WHERE COALESCE(target_file, ?) = ?`,
    ).get(NULL_TARGET_SENTINEL, numberingTarget) as { n: number };
    const citation_number = next.n;

    // citation_id is globally unique across all target_files — derived from
    // sqlite's monotonic rowid sequence. citation_number is the per-target
    // value that appears in the reference line; citation_id is the opaque
    // handle used by doc_cite_verify and the registry.
    const globalSeq = (db.prepare(
      `SELECT COALESCE(MAX(rowid), 0) + 1 AS n FROM citations`,
    ).get() as { n: number }).n;
    const citation_id = `cite-${globalSeq.toString().padStart(3, '0')}`;
    const created_at = new Date().toISOString();

    db.prepare(
      `INSERT INTO citations (
         citation_id, target_file, citation_number, source_uri, source_scheme,
         source_hash, quote_text, quote_offset, quote_line, status,
         warning_code, caller_id, created_at, last_verified_at, last_verified_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      citation_id,
      args.target_file,
      citation_number,
      args.source_uri,
      args.source_scheme,
      args.source_hash,
      args.quote_text,
      args.quote_offset,
      args.quote_line,
      args.status,
      args.warning_code,
      args.caller_id,
      created_at,
    );

    return {
      citation_id,
      target_file: args.target_file,
      citation_number,
      source_uri: args.source_uri,
      source_scheme: args.source_scheme,
      source_hash: args.source_hash,
      quote_text: args.quote_text,
      quote_offset: args.quote_offset,
      quote_line: args.quote_line,
      status: args.status,
      warning_code: args.warning_code,
      caller_id: args.caller_id,
      created_at,
      last_verified_at: null,
      last_verified_hash: null,
    };
  });
  return tx.immediate();
}

export function getCitationById(
  db: Database.Database,
  citation_id: string,
): CitationRecord | null {
  const row = db.prepare(
    `SELECT * FROM citations WHERE citation_id = ?`,
  ).get(citation_id) as CitationRow | undefined;
  return row ? toRecord(row) : null;
}

export function getCitationByDedupe(
  db: Database.Database,
  target_file: string | null,
  source_hash: string,
  quote_text: string,
): CitationRecord | null {
  if (target_file === null) return null;
  return getCitationByDedupeUnsafe(db, target_file, source_hash, quote_text);
}

function getCitationByDedupeUnsafe(
  db: Database.Database,
  target_file: string,
  source_hash: string,
  quote_text: string,
): CitationRecord | null {
  const row = db.prepare(
    `SELECT * FROM citations
       WHERE target_file = ? AND source_hash = ? AND quote_text = ?`,
  ).get(target_file, source_hash, quote_text) as CitationRow | undefined;
  return row ? toRecord(row) : null;
}

export function updateCitationVerification(
  db: Database.Database,
  citation_id: string,
  current_hash: string,
  verified_at: string,
): boolean {
  const result = db.prepare(
    `UPDATE citations
        SET last_verified_at = ?, last_verified_hash = ?
        WHERE citation_id = ?`,
  ).run(verified_at, current_hash, citation_id);
  return result.changes > 0;
}

// ---------- cite_audit_log ----------

export interface CiteAuditEntry {
  caller_id: string;
  target_file: string | null;
  source_scheme: string;
  canonical_host: string | null;
  canonical_path: string | null;
  status: string;
  reason: string | null;
  citation_id: string | null;
  source_hash: string | null;
}

export interface CiteAuditRow extends CiteAuditEntry {
  id: number;
  timestamp: string;
}

export interface CiteAuditQuery {
  caller_id?: string;
  canonical_host?: string;
  status?: string;
  limit?: number;
}

export function logCiteAudit(db: Database.Database, entry: CiteAuditEntry): void {
  db.prepare(
    `INSERT INTO cite_audit_log (
       caller_id, target_file, source_scheme, canonical_host, canonical_path,
       status, reason, citation_id, source_hash, timestamp
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.caller_id,
    entry.target_file,
    entry.source_scheme,
    entry.canonical_host,
    entry.canonical_path,
    entry.status,
    entry.reason,
    entry.citation_id,
    entry.source_hash,
    new Date().toISOString(),
  );
}

export function queryCiteAudit(db: Database.Database, q: CiteAuditQuery = {}): CiteAuditRow[] {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (q.caller_id) {
    filters.push('caller_id = ?');
    params.push(q.caller_id);
  }
  if (q.canonical_host) {
    filters.push('canonical_host = ?');
    params.push(q.canonical_host);
  }
  if (q.status) {
    filters.push('status = ?');
    params.push(q.status);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const limit = q.limit ?? 100;
  return db.prepare(
    `SELECT * FROM cite_audit_log ${where} ORDER BY timestamp DESC, id DESC LIMIT ?`,
  ).all(...params, limit) as CiteAuditRow[];
}

// ---------- internal mappers ----------

interface CitationRow {
  citation_id: string;
  target_file: string | null;
  citation_number: number;
  source_uri: string;
  source_scheme: string;
  source_hash: string;
  quote_text: string;
  quote_offset: number;
  quote_line: number;
  status: string;
  warning_code: string | null;
  caller_id: string;
  created_at: string;
  last_verified_at: string | null;
  last_verified_hash: string | null;
}

function toRecord(row: CitationRow): CitationRecord {
  return {
    citation_id: row.citation_id,
    target_file: row.target_file,
    citation_number: row.citation_number,
    source_uri: row.source_uri,
    source_scheme: row.source_scheme,
    source_hash: row.source_hash,
    quote_text: row.quote_text,
    quote_offset: row.quote_offset,
    quote_line: row.quote_line,
    status: row.status as CitationStatus,
    warning_code: (row.warning_code ?? null) as CitationWarningCode,
    caller_id: row.caller_id,
    created_at: row.created_at,
    last_verified_at: row.last_verified_at,
    last_verified_hash: row.last_verified_hash,
  };
}

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initSearchSchema,
  allocateAndInsertCitation,
  getCitationById,
  getCitationByDedupe,
  updateCitationVerification,
  logCiteAudit,
  queryCiteAudit,
} from '@nullproof-studio/en-core';

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initSearchSchema(db);
});

describe('allocateAndInsertCitation — numbering', () => {
  it('allocates citation_number starting at 1 per target_file', () => {
    const a = allocateAndInsertCitation(db, {
      target_file: 'docs/profile.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https',
      source_hash: HASH_A,
      quote_text: 'first',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    expect(a.citation_number).toBe(1);

    const b = allocateAndInsertCitation(db, {
      target_file: 'docs/profile.md',
      source_uri: 'https://x.test/b',
      source_scheme: 'https',
      source_hash: HASH_B,
      quote_text: 'second',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    expect(b.citation_number).toBe(2);
  });

  it('numbers are independent per target_file', () => {
    const a = allocateAndInsertCitation(db, {
      target_file: 'docs/one.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https',
      source_hash: HASH_A,
      quote_text: 'q',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    const b = allocateAndInsertCitation(db, {
      target_file: 'docs/two.md',
      source_uri: 'https://x.test/b',
      source_scheme: 'https',
      source_hash: HASH_B,
      quote_text: 'q',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    expect(a.citation_number).toBe(1);
    expect(b.citation_number).toBe(1);
  });

  it('numbers null-target cites independently of named-target cites', () => {
    const named = allocateAndInsertCitation(db, {
      target_file: 'docs/profile.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https',
      source_hash: HASH_A,
      quote_text: 'q',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    const unnamed = allocateAndInsertCitation(db, {
      target_file: null,
      source_uri: 'https://x.test/b',
      source_scheme: 'https',
      source_hash: HASH_B,
      quote_text: 'q',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    expect(named.citation_number).toBe(1);
    expect(unnamed.citation_number).toBe(1);
  });

  it('returns a populated CitationRecord on insert', () => {
    const r = allocateAndInsertCitation(db, {
      target_file: 'docs/p.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https',
      source_hash: HASH_A,
      quote_text: 'hello',
      quote_offset: 12,
      quote_line: 3,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    expect(r.citation_id).toMatch(/^cite-\d+$/);
    expect(r.citation_number).toBe(1);
    expect(r.target_file).toBe('docs/p.md');
    expect(r.source_hash).toBe(HASH_A);
    expect(r.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('allocateAndInsertCitation — dedupe', () => {
  it('returns the existing row for the same (target_file, source_hash, quote_text)', () => {
    const args = {
      target_file: 'docs/p.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https' as const,
      source_hash: HASH_A,
      quote_text: 'same quote',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified' as const,
      warning_code: null,
      caller_id: 'agent-a',
    };
    const first = allocateAndInsertCitation(db, args);
    const second = allocateAndInsertCitation(db, args);
    expect(second.citation_id).toBe(first.citation_id);
    expect(second.citation_number).toBe(first.citation_number);
  });

  it('force:true allocates a new number even on dedupe-hit', () => {
    const args = {
      target_file: 'docs/p.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https' as const,
      source_hash: HASH_A,
      quote_text: 'same quote',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified' as const,
      warning_code: null,
      caller_id: 'agent-a',
    };
    const first = allocateAndInsertCitation(db, args);
    const second = allocateAndInsertCitation(db, { ...args, force: true });
    expect(second.citation_id).not.toBe(first.citation_id);
    expect(second.citation_number).toBe(2);
  });

  it('does not dedupe when target_file is null', () => {
    const args = {
      target_file: null,
      source_uri: 'https://x.test/a',
      source_scheme: 'https' as const,
      source_hash: HASH_A,
      quote_text: 'same quote',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified' as const,
      warning_code: null,
      caller_id: 'agent-a',
    };
    const first = allocateAndInsertCitation(db, args);
    const second = allocateAndInsertCitation(db, args);
    // Different rows because the partial unique index excludes target_file IS NULL
    expect(second.citation_id).not.toBe(first.citation_id);
    expect(second.citation_number).toBe(2);
  });
});

describe('getCitationById / getCitationByDedupe', () => {
  it('round-trips a row by citation_id', () => {
    const inserted = allocateAndInsertCitation(db, {
      target_file: 'docs/p.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https',
      source_hash: HASH_A,
      quote_text: 'q',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    const fetched = getCitationById(db, inserted.citation_id);
    expect(fetched).not.toBeNull();
    expect(fetched?.citation_id).toBe(inserted.citation_id);
    expect(fetched?.source_uri).toBe('https://x.test/a');
  });

  it('returns null for unknown citation_id', () => {
    expect(getCitationById(db, 'cite-nope')).toBeNull();
  });

  it('finds an existing row by dedupe key', () => {
    const inserted = allocateAndInsertCitation(db, {
      target_file: 'docs/p.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https',
      source_hash: HASH_A,
      quote_text: 'q',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    const found = getCitationByDedupe(db, 'docs/p.md', HASH_A, 'q');
    expect(found?.citation_id).toBe(inserted.citation_id);
  });

  it('returns null for null target_file dedupe lookup (no dedupe applies)', () => {
    expect(getCitationByDedupe(db, null, HASH_A, 'q')).toBeNull();
  });
});

describe('updateCitationVerification', () => {
  it('sets last_verified_at and last_verified_hash on an existing row', () => {
    const inserted = allocateAndInsertCitation(db, {
      target_file: 'docs/p.md',
      source_uri: 'https://x.test/a',
      source_scheme: 'https',
      source_hash: HASH_A,
      quote_text: 'q',
      quote_offset: 0,
      quote_line: 1,
      status: 'verified',
      warning_code: null,
      caller_id: 'agent-a',
    });
    updateCitationVerification(db, inserted.citation_id, HASH_A, '2026-04-29T10:00:00.000Z');
    const row = getCitationById(db, inserted.citation_id);
    expect(row?.last_verified_at).toBe('2026-04-29T10:00:00.000Z');
    expect(row?.last_verified_hash).toBe(HASH_A);
  });

  it('is a no-op for an unknown citation_id (returns false)', () => {
    expect(updateCitationVerification(db, 'cite-nope', HASH_A, '2026-04-29T10:00:00.000Z')).toBe(false);
  });
});

describe('cite_audit_log', () => {
  it('records a successful https cite', () => {
    logCiteAudit(db, {
      caller_id: 'agent-a',
      target_file: 'docs/p.md',
      source_scheme: 'https',
      canonical_host: 'forbes.com',
      canonical_path: '/articles/x',
      status: 'verified',
      reason: null,
      citation_id: 'cite-1',
      source_hash: HASH_A,
    });
    const rows = queryCiteAudit(db, { limit: 10 });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('verified');
    expect(rows[0].canonical_host).toBe('forbes.com');
    expect(rows[0].citation_id).toBe('cite-1');
  });

  it('records a denied attempt with citation_id null', () => {
    logCiteAudit(db, {
      caller_id: 'agent-a',
      target_file: null,
      source_scheme: 'https',
      canonical_host: 'attacker.test',
      canonical_path: '/x',
      status: 'blocked',
      reason: 'allowlist_miss',
      citation_id: null,
      source_hash: null,
    });
    const rows = queryCiteAudit(db, { limit: 10 });
    expect(rows[0].status).toBe('blocked');
    expect(rows[0].reason).toBe('allowlist_miss');
    expect(rows[0].citation_id).toBeNull();
  });

  it('records a local cite with no host', () => {
    logCiteAudit(db, {
      caller_id: 'agent-a',
      target_file: 'docs/p.md',
      source_scheme: 'enquire',
      canonical_host: null,
      canonical_path: 'testing/foo.md',
      status: 'verified',
      reason: null,
      citation_id: 'cite-2',
      source_hash: HASH_B,
    });
    const rows = queryCiteAudit(db, { limit: 10 });
    expect(rows[0].source_scheme).toBe('enquire');
    expect(rows[0].canonical_host).toBeNull();
  });

  it('records a rate_limited attempt so probes are observable', () => {
    logCiteAudit(db, {
      caller_id: 'agent-a',
      target_file: null,
      source_scheme: 'https',
      canonical_host: 'forbes.com',
      canonical_path: '/x',
      status: 'rate_limited',
      reason: 'rate_limit_exceeded',
      citation_id: null,
      source_hash: null,
    });
    const rows = queryCiteAudit(db, { limit: 10 });
    expect(rows[0].status).toBe('rate_limited');
  });

  it('orders results newest-first and filters by caller', () => {
    const stmt = db.prepare(
      `INSERT INTO cite_audit_log (caller_id, target_file, source_scheme, canonical_host, canonical_path, status, reason, citation_id, source_hash, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run('agent-a', null, 'https', 'a.test', '/1', 'verified', null, 'cite-1', HASH_A, '2026-04-25T10:00:00.000Z');
    stmt.run('agent-b', null, 'https', 'b.test', '/2', 'verified', null, 'cite-2', HASH_A, '2026-04-26T10:00:00.000Z');
    stmt.run('agent-a', null, 'https', 'a.test', '/3', 'verified', null, 'cite-3', HASH_A, '2026-04-27T10:00:00.000Z');

    const aRows = queryCiteAudit(db, { caller_id: 'agent-a', limit: 10 });
    expect(aRows.map((r) => r.citation_id)).toEqual(['cite-3', 'cite-1']);
  });
});

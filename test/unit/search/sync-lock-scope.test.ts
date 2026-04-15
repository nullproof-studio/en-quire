// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initSearchSchema } from '../../../src/search/schema.js';
import '../../../src/document/markdown-parser.js';

// Track whether readDocument is called while the db is in a transaction.
// Invariant under test: during index sync, disk I/O + parsing must NOT happen
// inside a write transaction, because that holds the WAL write lock for the
// duration of the I/O and starves other writers.
// See: nullproof-studio/en-quire#49 — production stall observed when a doc_create
// landed while a large background sync held the write lock for slow disk I/O.

const readCallsInTransaction: boolean[] = [];
let currentDb: Database.Database | null = null;

vi.mock('../../../src/shared/file-utils.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/shared/file-utils.js')>(
    '../../../src/shared/file-utils.js',
  );
  return {
    ...actual,
    readDocument: (root: string, relative: string) => {
      readCallsInTransaction.push(currentDb?.inTransaction ?? false);
      return actual.readDocument(root, relative);
    },
  };
});

// Import AFTER vi.mock so sync.ts picks up the mocked readDocument
const { syncIndex } = await import('../../../src/search/sync.js');

let db: Database.Database;
let rootDir: string;

beforeEach(() => {
  db = new Database(':memory:');
  initSearchSchema(db);
  currentDb = db;
  readCallsInTransaction.length = 0;
  rootDir = mkdtempSync(join(tmpdir(), 'enquire-sync-lock-'));

  // Seed with enough files to force batching (BATCH_SIZE default is 500, but
  // we pass a small batchSize to force multiple transactions)
  mkdirSync(rootDir, { recursive: true });
  for (let i = 0; i < 30; i++) {
    writeFileSync(join(rootDir, `doc-${i}.md`), `# Doc ${i}\n\nBody content for doc ${i}.\n`);
  }
});

afterEach(() => {
  currentDb = null;
  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});

describe('syncIndex lock-hold scope', () => {
  it('does not call readDocument while holding a write transaction', () => {
    // Use small batchSize to exercise multiple transactions — if the old code
    // is wrong, readDocument will be called inside each transaction.
    syncIndex(db, 'test', rootDir, 5);

    expect(readCallsInTransaction.length).toBeGreaterThan(0);
    const violations = readCallsInTransaction.filter(x => x === true).length;
    expect(violations).toBe(0);
  });
});

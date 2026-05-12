// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  initSearchSchema,
  loadVectorExtension,
  initVectorSchema,
  syncEmbeddings,
  EmbeddingsClient,
} from '@nullproof-studio/en-core';
import '../../../../en-quire/src/parsers/markdown-parser.js';

const DIM = 4;
let workRoot: string;
let docsRoot: string;
let db: Database.Database;
let vectorOk = false;

beforeAll(async () => {
  const probe = new Database(':memory:');
  vectorOk = (await loadVectorExtension(probe)).loaded;
  probe.close();
});

/**
 * Stub embeddings client whose `embedBatch` returns deterministic vectors
 * derived from the inputs — sidesteps the network without us having to
 * stand up a mock server for every test.
 */
class FakeEmbeddings extends EmbeddingsClient {
  constructor() {
    super({ endpoint: 'http://stub/v1', model: 'stub' });
  }
  async embed(): Promise<Float32Array> {
    return new Float32Array([1, 0, 0, 0]);
  }
  async embedBatch(inputs: string[]): Promise<Float32Array[]> {
    return inputs.map((s, i) => new Float32Array([s.length % 10, i % 10, 0, 0]));
  }
}

beforeEach(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'sync-embed-'));
  docsRoot = join(workRoot, 'docs');
  mkdirSync(docsRoot, { recursive: true });
  db = new Database(':memory:');
  initSearchSchema(db);
  if (vectorOk) {
    await loadVectorExtension(db);
    initVectorSchema(db, DIM);
  }
});

afterEach(() => {
  db.close();
  rmSync(workRoot, { recursive: true, force: true });
});

function listVecRows(): Array<{ file_path: string; section_path: string }> {
  return db.prepare(
    `SELECT file_path, section_path FROM vec_section_meta ORDER BY file_path, section_path`,
  ).all() as Array<{ file_path: string; section_path: string }>;
}

describe('syncEmbeddings — stale-vector cleanup', () => {
  it('removes vec rows for sections that were renamed in the source', async () => {
    if (!vectorOk) return;

    const file = join(docsRoot, 'doc.md');
    writeFileSync(file,
      '# Title\n\n## Foo\n\nFoo body that is long enough to embed.\n\n## Bar\n\nBar body that is long enough to embed.\n');
    const client = new FakeEmbeddings();

    await syncEmbeddings(db, 'docs', docsRoot, client);
    let rows = listVecRows();
    expect(rows.map((r) => r.section_path).sort()).toEqual([
      'Title > Bar', 'Title > Foo',
    ]);

    // Rename Foo → Quux. Bar is unchanged.
    writeFileSync(file,
      '# Title\n\n## Quux\n\nFoo body that is long enough to embed.\n\n## Bar\n\nBar body that is long enough to embed.\n');
    await syncEmbeddings(db, 'docs', docsRoot, client);
    rows = listVecRows();
    expect(rows.map((r) => r.section_path).sort()).toEqual([
      'Title > Bar', 'Title > Quux',
    ]);
  });

  it('removes vec rows for sections deleted entirely from the source', async () => {
    if (!vectorOk) return;

    const file = join(docsRoot, 'doc.md');
    writeFileSync(file,
      '# Title\n\n## Foo\n\nFoo body that is long enough to embed.\n\n## Bar\n\nBar body that is long enough to embed.\n');
    const client = new FakeEmbeddings();
    await syncEmbeddings(db, 'docs', docsRoot, client);
    expect(listVecRows().some((r) => r.section_path === 'Title > Bar')).toBe(true);

    // Drop the Bar section entirely.
    writeFileSync(file,
      '# Title\n\n## Foo\n\nFoo body that is long enough to embed.\n');
    await syncEmbeddings(db, 'docs', docsRoot, client);
    const rows = listVecRows();
    expect(rows.some((r) => r.section_path === 'Title > Bar')).toBe(false);
    expect(rows.some((r) => r.section_path === 'Title > Foo')).toBe(true);
  });

  it('removes vec rows when a section\'s body shrinks below the embed threshold', async () => {
    if (!vectorOk) return;

    const file = join(docsRoot, 'doc.md');
    writeFileSync(file,
      '# Title\n\n## Foo\n\nFoo body that is long enough to embed.\n');
    const client = new FakeEmbeddings();
    await syncEmbeddings(db, 'docs', docsRoot, client);
    expect(listVecRows().some((r) => r.section_path === 'Title > Foo')).toBe(true);

    // Shrink Foo's body to <16 chars (below MIN_BODY_CHARS_FOR_EMBED).
    writeFileSync(file, '# Title\n\n## Foo\n\nshort.\n');
    await syncEmbeddings(db, 'docs', docsRoot, client);
    const rows = listVecRows();
    expect(rows.some((r) => r.section_path === 'Title > Foo')).toBe(false);
  });
});

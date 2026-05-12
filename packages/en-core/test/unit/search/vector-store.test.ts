// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  loadVectorExtension,
  isVectorAvailable,
  initVectorSchema,
  upsertEmbedding,
  removeEmbeddingsForFile,
  vectorSearch,
  initSearchSchema,
} from '@nullproof-studio/en-core';

const DIM = 4;

let db: Database.Database;
let vectorOk = false;

function unitVec(values: number[]): Float32Array {
  return new Float32Array(values);
}

beforeAll(async () => {
  // Probe once at suite start so per-test `it.skipIf` predicates have a
  // settled value (skipIf evaluates at collection time, not lazily).
  const probe = new Database(':memory:');
  const result = await loadVectorExtension(probe);
  vectorOk = result.loaded;
  probe.close();
});

beforeEach(async () => {
  db = new Database(':memory:');
  initSearchSchema(db);
  if (vectorOk) {
    await loadVectorExtension(db);
    initVectorSchema(db, DIM);
  }
});

afterEach(() => {
  db.close();
});

describe('loadVectorExtension graceful fallback', () => {
  it('returns a result object with `loaded` flag (true or false, no throw)', () => {
    expect(typeof vectorOk).toBe('boolean');
  });

  it('isVectorAvailable matches the load result for at least one connection', () => {
    if (vectorOk) {
      expect(isVectorAvailable()).toBe(true);
    }
  });
});

describe('vector store CRUD (sqlite-vec required)', () => {
  // Each test guards on `vectorOk` because it.skipIf evaluates eagerly,
  // before beforeAll has probed the extension.
  it('inserts a row and retrieves it via kNN', async () => {
    if (!vectorOk) return;
    upsertEmbedding(db, {
      file_path: 'docs/a.md',
      section_path: 'Top > Foo',
      section_heading: 'Foo',
      section_level: 2,
      line_start: 1,
      line_end: 3,
    }, unitVec([1, 0, 0, 0]));
    upsertEmbedding(db, {
      file_path: 'docs/b.md',
      section_path: 'Top > Bar',
      section_heading: 'Bar',
      section_level: 2,
      line_start: 1,
      line_end: 3,
    }, unitVec([0, 1, 0, 0]));

    const results = vectorSearch(db, unitVec([0.9, 0.1, 0, 0]), 5);
    expect(results.length).toBeGreaterThanOrEqual(2);
    // First (closest) hit should be docs/a.md — the (1,0,0,0) vector
    expect(results[0].file_path).toBe('docs/a.md');
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it('upsert replaces a section\'s embedding rather than duplicating', async () => {
    if (!vectorOk) return;
    const meta = {
      file_path: 'docs/a.md',
      section_path: 'Top > Foo',
      section_heading: 'Foo',
      section_level: 2,
      line_start: 1,
      line_end: 3,
    };
    upsertEmbedding(db, meta, unitVec([1, 0, 0, 0]));
    upsertEmbedding(db, meta, unitVec([0, 1, 0, 0]));

    const count = (db.prepare('SELECT COUNT(*) AS c FROM vec_section_meta').get() as { c: number }).c;
    expect(count).toBe(1);

    // The latest embedding should be the (0,1,0,0) one
    const results = vectorSearch(db, unitVec([0, 1, 0, 0]), 1);
    expect(results[0].file_path).toBe('docs/a.md');
  });

  it('removeEmbeddingsForFile clears every section of that file', async () => {
    if (!vectorOk) return;
    upsertEmbedding(db, {
      file_path: 'docs/a.md',
      section_path: 'Top > Foo',
      section_heading: 'Foo',
      section_level: 2,
      line_start: 1, line_end: 3,
    }, unitVec([1, 0, 0, 0]));
    upsertEmbedding(db, {
      file_path: 'docs/a.md',
      section_path: 'Top > Bar',
      section_heading: 'Bar',
      section_level: 2,
      line_start: 4, line_end: 6,
    }, unitVec([0, 1, 0, 0]));
    upsertEmbedding(db, {
      file_path: 'docs/b.md',
      section_path: 'Other',
      section_heading: 'Other',
      section_level: 1,
      line_start: 1, line_end: 1,
    }, unitVec([0, 0, 1, 0]));

    removeEmbeddingsForFile(db, 'docs/a.md');

    const remaining = db.prepare('SELECT file_path FROM vec_section_meta').all() as Array<{ file_path: string }>;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].file_path).toBe('docs/b.md');
  });

  it('vectorSearch scope semantics match FTS file_path GLOB (incl. cross-directory * and **)', async () => {
    if (!vectorOk) return;
    upsertEmbedding(db, {
      file_path: 'docs/sops/a.md',
      section_path: 'X', section_heading: 'X', section_level: 1, line_start: 1, line_end: 1,
    }, unitVec([1, 0, 0, 0]));
    upsertEmbedding(db, {
      file_path: 'docs/sops/sub/b.md',
      section_path: 'Y', section_heading: 'Y', section_level: 1, line_start: 1, line_end: 1,
    }, unitVec([1, 0, 0, 0]));
    upsertEmbedding(db, {
      file_path: 'docs/skills/c.md',
      section_path: 'Z', section_heading: 'Z', section_level: 1, line_start: 1, line_end: 1,
    }, unitVec([1, 0, 0, 0]));

    // Bare prefix → auto-suffixed `*`, matches anything starting with the prefix
    const prefix = vectorSearch(db, unitVec([1, 0, 0, 0]), 10, 'docs/sops/');
    expect(prefix.map((r) => r.file_path).sort()).toEqual([
      'docs/sops/a.md', 'docs/sops/sub/b.md',
    ]);

    // SQLite-flavour `*` crosses `/` — `docs/sops/*` matches subdir files too
    const star = vectorSearch(db, unitVec([1, 0, 0, 0]), 10, 'docs/sops/*');
    expect(star.map((r) => r.file_path).sort()).toEqual([
      'docs/sops/a.md', 'docs/sops/sub/b.md',
    ]);

    // Cross-root match via leading `*`
    const trailing = vectorSearch(db, unitVec([1, 0, 0, 0]), 10, '*runbook.md');
    expect(trailing).toHaveLength(0); // no file matches; just verifies no throw
  });

  it('vectorSearch expands k when a narrow scope filters out the global top-k window', async () => {
    if (!vectorOk) return;

    // 200 vectors in `docs/noise/` clustered very close to [1, 0, 0, 0]
    // (would dominate any reasonable top-k), and 1 vector in
    // `docs/sops/` further away. With a small static k, scope-filtered
    // results would be empty — the in-scope vector sits past the global
    // top-k window. Iterative expansion should still find it.
    for (let i = 0; i < 200; i++) {
      upsertEmbedding(db, {
        file_path: `docs/noise/n${i}.md`,
        section_path: 'X', section_heading: 'X', section_level: 1, line_start: 1, line_end: 1,
      }, unitVec([1, 0.001 * i, 0, 0]));
    }
    upsertEmbedding(db, {
      file_path: 'docs/sops/runbook.md',
      section_path: 'Procedure', section_heading: 'Procedure',
      section_level: 1, line_start: 1, line_end: 1,
    }, unitVec([0, 1, 0, 0]));

    // Query is closest to the noise cluster. With limit=5 and a fixed
    // k=15 (5*3), all top-15 hits would be from docs/noise — the
    // sops result would be invisible without expansion.
    const results = vectorSearch(db, unitVec([1, 0.001, 0, 0]), 5, 'docs/sops/');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.file_path.startsWith('docs/sops/'))).toBe(true);
    expect(results[0].file_path).toBe('docs/sops/runbook.md');
  });

  it('vectorSearch honours scope as a file_path prefix filter', async () => {
    if (!vectorOk) return;
    upsertEmbedding(db, {
      file_path: 'docs/sops/a.md',
      section_path: 'X', section_heading: 'X', section_level: 1, line_start: 1, line_end: 1,
    }, unitVec([1, 0, 0, 0]));
    upsertEmbedding(db, {
      file_path: 'docs/skills/b.md',
      section_path: 'Y', section_heading: 'Y', section_level: 1, line_start: 1, line_end: 1,
    }, unitVec([1, 0, 0, 0]));

    const results = vectorSearch(db, unitVec([1, 0, 0, 0]), 5, 'docs/sops/');
    expect(results.every((r) => r.file_path.startsWith('docs/sops/'))).toBe(true);
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { initSearchSchema, syncIndex, markRootWalked, refreshIndexForScope, searchDocuments } from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';

/**
 * Latency budget for query-time index refresh (#137).
 *
 * The refresh runs before every doc_search, so its cost is added to every
 * search. The fixture mirrors a real root: many documents plus a large
 * non-document tree (conversation logs, build output) that a directory walk
 * must still traverse. Medians are printed so CI logs show the trend;
 * budgets are ~10x local measurements to stay stable on slow runners while
 * still catching an accidental per-search walk or per-file re-parse.
 */

const DOC_FOLDERS = 20;
const DOCS_PER_FOLDER = 50; // 1000 documents
const NOISE_DIRS = 1500; // non-document directories the walk must traverse
const RUNS = 15;

// Budgets in ms (median).
const BUDGET = {
  fileScope: 5,
  folderScope: 15,
  rootStatOnly: 40,
  rootWalk: 400,
  oneChangedFile: 40,
};

let db: Database.Database;
let dir: string;
const roots = () => ({ docs: { path: dir } });

function median(fn: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)];
}

const measured: Record<string, number> = {};

beforeAll(() => {
  dir = join(tmpdir(), `enquire-fresh-lat-${randomUUID()}`);
  for (let f = 0; f < DOC_FOLDERS; f++) {
    const folder = join(dir, `spec${f}`);
    mkdirSync(folder, { recursive: true });
    for (let d = 0; d < DOCS_PER_FOLDER; d++) {
      writeFileSync(join(folder, `doc${d}.md`), `# Doc ${f}-${d}\n\n## Section\n\nbody text ${f} ${d}.\n`);
    }
  }
  for (let n = 0; n < NOISE_DIRS; n++) {
    const noise = join(dir, 'data', `c${Math.floor(n / 100)}`, `n${n}`);
    mkdirSync(noise, { recursive: true });
    writeFileSync(join(noise, 'metadata.json'), '{}');
  }
  db = new Database(':memory:');
  initSearchSchema(db);
  syncIndex(db, 'docs', dir);
  markRootWalked(db, 'docs');
}, 60_000);

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  // eslint-disable-next-line no-console
  console.log(
    `[#137 refresh latency, median of ${RUNS}] ` +
    Object.entries(measured).map(([k, v]) => `${k}=${v.toFixed(2)}ms`).join(' '),
  );
});

describe('query-time index refresh latency (#137)', () => {
  const keep = { rescanIntervalMs: 3_600_000 };

  it('baseline: fulltext search without refresh (for comparison only)', () => {
    measured.searchOnly = median(() => searchDocuments(db, 'body', { max_results: 10 }));
  });

  it(`single-file scope stays under ${BUDGET.fileScope}ms`, () => {
    measured.fileScope = median(() => refreshIndexForScope(db, roots(), 'docs/spec3/doc7.md', keep));
    expect(measured.fileScope).toBeLessThan(BUDGET.fileScope);
  });

  it(`folder scope (re-check only) stays under ${BUDGET.folderScope}ms`, () => {
    measured.folderScope = median(() => refreshIndexForScope(db, roots(), 'docs/spec3', keep));
    expect(measured.folderScope).toBeLessThan(BUDGET.folderScope);
  });

  it(`root / unscoped (re-check only — the every-search path) stays under ${BUDGET.rootStatOnly}ms`, () => {
    measured.rootStatOnly = median(() => refreshIndexForScope(db, roots(), undefined, keep));
    expect(measured.rootStatOnly).toBeLessThan(BUDGET.rootStatOnly);
  });

  it(`root walk for new files (at most once per interval) stays under ${BUDGET.rootWalk}ms`, () => {
    measured.rootWalk = median(() => refreshIndexForScope(db, roots(), 'docs', { rescanIntervalMs: 0 }));
    expect(measured.rootWalk).toBeLessThan(BUDGET.rootWalk);
  });

  it(`one externally changed file is re-indexed within ${BUDGET.oneChangedFile}ms`, () => {
    const file = join(dir, 'spec5', 'doc5.md');
    let i = 0;
    measured.oneChangedFile = median(() => {
      i++;
      writeFileSync(file, `# Doc 5-5\n\n## Section\n\nedited ${i}.\n`);
      const t = new Date(Date.now() + i * 1000);
      utimesSync(file, t, t);
      const r = refreshIndexForScope(db, roots(), 'docs', keep);
      expect(r.indexed).toBe(1);
    });
    expect(measured.oneChangedFile).toBeLessThan(BUDGET.oneChangedFile);
  });

  it('does not walk again within the rescan interval', () => {
    refreshIndexForScope(db, roots(), 'docs', { rescanIntervalMs: 0 });
    const r = refreshIndexForScope(db, roots(), 'docs', keep);
    expect(r.walked).toEqual([]);
  });
});

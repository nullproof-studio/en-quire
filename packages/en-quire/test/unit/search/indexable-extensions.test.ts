// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolContext, ResolvedConfig, CallerIdentity, RootContext } from '@nullproof-studio/en-core';
import { initSearchSchema, syncIndex, getIndexedFiles, GitOperations } from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';
import '../../../src/parsers/yaml-parser.js';
import '../../../src/parsers/jsonl-parser.js';
import { handleDocStatus } from '../../../src/tools/status/doc-status.js';

// #146 — the set of indexed formats comes from the parser registry
// (fullTextIndex capability), shared by syncIndex and doc_status.

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'enquire-indexable-'));
  db = new Database(':memory:');
  initSearchSchema(db);
  writeFileSync(join(dir, 'a.md'), '# A\n\nalpha.\n');
  writeFileSync(join(dir, 'b.yaml'), 'name: b\n');
  writeFileSync(join(dir, 'c.jsonl'), '{"id":1}\n');
  writeFileSync(join(dir, 'd.ndjson'), '{"id":2}\n');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(): ToolContext {
  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } } },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false }, refresh_on_search: true, rescan_interval_ms: 30_000 },
    logging: { console: 'error' }, callers: {}, require_read_before_write: false,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes: [{ path: '**', permissions: ['read', 'write', 'search'] }] };
  const roots: Record<string, RootContext> = { docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) } };
  return { config, roots, caller, db };
}

describe('syncIndex indexes only fullTextIndex formats', () => {
  it('indexes markdown and YAML but not JSONL/NDJSON', () => {
    syncIndex(db, 'docs', dir);
    expect(getIndexedFiles(db).sort()).toEqual(['docs/a.md', 'docs/b.yaml']);
  });

  it('does not index a JSONL file named directly as the sync sub-path', () => {
    syncIndex(db, 'docs', dir, undefined, { subPath: 'c.jsonl' });
    expect(getIndexedFiles(db)).toEqual([]);
  });
});

describe('doc_status separates excluded-by-design files from unindexed (#146)', () => {
  it('reports JSONL as an excluded count, not as unindexed', async () => {
    syncIndex(db, 'docs', dir);
    writeFileSync(join(dir, 'new.md'), '# New\n\nnot indexed yet.\n');
    const res = await handleDocStatus({}, makeCtx()) as {
      unindexed: string[];
      excluded_from_index?: { count: number; by_extension: Record<string, number>; reason: string };
    };
    expect(res.unindexed).toEqual(['docs/new.md']);
    expect(res.excluded_from_index?.count).toBe(2);
    expect(res.excluded_from_index?.by_extension).toEqual({ '.jsonl': 1, '.ndjson': 1 });
    expect(res.excluded_from_index?.reason).toMatch(/doc_read_section/);
  });

  it('omits excluded_from_index when there is nothing excluded', async () => {
    rmSync(join(dir, 'c.jsonl'));
    rmSync(join(dir, 'd.ndjson'));
    syncIndex(db, 'docs', dir);
    const res = await handleDocStatus({}, makeCtx()) as { unindexed: string[]; excluded_from_index?: unknown };
    expect(res.unindexed).toEqual([]);
    expect(res.excluded_from_index).toBeUndefined();
  });
});

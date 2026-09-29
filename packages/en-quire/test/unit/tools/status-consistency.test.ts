// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
// Register all en-quire parsers (md/mdx/yaml/jsonl) — this is what the real
// bin does, so parserRegistry.supportedExtensions() gives us the full set.
import '../../../src/parsers/markdown-parser.js';
import '../../../src/parsers/yaml-parser.js';
import '../../../src/parsers/jsonl-parser.js';
import type {
  ToolContext,
  ResolvedConfig,
  CallerIdentity,
  RootContext,
} from '@nullproof-studio/en-core';
import {
  initSearchSchema,
  syncIndex,
  GitOperations,
  handleStatus,
} from '@nullproof-studio/en-core';

/**
 * Repro-driven test: Claude Desktop reported that `doc_status` (unscoped)
 * returned an empty `unindexed` list, while `doc_status({ scope: "testing" })`
 * correctly surfaced jsonl files under that root.
 *
 * Invariant under test: unscoped doc_status should list every unindexed file
 * across every root. Scoping to a single root should return a subset of the
 * unscoped result. Any divergence is a bug.
 *
 * The setup mirrors the reporter's layout: two roots, one with both md and
 * jsonl files, one with md only. sync() indexes md/yaml; one file per root
 * is written after the sync so each root has a genuine unindexed file.
 * JSONL/NDJSON is excluded from the index by design (#146), so it is
 * reported as a count under excluded_from_index, never under unindexed.
 */

interface TestEnv {
  ctx: ToolContext;
  db: Database.Database;
  cleanup: () => void;
}

function makeMultiRootCtx(): TestEnv {
  const root1Dir = mkdtempSync(join(tmpdir(), 'enquire-status-root1-'));
  const root2Dir = mkdtempSync(join(tmpdir(), 'enquire-status-root2-'));

  // root1: mixed md + jsonl
  writeFileSync(join(root1Dir, 'notes.md'), '# Notes\n\nBody\n');
  writeFileSync(join(root1Dir, 'chat.jsonl'), '{"role":"user","content":"hi"}\n');
  writeFileSync(join(root1Dir, 'logs.ndjson'), '{"event":"login"}\n');

  // root2: md only
  mkdirSync(join(root2Dir, 'sub'), { recursive: true });
  writeFileSync(join(root2Dir, 'readme.md'), '# Readme\n');
  writeFileSync(join(root2Dir, 'sub', 'config.yaml'), 'foo: bar\n');

  const db = new Database(':memory:');
  initSearchSchema(db);

  // Run sync on both roots — only fullTextIndex formats (md/mdx/yaml/yml)
  // are indexed, so jsonl files are deliberately skipped.
  syncIndex(db, 'docs', root1Dir, 500);
  syncIndex(db, 'configs', root2Dir, 500);

  // Written after the sync: genuine unindexed files, one per root.
  writeFileSync(join(root1Dir, 'late.md'), '# Late\n');
  writeFileSync(join(root2Dir, 'late.yaml'), 'late: true\n');

  const config: ResolvedConfig = {
    document_roots: {
      docs: { name: 'docs', path: root1Dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } },
      configs: { name: 'configs', path: root2Dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } },
    },
    database: ':memory:',
    transport: 'stdio',
    port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' },
    callers: {},
    require_read_before_write: false,
  };

  const caller: CallerIdentity = {
    id: 'test',
    scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search'] }],
  };

  const roots: Record<string, RootContext> = {
    docs: { root: config.document_roots.docs, git: new GitOperations(root1Dir, false) },
    configs: { root: config.document_roots.configs, git: new GitOperations(root2Dir, false) },
  };

  return {
    ctx: { config, roots, caller, db },
    db,
    cleanup: () => {
      db.close();
      rmSync(root1Dir, { recursive: true, force: true });
      rmSync(root2Dir, { recursive: true, force: true });
    },
  };
}

let env: TestEnv;
beforeEach(() => { env = makeMultiRootCtx(); });
afterEach(() => { env.cleanup(); });

describe('doc_status unscoped vs scoped consistency', () => {
  it('unscoped lists every unindexed file across every root', async () => {
    const result = await handleStatus({}, env.ctx) as { unindexed: string[] };
    // Only the searchable files written after the sync are unindexed.
    // JSONL/NDJSON and the already-indexed md/yaml must not appear.
    expect([...result.unindexed].sort()).toEqual(['configs/late.yaml', 'docs/late.md']);
  });

  it('reports JSONL/NDJSON as an excluded-by-design count, not as unindexed (#146)', async () => {
    const result = await handleStatus({}, env.ctx) as {
      excluded_from_index?: { count: number; by_extension: Record<string, number> };
    };
    expect(result.excluded_from_index?.count).toBe(2);
    expect(result.excluded_from_index?.by_extension).toEqual({ '.jsonl': 1, '.ndjson': 1 });
  });

  it('scoped-to-root matches the subset of the unscoped result for that root', async () => {
    const unscoped = (await handleStatus({}, env.ctx) as { unindexed: string[] }).unindexed;
    const scopedDocs = (await handleStatus({ scope: 'docs' }, env.ctx) as { unindexed: string[] }).unindexed;

    // The scoped result must be EXACTLY the docs/* slice of the unscoped result.
    // If unscoped returns [] while scoped returns docs/chat.jsonl, the handler
    // is broken.
    const expected = unscoped.filter((f) => f.startsWith('docs/')).sort();
    expect([...scopedDocs].sort()).toEqual(expected);
    expect(expected).toEqual(['docs/late.md']);
  });

  it('scoping narrows excluded_from_index to that root', async () => {
    type R = { excluded_from_index?: { count: number } };
    const docs = await handleStatus({ scope: 'docs' }, env.ctx) as R;
    const configs = await handleStatus({ scope: 'configs' }, env.ctx) as R;
    expect(docs.excluded_from_index?.count).toBe(2);
    expect(configs.excluded_from_index).toBeUndefined();
  });

  it('reports a non-zero indexed count when md/yaml files were sync\'d', async () => {
    const result = await handleStatus({}, env.ctx) as { indexed: number };
    // 3 indexed md/yaml files: docs/notes.md, configs/readme.md, configs/sub/config.yaml
    expect(result.indexed).toBe(3);
  });
});

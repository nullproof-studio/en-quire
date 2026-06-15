// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import '../../../src/parsers/markdown-parser.js';
import '../../../src/parsers/yaml-parser.js';
import '../../../src/parsers/jsonl-parser.js';
import type { ToolContext, ResolvedConfig, CallerIdentity, RootContext } from '@nullproof-studio/en-core';
import { initSearchSchema, GitOperations } from '@nullproof-studio/en-core';
import { handleDocCreate } from '../../../src/tools/write/doc-create.js';
import { handleDocAssignIds } from '../../../src/tools/write/doc-assign-ids.js';

interface TestEnv {
  ctx: ToolContext;
  dir: string;
  cleanup: () => void;
}

function makeCtx(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-anchor-'));
  const db = new Database(':memory:');
  initSearchSchema(db);

  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } } },
    database: ':memory:',
    transport: 'stdio',
    port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' },
    callers: {},
    require_read_before_write: false,
  } as unknown as ResolvedConfig;

  const caller: CallerIdentity = {
    id: 'test',
    scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search', 'exec'] }],
  };
  const roots: Record<string, RootContext> = {
    docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) },
  };

  return {
    ctx: { config, roots, caller, db },
    dir,
    cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

let env: TestEnv;
beforeEach(() => { env = makeCtx(); });
afterEach(() => { env.cleanup(); });

describe('doc_create auto-assigns anchors (markdown)', () => {
  it('writes ^id anchors onto every heading', async () => {
    await handleDocCreate({ file: 'docs/spec.md', content: '# Spec\n\n## Goals\n\nx.\n' }, env.ctx);
    const written = readFileSync(join(env.dir, 'spec.md'), 'utf-8');
    expect(written).toContain('# Spec ^spec');
    expect(written).toContain('## Goals ^goals');
  });

  it('does not touch YAML # comment lines', async () => {
    await handleDocCreate({ file: 'docs/conf.yaml', content: '# a comment\nfoo: bar\n' }, env.ctx);
    const written = readFileSync(join(env.dir, 'conf.yaml'), 'utf-8');
    expect(written).toBe('# a comment\nfoo: bar\n');
  });
});

describe('doc_assign_ids backfills anchors', () => {
  it('adds ^id to headings lacking one and reports them', async () => {
    writeFileSync(join(env.dir, 'old.md'), '# Title ^title\n\n## Background\n\nx.\n\n## Design\n\ny.\n');
    const res = await handleDocAssignIds({ file: 'docs/old.md' }, env.ctx) as {
      assigned: Array<{ id: string }>;
    };
    const written = readFileSync(join(env.dir, 'old.md'), 'utf-8');
    expect(written).toContain('# Title ^title'); // preserved
    expect(written).toContain('## Background ^background');
    expect(written).toContain('## Design ^design');
    expect(res.assigned.map((a) => a.id)).toEqual(['background', 'design']);
  });

  it('is a no-op when every heading already has an anchor', async () => {
    writeFileSync(join(env.dir, 'done.md'), '# A ^a\n\n## B ^b\n\nx.\n');
    const res = await handleDocAssignIds({ file: 'docs/done.md' }, env.ctx) as {
      assigned: unknown[]; unchanged?: boolean;
    };
    expect(res.unchanged).toBe(true);
    expect(res.assigned).toHaveLength(0);
  });

  it('rejects non-markdown documents', async () => {
    writeFileSync(join(env.dir, 'c.yaml'), 'foo: bar\n');
    await expect(handleDocAssignIds({ file: 'docs/c.yaml' }, env.ctx)).rejects.toThrow(/markdown/i);
  });
});

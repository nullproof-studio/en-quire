// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import '../../../src/parsers/markdown-parser.js';
import '../../../src/parsers/yaml-parser.js';
import '../../../src/parsers/jsonl-parser.js';
import type { ToolContext, ResolvedConfig, CallerIdentity, RootContext } from '@nullproof-studio/en-core';
import { initSearchSchema, GitOperations } from '@nullproof-studio/en-core';
import { handleDocInsertSection } from '../../../src/tools/write/doc-insert-section.js';

interface TestEnv { ctx: ToolContext; dir: string; cleanup: () => void; }

function makeCtx(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-ins-'));
  const db = new Database(':memory:');
  initSearchSchema(db);
  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } } },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' }, callers: {}, require_read_before_write: false,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search'] }] };
  const roots: Record<string, RootContext> = { docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) } };
  return { ctx: { config, roots, caller, db }, dir, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

let env: TestEnv;
beforeEach(() => { env = makeCtx(); });
afterEach(() => { env.cleanup(); });

describe('doc_insert_section recovers when content repeats the heading (#138)', () => {
  it('inserts one section and returns a warning instead of failing validation', async () => {
    writeFileSync(join(env.dir, 'd.md'), '# Doc\n\n## A\n\nContent A.\n');
    const res = await handleDocInsertSection(
      { file: 'docs/d.md', anchor: 'A', position: 'after', heading: 'New', content: '## New ^new\n\nBody.', mode: 'write' },
      env.ctx,
    ) as { success?: boolean; warnings?: string[] };
    expect(res.success).toBe(true);
    expect(res.warnings?.some((w) => w.includes('heading "New"'))).toBe(true);
    const out = readFileSync(join(env.dir, 'd.md'), 'utf-8');
    expect(out.match(/^## New\b/gm)).toHaveLength(1);
  });

  it('returns no warnings for a normal insert', async () => {
    writeFileSync(join(env.dir, 'd.md'), '# Doc\n\n## A\n\nContent A.\n');
    const res = await handleDocInsertSection(
      { file: 'docs/d.md', anchor: 'A', position: 'after', heading: 'New', content: 'Body.', mode: 'write' },
      env.ctx,
    ) as { warnings?: string[] };
    expect(res.warnings).toBeUndefined();
  });
});

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
import { handleDocReplaceSection } from '../../../src/tools/write/doc-replace-section.js';

interface TestEnv { ctx: ToolContext; dir: string; cleanup: () => void; }

function makeCtx(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-rh-'));
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

describe('doc_replace_section with replace_heading replaces children carried in content (#136)', () => {
  it('rewrites a whole document from its H1 without duplicate-heading validation errors', async () => {
    writeFileSync(join(env.dir, 'd.md'), '# Doc ^doc\n\nIntro.\n\n## A ^a\n\nold a.\n\n## B ^b\n\nold b.\n');
    const res = await handleDocReplaceSection(
      {
        file: 'docs/d.md', section: '^doc', replace_heading: true, mode: 'write',
        content: '# Doc ^doc\n\nIntro v2.\n\n## A ^a\n\nnew a.\n\n## B ^b\n\nnew b.\n',
      },
      env.ctx,
    ) as { success?: boolean };
    expect(res.success).toBe(true);
    const out = readFileSync(join(env.dir, 'd.md'), 'utf-8');
    expect(out.trimEnd()).toBe('# Doc ^doc\n\nIntro v2.\n\n## A ^a\n\nnew a.\n\n## B ^b\n\nnew b.');
  });
});

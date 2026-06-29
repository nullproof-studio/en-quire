// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const dir = mkdtempSync(join(tmpdir(), 'enquire-rm-'));
  const db = new Database(':memory:');
  initSearchSchema(db);
  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } } },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' }, callers: {}, require_read_before_write: false,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search', 'exec'] }] };
  const roots: Record<string, RootContext> = { docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) } };
  return { ctx: { config, roots, caller, db }, dir, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

let env: TestEnv;
beforeEach(() => { env = makeCtx(); });
afterEach(() => { env.cleanup(); });

describe('doc_replace_section steers empty-content "fake deletes" to doc_delete_section', () => {
  it('warns when content is empty and the heading is preserved (orphan-heading footgun)', async () => {
    writeFileSync(join(env.dir, 'd.md'), '# Doc\n\n## Target\n\nbody text.\n');
    const res = await handleDocReplaceSection(
      { file: 'docs/d.md', section: 'Target', content: '' },
      env.ctx,
    ) as { warnings?: string[] };
    expect(res.warnings?.some((w) => w.includes('doc_delete_section'))).toBe(true);
  });

  it('does not warn for normal non-empty replacements', async () => {
    writeFileSync(join(env.dir, 'd.md'), '# Doc\n\n## Target\n\nbody text.\n');
    const res = await handleDocReplaceSection(
      { file: 'docs/d.md', section: 'Target', content: 'new body.' },
      env.ctx,
    ) as { warnings?: string[] };
    expect(res.warnings).toBeUndefined();
  });

  it('does not warn when replace_heading is true (a deliberate full-heading rewrite)', async () => {
    writeFileSync(join(env.dir, 'd.md'), '# Doc\n\n## Target\n\nbody text.\n');
    const res = await handleDocReplaceSection(
      { file: 'docs/d.md', section: 'Target', content: '## Renamed\n\nx.', replace_heading: true },
      env.ctx,
    ) as { warnings?: string[] };
    expect(res.warnings).toBeUndefined();
  });
});

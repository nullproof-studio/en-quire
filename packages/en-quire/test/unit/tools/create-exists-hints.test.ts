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
import { initSearchSchema, GitOperations, ToolRegistry } from '@nullproof-studio/en-core';
import { handleDocCreate, DocCreateSchema } from '../../../src/tools/write/doc-create.js';
import { registerEnQuireTools } from '../../../src/plugin.js';

/**
 * An agent asked to restructure an existing RFC hit the doc_create
 * "file already exists" guard, and concluded from its wording that the write
 * surface was replace-text-in-place only. It then reasoned itself into a long
 * archive-and-renumber workaround, stating that en-quire "does not allow
 * reordering sections" and that filenames were immutable — both false
 * (doc_move_section and doc_rename do exactly those things).
 *
 * The guard named only doc_replace_section and doc_find_replace. These assert
 * that every place an agent meets that refusal also signposts the structural
 * tools and the rename path, so the wrong inference is not available.
 */

interface TestEnv { ctx: ToolContext; dir: string; cleanup: () => void; }

function makeCtx(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-create-'));
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

/** The three surfaces an agent can meet the refusal on must agree. */
function expectFullWriteSurface(text: string) {
  // The in-place editing tools it already named.
  expect(text).toContain('doc_replace_section');
  // Restructuring — the capability the agent wrongly believed absent.
  expect(text).toContain('doc_move_section');
  // Relocating content to a different path — the actual answer to "I want
  // this content under a new filename".
  expect(text).toContain('doc_rename');
}

describe('doc_create "already exists" refusal signposts the whole write surface', () => {
  it('names the structural and rename tools in the runtime error', async () => {
    writeFileSync(join(env.dir, 'rfc.md'), '# RFC\n\n## Design\n\nbody.\n');
    await expect(
      handleDocCreate({ file: 'docs/rfc.md', content: '# RFC\n\nrewritten.\n' }, env.ctx),
    ).rejects.toThrow(/doc_move_section/);

    const err = await handleDocCreate(
      { file: 'docs/rfc.md', content: '# RFC\n\nrewritten.\n' },
      env.ctx,
    ).catch((e: Error) => e);
    expectFullWriteSurface((err as Error).message);
  });

  it('still identifies the offending file in the error', async () => {
    writeFileSync(join(env.dir, 'rfc.md'), '# RFC\n');
    const err = await handleDocCreate(
      { file: 'docs/rfc.md', content: '# RFC\n\nx.\n' },
      env.ctx,
    ).catch((e: Error) => e);
    expect((err as Error).message).toContain('docs/rfc.md');
  });

  it('names them in the `file` parameter description, which agents read before calling', () => {
    const shape = DocCreateSchema.shape.file;
    expectFullWriteSurface(shape.description ?? '');
  });

  it('names them in the registered tool description', () => {
    const registry = new ToolRegistry();
    registerEnQuireTools(registry);
    const tool = registry.get('doc_create');
    expect(tool).toBeDefined();
    expectFullWriteSurface(tool!.description);
  });
});

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
import { registerEnQuireTools } from '../../../src/plugin.js';
import { handleDocRename } from '../../../src/tools/write/doc-rename.js';
import { handleDocMoveSection } from '../../../src/tools/write/doc-move-section.js';

/**
 * Agent-facing refusals must leave the caller with a usable next step, and
 * must never name a tool that does not exist.
 *
 * doc_rename's cross-root guard told agents to "use doc_read + doc_create +
 * doc_delete instead" — but en-quire has no whole-file delete tool. An agent
 * following that advice creates the copy, then strands itself on a
 * tool-not-found, having half-completed a move.
 */

interface TestEnv { ctx: ToolContext; dirA: string; cleanup: () => void; }

function makeCtx(): TestEnv {
  const dirA = mkdtempSync(join(tmpdir(), 'enquire-a-'));
  const dirB = mkdtempSync(join(tmpdir(), 'enquire-b-'));
  const db = new Database(':memory:');
  initSearchSchema(db);
  const mkRoot = (name: string, path: string) => ({ name, path, git: { enabled: false, auto_commit: false, branch_prefix: '' } });
  const config = {
    document_roots: { docs: mkRoot('docs', dirA), other: mkRoot('other', dirB) },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' }, callers: {}, require_read_before_write: false,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search'] }] };
  const roots: Record<string, RootContext> = {
    docs: { root: config.document_roots.docs, git: new GitOperations(dirA, false) },
    other: { root: config.document_roots.other, git: new GitOperations(dirB, false) },
  };
  return {
    ctx: { config, roots, caller, db }, dirA,
    cleanup: () => { db.close(); rmSync(dirA, { recursive: true, force: true }); rmSync(dirB, { recursive: true, force: true }); },
  };
}

let env: TestEnv;
beforeEach(() => { env = makeCtx(); });
afterEach(() => { env.cleanup(); });

/** Every doc_* token an agent is told to call must be a registered tool. */
describe('agent-facing text never names a non-existent tool', () => {
  const registry = new ToolRegistry();
  registerEnQuireTools(registry);
  const registered = new Set(registry.all().map((t) => t.name));

  it('has no whole-file doc_delete tool (the premise of these guards)', () => {
    expect(registered.has('doc_delete_section')).toBe(true);
    expect(registered.has('doc_delete')).toBe(false);
  });

  it('only references real tools from tool and parameter descriptions', () => {
    const offenders: string[] = [];
    for (const tool of registry.all()) {
      const texts = [tool.description];
      for (const [param, schema] of Object.entries(tool.schema ?? {})) {
        const described = (schema as { description?: string }).description;
        if (described) texts.push(`${param}: ${described}`);
      }
      for (const text of texts) {
        for (const [ref] of text.matchAll(/\bdoc_[a-z_]+\b/g)) {
          if (!registered.has(ref)) offenders.push(`${tool.name} → "${ref}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('doc_rename cross-root refusal', () => {
  it('does not tell the agent to call a non-existent doc_delete', async () => {
    writeFileSync(join(env.dirA, 'a.md'), '# A\n');
    const err = await handleDocRename(
      { source: 'docs/a.md', destination: 'other/a.md' },
      env.ctx,
    ).catch((e: Error) => e) as Error;
    expect(err.message).toMatch(/cannot rename across roots/i);
    expect(err.message).not.toMatch(/\bdoc_delete\b(?!_section)/);
  });

  it('states that the original cannot be removed through en-quire', async () => {
    writeFileSync(join(env.dirA, 'a.md'), '# A\n');
    const err = await handleDocRename(
      { source: 'docs/a.md', destination: 'other/a.md' },
      env.ctx,
    ).catch((e: Error) => e) as Error;
    // The copy half is achievable and should still be spelled out...
    expect(err.message).toContain('doc_read');
    expect(err.message).toContain('doc_create');
    // ...but the agent must be told the move cannot be completed in-tool,
    // rather than being sent after a tool that does not exist.
    expect(err.message).toMatch(/copy|cannot be removed|outside en-quire/i);
  });
});

describe('doc_move_section YAML refusal offers a next step', () => {
  it('names an alternative rather than dead-ending, as doc_insert_section does', async () => {
    writeFileSync(join(env.dirA, 'c.yaml'), 'a: 1\nb: 2\n');
    const err = await handleDocMoveSection(
      { file: 'docs/c.yaml', section: 'a', anchor: 'b', position: 'after' },
      env.ctx,
    ).catch((e: Error) => e) as Error;
    expect(err.message).toMatch(/not supported for YAML/i);
    expect(err.message).toContain('doc_replace_section');
  });
});

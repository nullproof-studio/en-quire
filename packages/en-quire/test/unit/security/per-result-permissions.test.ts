// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ToolContext, ResolvedConfig, CallerIdentity, RootContext } from '@nullproof-studio/en-core';
import { initSearchSchema, syncIndex, GitOperations, markRootWalked } from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';
import { handleDocList } from '../../../src/tools/read/doc-list.js';
import { handleDocSearch } from '../../../src/tools/search/doc-search.js';

// List-style tools must filter every returned entry by the caller's
// permission on that entry's path — not only check the `scope` argument.
//
// The restricted caller may touch top-level files of `docs` (`docs/*`) plus
// one named file inside docs/secret. Scope arguments such as "docs/secret" or
// "docs/*" satisfy the `docs/*` pattern themselves, so a scope-only check lets
// them through; the results must still exclude docs/secret/hidden.md.

let db: Database.Database;
let dir: string;

const RESTRICTED: CallerIdentity['scopes'] = [
  { path: 'docs/*', permissions: ['read', 'search'] },
  { path: 'docs/secret/allowed.md', permissions: ['read', 'search'] },
];
const FULL: CallerIdentity['scopes'] = [{ path: '**', permissions: ['read', 'search'] }];

function makeCtx(scopes: CallerIdentity['scopes']): ToolContext {
  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } } },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false },
      refresh_on_search: false, rescan_interval_ms: 30_000 },
    logging: { console: 'error' }, callers: {}, require_read_before_write: false,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes };
  const roots: Record<string, RootContext> = { docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) } };
  return { config, roots, caller, db };
}

beforeEach(() => {
  dir = join(tmpdir(), `enquire-perm-${randomUUID()}`);
  mkdirSync(join(dir, 'secret'), { recursive: true });
  writeFileSync(join(dir, 'top.md'), '# Top\n\nzebra public notes.\n');
  writeFileSync(join(dir, 'secret', 'hidden.md'), '# Hidden\n\nzebra classified notes.\n');
  writeFileSync(join(dir, 'secret', 'allowed.md'), '# Allowed\n\nzebra shared notes.\n');
  db = new Database(':memory:');
  initSearchSchema(db);
  syncIndex(db, 'docs', dir);
  markRootWalked(db, 'docs');
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function listPaths(ctx: ToolContext, scope?: string): Promise<string[]> {
  const { files } = await handleDocList({ scope, include_outline: false } as never, ctx);
  return files.map((f) => f.path).sort();
}

async function searchFiles(ctx: ToolContext, scope?: string): Promise<string[]> {
  const { results } = await handleDocSearch(
    { query: 'zebra', scope, search_type: 'fulltext', max_results: 10, include_context: false },
    ctx,
  );
  return [...new Set(results.map((r) => r.file))].sort();
}

describe('doc_list filters each entry by read permission', () => {
  // doc_list scopes are directory paths, not globs.
  it('lists only permitted files beneath a scope that passes the entry check', async () => {
    expect(await listPaths(makeCtx(RESTRICTED), 'docs/secret')).toEqual(['docs/secret/allowed.md']);
  });

  it('is unchanged for a full-access caller', async () => {
    expect(await listPaths(makeCtx(FULL))).toEqual([
      'docs/secret/allowed.md', 'docs/secret/hidden.md', 'docs/top.md',
    ]);
  });
});

describe('doc_search filters each hit by search permission', () => {
  it('omits hits outside the caller\'s scopes (scope: docs/secret)', async () => {
    expect(await searchFiles(makeCtx(RESTRICTED), 'docs/secret')).toEqual(['docs/secret/allowed.md']);
  });

  it('omits hits outside the caller\'s scopes (scope: docs/*)', async () => {
    expect(await searchFiles(makeCtx(RESTRICTED), 'docs/*')).toEqual(['docs/secret/allowed.md', 'docs/top.md']);
  });

  it('does not let denied hits use up max_results', async () => {
    // Enough unreadable matches to crowd a post-limit filter out entirely.
    for (let i = 0; i < 15; i++) {
      writeFileSync(join(dir, 'secret', `n${i}.md`), `# N${i}\n\nzebra zebra zebra zebra.\n`);
    }
    syncIndex(db, 'docs', dir);
    const { results } = await handleDocSearch(
      { query: 'zebra', scope: 'docs/*', search_type: 'fulltext', max_results: 1, include_context: false },
      makeCtx(RESTRICTED),
    );
    expect(results).toHaveLength(1);
    expect(['docs/top.md', 'docs/secret/allowed.md']).toContain(results[0].file);
  });

  it('is unchanged for a full-access caller', async () => {
    expect(await searchFiles(makeCtx(FULL))).toEqual([
      'docs/secret/allowed.md', 'docs/secret/hidden.md', 'docs/top.md',
    ]);
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ToolContext, ResolvedConfig, CallerIdentity, RootContext } from '@nullproof-studio/en-core';
import { initSearchSchema, syncIndex, GitOperations, markRootWalked } from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';
import { handleDocSearch } from '../../../src/tools/search/doc-search.js';

// #137 — files changed outside en-quire must not be served stale by doc_search.

let db: Database.Database;
let dir: string;

function makeCtx(search: Record<string, unknown> = {}): ToolContext {
  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } } },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false },
      refresh_on_search: true, rescan_interval_ms: 30_000, ...search },
    logging: { console: 'error' }, callers: {}, require_read_before_write: false,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes: [{ path: '**', permissions: ['read', 'write', 'search'] }] };
  const roots: Record<string, RootContext> = { docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) } };
  return { config, roots, caller, db };
}

function write(name: string, content: string, bumpMs = 0): void {
  const full = join(dir, name);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf-8');
  if (bumpMs) {
    // Guarantee a strictly newer mtime than the one recorded at index time.
    const t = new Date(Date.now() + bumpMs);
    utimesSync(full, t, t);
  }
}

async function search(ctx: ToolContext, query: string, scope?: string) {
  const { results } = await handleDocSearch(
    { query, scope, search_type: 'fulltext', max_results: 10, include_context: true },
    ctx,
  );
  return results.map((r) => ({ file: r.file, heading: r.section_heading }));
}

beforeEach(() => {
  dir = join(tmpdir(), `enquire-fresh-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  db = new Database(':memory:');
  initSearchSchema(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('doc_search refreshes files changed outside en-quire (#137)', () => {
  beforeEach(() => {
    write('spec/a.md', '# A\n\n## Old heading\n\nalpha oldword.\n');
    write('notes/b.md', '# B\n\nbeta.\n');
    syncIndex(db, 'docs', dir);
    markRootWalked(db, 'docs');
  });

  for (const scope of ['docs/spec/a.md', 'docs/spec', 'docs', undefined]) {
    it(`serves the edited content (scope: ${scope ?? 'all roots'})`, async () => {
      write('spec/a.md', '# A\n\n## New heading\n\nalpha newword.\n', 5_000);
      const ctx = makeCtx();
      expect(await search(ctx, 'newword', scope)).toEqual([{ file: 'docs/spec/a.md', heading: 'New heading' }]);
      expect(await search(ctx, 'oldword', scope)).toEqual([]);
    });
  }

  it('drops a file deleted on disk from the results', async () => {
    unlinkSync(join(dir, 'spec/a.md'));
    expect(await search(makeCtx(), 'alpha', 'docs')).toEqual([]);
  });

  it('does not re-index files whose mtime is unchanged', async () => {
    const before = db.prepare('SELECT file_path, indexed_at FROM index_metadata ORDER BY file_path').all();
    await new Promise((r) => setTimeout(r, 5));
    await search(makeCtx(), 'alpha', 'docs');
    const after = db.prepare('SELECT file_path, indexed_at FROM index_metadata ORDER BY file_path').all();
    expect(after).toEqual(before);
  });

  it('finds a new file in a single-file scope immediately', async () => {
    write('spec/new.md', '# New\n\ngamma.\n');
    expect(await search(makeCtx(), 'gamma', 'docs/spec/new.md')).toEqual([{ file: 'docs/spec/new.md', heading: 'New' }]);
  });

  it('finds new files in folder and root scopes once the rescan interval has passed', async () => {
    write('spec/new.md', '# New\n\ngamma.\n');
    // Root was walked just now and the interval is long: new files wait for the next walk.
    expect(await search(makeCtx(), 'gamma', 'docs')).toEqual([]);
    expect(await search(makeCtx(), 'gamma', 'docs/spec')).toEqual([]);
    // Interval 0 walks on every search.
    expect(await search(makeCtx({ rescan_interval_ms: 0 }), 'gamma', 'docs/spec')).toEqual([{ file: 'docs/spec/new.md', heading: 'New' }]);
  });

  it('walks a root on the first search when it has never been walked', async () => {
    const fresh = new Database(':memory:');
    initSearchSchema(fresh);
    try {
      syncIndex(fresh, 'docs', dir); // indexed, but never marked walked in this db
      write('spec/new.md', '# New\n\ngamma.\n');
      const ctx = { ...makeCtx(), db: fresh };
      expect(await search(ctx, 'gamma')).toEqual([{ file: 'docs/spec/new.md', heading: 'New' }]);
    } finally {
      fresh.close();
    }
  });

  it('resolves a dangling link once its target appears via a refresh', async () => {
    write('notes/b.md', '# B\n\nSee [a doc](../spec/target.md).\n', 5_000);
    await search(makeCtx(), 'beta', 'docs/notes'); // re-indexes b.md; target missing
    const linkOf = () => (db.prepare('SELECT target_file FROM doc_links WHERE source_file = ?')
      .get('docs/notes/b.md') as { target_file: string }).target_file;
    expect(linkOf()).toBe('?docs/spec/target.md');

    write('spec/target.md', '# Target\n\ndelta.\n');
    await search(makeCtx({ rescan_interval_ms: 0 }), 'delta', 'docs/spec');
    expect(linkOf()).toBe('docs/spec/target.md');
  });

  it('can be switched off with search.refresh_on_search: false', async () => {
    write('spec/a.md', '# A\n\n## New heading\n\nalpha newword.\n', 5_000);
    expect(await search(makeCtx({ refresh_on_search: false }), 'newword', 'docs')).toEqual([]);
  });
});

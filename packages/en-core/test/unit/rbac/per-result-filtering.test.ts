// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { simpleGit } from 'simple-git';
import {
  GitOperations,
  handleStatus,
  handleProposalsList,
  handleContextBundle,
  initSearchSchema,
  syncIndex,
  markRootWalked,
} from '@nullproof-studio/en-core';
import type { ToolContext, ResolvedConfig, CallerIdentity } from '@nullproof-studio/en-core';
import '../../../../en-quire/src/parsers/markdown-parser.js';

// Tools that return many files must filter each entry by the caller's
// permission on that entry — a check on the `scope` argument alone is not
// enough, because scope strings like "docs/secret" or "docs/*" match a
// pattern such as `docs/*` while the results extend beneath it.

const ROOT = 'docs';
const STAMP = '20261115T120000Z';
const RESTRICTED: CallerIdentity['scopes'] = [{ path: 'docs/*', permissions: ['read', 'search'] }];
const FULL: CallerIdentity['scopes'] = [{ path: '**', permissions: ['read', 'search'] }];

let repoDir: string;
let db: Database.Database;

function makeCtx(scopes: CallerIdentity['scopes']): ToolContext {
  const config: ResolvedConfig = {
    document_roots: {
      [ROOT]: {
        name: ROOT,
        path: repoDir,
        git: {
          enabled: true, auto_commit: true, remote: null, pr_hook: null,
          default_branch: null, push_proposals: false,
        },
      },
    },
    database: ':memory:',
    transport: 'stdio',
    port: 3100,
    listen_host: '127.0.0.1',
    search: { sync_on_start: 'blocking', batch_size: 500, semantic: { enabled: false } },
    logging: { level: 'error', dir: null },
    callers: {},
    require_read_before_write: true,
  } as ResolvedConfig;
  return {
    config,
    roots: { [ROOT]: { root: config.document_roots[ROOT], git: new GitOperations(repoDir, true) } },
    caller: { id: 'tester', scopes },
    db,
  };
}

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'per-result-filtering-'));
  mkdirSync(join(repoDir, 'secret'), { recursive: true });
  writeFileSync(join(repoDir, 'top.md'), '# Top\n\nzebra public notes.\n');
  writeFileSync(join(repoDir, 'secret', 'hidden.md'), '# Hidden\n\nzebra classified notes.\n');

  const g = simpleGit(repoDir);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.add('.');
  await g.commit('init');
  // One pending proposal on each file.
  await g.branch([`propose/agent/top.md/${STAMP}`]);
  await g.branch([`propose/agent/secret/hidden.md/${STAMP}`]);
  // Uncommitted edits to both files show up as `modified`.
  writeFileSync(join(repoDir, 'top.md'), '# Top\n\nzebra public notes, edited.\n');
  writeFileSync(join(repoDir, 'secret', 'hidden.md'), '# Hidden\n\nzebra classified notes, edited.\n');
  // An unindexed file in each place.
  writeFileSync(join(repoDir, 'secret', 'unindexed.md'), '# U\n');

  db = new Database(':memory:');
  initSearchSchema(db);
  syncIndex(db, ROOT, repoDir);
  markRootWalked(db, ROOT);
  // Make unindexed.md genuinely unindexed after the sync.
  db.prepare('DELETE FROM index_metadata WHERE file_path = ?').run('docs/secret/unindexed.md');
});

afterEach(() => {
  db.close();
  rmSync(repoDir, { recursive: true, force: true });
});

describe('doc_status filters per-file results by read permission', () => {
  for (const scope of ['docs/secret', 'docs/*']) {
    it(`hides files outside the caller's scopes (scope: ${scope})`, async () => {
      const status = await handleStatus({ scope }, makeCtx(RESTRICTED));
      expect(status.modified).not.toContain('docs/secret/hidden.md');
      expect(status.unindexed).not.toContain('docs/secret/unindexed.md');
    });
  }

  it('counts only readable indexed files and proposals', async () => {
    const status = await handleStatus({ scope: 'docs/*' }, makeCtx(RESTRICTED));
    expect(status.modified).toEqual(['docs/top.md']);
    expect(status.indexed).toBe(1);
    expect(status.pending_proposals).toBe(1);
  });

  it('is unchanged for a full-access caller', async () => {
    const status = await handleStatus({}, makeCtx(FULL));
    expect([...status.modified].sort()).toEqual([
      'docs/secret/hidden.md', 'docs/secret/unindexed.md', 'docs/top.md',
    ]);
    expect(status.unindexed).toEqual(['docs/secret/unindexed.md']);
    expect(status.indexed).toBe(2);
    expect(status.pending_proposals).toBe(2);
  });
});

describe('doc_proposals_list filters each proposal by read permission', () => {
  for (const scope of ['docs/secret', 'docs/*']) {
    it(`omits proposals on files outside the caller's scopes (scope: ${scope})`, async () => {
      const { proposals } = await handleProposalsList({ scope }, makeCtx(RESTRICTED));
      expect(proposals.map((p) => p.file)).not.toContain('docs/secret/hidden.md');
    });
  }

  it('still lists proposals on permitted files', async () => {
    const { proposals } = await handleProposalsList({ scope: 'docs/*' }, makeCtx(RESTRICTED));
    expect(proposals.map((p) => p.file)).toEqual(['docs/top.md']);
  });

  it('is unchanged for a full-access caller', async () => {
    const { proposals } = await handleProposalsList({}, makeCtx(FULL));
    expect(proposals.map((p) => p.file).sort()).toEqual(['docs/secret/hidden.md', 'docs/top.md']);
  });
});

describe('doc_context_bundle seeds only from searchable files', () => {
  it('does not seed from a file the caller may read but not search', async () => {
    // Read everywhere, search only on top-level files: a search-derived
    // seed from docs/secret is a search the caller is not allowed to run.
    const scopes: CallerIdentity['scopes'] = [
      { path: '**', permissions: ['read'] },
      { path: 'docs/*', permissions: ['search'] },
    ];
    const { sections } = await handleContextBundle(
      { query: 'zebra', scope: 'docs/*', max_sections: 10, max_depth: 0 } as never,
      makeCtx(scopes),
    );
    expect(sections.map((s) => s.file)).toEqual(['docs/top.md']);
  });

  it('is unchanged for a full-access caller', async () => {
    const { sections } = await handleContextBundle(
      { query: 'zebra', max_sections: 10, max_depth: 0 } as never,
      makeCtx(FULL),
    );
    expect(sections.map((s) => s.file).sort()).toEqual(['docs/secret/hidden.md', 'docs/top.md']);
  });
});

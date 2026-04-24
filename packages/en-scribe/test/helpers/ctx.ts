// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import type {
  ToolContext,
  ResolvedConfig,
  CallerIdentity,
  RootContext,
} from '@nullproof-studio/en-core';
import { initSearchSchema, GitOperations } from '@nullproof-studio/en-core';

/**
 * Build a minimal ToolContext rooted at a fresh tmp directory with full
 * caller permissions and an in-memory sqlite db. Callers are responsible
 * for cleaning up the tmp directory.
 */
export function makeCtx(options: {
  rootName?: string;
  requireReadBeforeWrite?: boolean;
  gitEnabled?: boolean;
} = {}): {
  ctx: ToolContext;
  rootDir: string;
  db: Database.Database;
} {
  const rootName = options.rootName ?? 'notes';
  const rootDir = mkdtempSync(join(tmpdir(), `enscribe-test-${rootName}-`));

  if (options.gitEnabled) {
    const git = (args: string[]): void => {
      execFileSync('git', args, { cwd: rootDir, stdio: 'pipe' });
    };
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
    writeFileSync(join(rootDir, '.seed'), 'seed\n');
    git(['add', '.seed']);
    git(['commit', '-m', 'init']);
  }

  const db = new Database(':memory:');
  initSearchSchema(db);

  const config: ResolvedConfig = {
    document_roots: {
      [rootName]: {
        name: rootName,
        path: rootDir,
        git: { enabled: false, auto_commit: false, branch_prefix: '' },
      },
    },
    database: ':memory:',
    transport: 'stdio',
    port: 0,
    search: {
      fulltext: false,
      sync_on_start: 'blocking',
      batch_size: 100,
      semantic: { enabled: false },
    },
    logging: { console: 'error' },
    callers: {},
    require_read_before_write: options.requireReadBeforeWrite ?? false,
  };

  const caller: CallerIdentity = {
    id: 'test',
    scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search', 'exec'] }],
  };

  const roots: Record<string, RootContext> = {
    [rootName]: {
      root: config.document_roots[rootName],
      git: new GitOperations(rootDir, options.gitEnabled ? null : false),
    },
  };

  return {
    ctx: { config, roots, caller, db },
    rootDir,
    db,
  };
}

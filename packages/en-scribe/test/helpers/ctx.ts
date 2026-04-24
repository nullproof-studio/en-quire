// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
export function makeCtx(options: { rootName?: string; requireReadBeforeWrite?: boolean } = {}): {
  ctx: ToolContext;
  rootDir: string;
  db: Database.Database;
} {
  const rootName = options.rootName ?? 'notes';
  const rootDir = mkdtempSync(join(tmpdir(), `enscribe-test-${rootName}-`));

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
    scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search', 'admin', 'exec'] }],
  };

  const roots: Record<string, RootContext> = {
    [rootName]: {
      root: config.document_roots[rootName],
      git: new GitOperations(rootDir, false),
    },
  };

  return {
    ctx: { config, roots, caller, db },
    rootDir,
    db,
  };
}

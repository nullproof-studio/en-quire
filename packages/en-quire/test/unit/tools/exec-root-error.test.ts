// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { handleDocExec } from '../../../src/tools/admin/doc-exec.js';
import { NotFoundError } from '@nullproof-studio/en-core';
import type {
  ToolContext,
  ResolvedConfig,
  CallerIdentity,
} from '@nullproof-studio/en-core';

function makeCtx(): ToolContext {
  const config: ResolvedConfig = {
    document_roots: {
      docs: { name: 'docs', path: '/tmp/docs', git: { enabled: false, auto_commit: false, branch_prefix: '' } },
      skills: { name: 'skills', path: '/tmp/skills', git: { enabled: false, auto_commit: false, branch_prefix: '' } },
      memory: { name: 'memory', path: '/tmp/memory', git: { enabled: false, auto_commit: false, branch_prefix: '' } },
    },
    database: ':memory:',
    transport: 'stdio',
    port: 0,
    search: { fulltext: false, sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' },
    callers: {},
    require_read_before_write: false,
  };
  const caller: CallerIdentity = {
    id: 'test',
    scopes: [{ path: '**', permissions: ['exec'] }],
  };
  // Unknown-root path is reached before any per-root state is consulted — leave roots empty.
  return { config, roots: {}, caller, db: new Database(':memory:') };
}

describe('doc_exec unknown root', () => {
  it('throws NotFoundError with ranked candidates and a format hint', async () => {
    const ctx = makeCtx();
    let caught: unknown;
    try {
      await handleDocExec(
        { command: 'echo', args: ['hello'], root: 'docz' },
        ctx,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    const err = caught as NotFoundError;
    expect(err.resource).toBe('root');
    expect(err.candidates).toBeDefined();
    // 'docs' is closest to 'docz' (distance 1) — should rank first
    expect(err.candidates![0]).toBe('docs');
    expect(err.message).toMatch(/root parameter|configured root/i);
  });
});

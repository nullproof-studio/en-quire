// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  handleHistory,
  HistorySchema,
  initSearchSchema,
  GitOperations,
  GitRequiredError,
  PermissionDeniedError,
} from '@nullproof-studio/en-core';
import type { ToolContext, CallerIdentity, ResolvedConfig } from '@nullproof-studio/en-core';
import type { z } from 'zod';
import '../../../../en-quire/src/parsers/markdown-parser.js';

let workRoot: string;
let docsRoot: string;
let g: SimpleGit;
let db: Database.Database;

function buildContext(scopes: CallerIdentity['scopes'], gitEnabled = true): ToolContext {
  const git = gitEnabled ? new GitOperations(docsRoot, true) : null;
  const config: ResolvedConfig = {
    document_roots: {
      docs: { name: 'docs', path: docsRoot, git: {
        enabled: gitEnabled, auto_commit: true, remote: null, pr_hook: null,
        pr_hook_secret: null, default_branch: null, push_proposals: false,
      }},
    },
    database: ':memory:',
    transport: 'stdio',
    port: 3100,
    listen_host: '127.0.0.1',
    search: {
      fulltext: true, sync_on_start: 'blocking', batch_size: 500,
      semantic: { enabled: false },
    },
    logging: { level: 'error', dir: null },
    callers: {},
    require_read_before_write: true,
  };
  return {
    config,
    roots: { docs: { root: config.document_roots.docs, git } },
    caller: { id: 'tester', scopes },
    db,
  };
}

async function commit(content: string, msg: string): Promise<void> {
  writeFileSync(join(docsRoot, 'doc.md'), content);
  await g.add('doc.md');
  await g.commit(msg);
}

beforeEach(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'history-handler-'));
  docsRoot = join(workRoot, 'docs');
  mkdirSync(docsRoot, { recursive: true });
  db = new Database(':memory:');
  initSearchSchema(db);

  g = simpleGit(docsRoot);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Tester');
  await g.addConfig('commit.gpgsign', 'false');
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);

  const v1 = '# Title\n\n## Foo\n\nFoo body line 1.\nFoo body line 2.\n\n## Bar\n\nBar body.\n';
  await commit(v1, 'init');

  const v2 = '# Title\n\n## Foo\n\nFoo body line 1 changed.\nFoo body line 2.\n\n## Bar\n\nBar body.\n';
  await commit(v2, 'edit foo body');

  const v3 = '# Title\n\n## Foo\n\nFoo body line 1 changed.\nFoo body line 2.\n\n## Bar\n\nBar body changed.\n';
  await commit(v3, 'edit bar body');
});

afterEach(() => {
  db.close();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('handleHistory', () => {
  const readAll: CallerIdentity['scopes'] = [{ path: '**', permissions: ['read'] }];

  it('returns the commits that touched the requested section', async () => {
    const args: z.infer<typeof HistorySchema> = { file: 'docs/doc.md', section: 'Foo' };
    const result = await handleHistory(args, buildContext(readAll)) as {
      history: Array<{ subject: string }>;
    };
    const subjects = result.history.map((h) => h.subject);
    expect(subjects).toContain('edit foo body');
    expect(subjects).toContain('init');
    expect(subjects).not.toContain('edit bar body');
  });

  it('returns whole-file history when section is omitted', async () => {
    const args: z.infer<typeof HistorySchema> = { file: 'docs/doc.md' };
    const result = await handleHistory(args, buildContext(readAll)) as {
      history: Array<{ subject: string }>;
    };
    expect(result.history.map((h) => h.subject)).toEqual(
      expect.arrayContaining(['init', 'edit foo body', 'edit bar body']),
    );
  });

  it('returns an empty array when the section does not exist', async () => {
    const args: z.infer<typeof HistorySchema> = { file: 'docs/doc.md', section: 'No-Such-Section' };
    const result = await handleHistory(args, buildContext(readAll)) as { history: unknown[] };
    expect(result.history).toEqual([]);
  });

  it('honours the limit parameter', async () => {
    const args: z.infer<typeof HistorySchema> = { file: 'docs/doc.md', limit: 1 };
    const result = await handleHistory(args, buildContext(readAll)) as { history: unknown[] };
    expect(result.history).toHaveLength(1);
  });

  it('throws GitRequiredError when the root has no git', async () => {
    const args: z.infer<typeof HistorySchema> = { file: 'docs/doc.md' };
    await expect(handleHistory(args, buildContext(readAll, false))).rejects.toThrow(GitRequiredError);
  });

  it('rejects callers without read permission for the file', async () => {
    const ctx = buildContext([{ path: 'other/**', permissions: ['read'] }]);
    const args: z.infer<typeof HistorySchema> = { file: 'docs/doc.md' };
    await expect(handleHistory(args, ctx)).rejects.toThrow(PermissionDeniedError);
  });
});

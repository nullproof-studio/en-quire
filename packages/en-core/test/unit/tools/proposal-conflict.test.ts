// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  GitOperations,
  MergeConflictError,
  handleProposalApprove,
  handleProposalDiff,
  ProposalApproveSchema,
  ProposalDiffSchema,
  initSearchSchema,
} from '@nullproof-studio/en-core';
import type { ToolContext, CallerIdentity, ResolvedConfig } from '@nullproof-studio/en-core';
import type { z } from 'zod';

let repoDir: string;
let g: SimpleGit;
let ctx: ToolContext;
let db: Database.Database;

const ROOT_NAME = 'docs';

function buildContext(repoPath: string): ToolContext {
  const ops = new GitOperations(repoPath, true);
  const caller: CallerIdentity = {
    id: 'test-caller',
    scopes: [{ path: '**', permissions: ['read', 'approve', 'propose', 'write'] }],
  };
  const config: ResolvedConfig = {
    document_roots: {
      [ROOT_NAME]: {
        name: ROOT_NAME,
        path: repoPath,
        git: {
          enabled: true,
          auto_commit: true,
          remote: null,
          pr_hook: null,
          default_branch: null,
          push_proposals: false,
        },
      },
    },
    database: ':memory:',
    transport: 'stdio',
    port: 3100,
    listen_host: '127.0.0.1',
    search: {
      fulltext: true,
      sync_on_start: 'blocking',
      batch_size: 500,
      semantic: { enabled: false },
    },
    logging: { level: 'error', dir: null },
    callers: {},
    require_read_before_write: true,
  };

  return {
    config,
    roots: {
      [ROOT_NAME]: { root: config.document_roots[ROOT_NAME], git: ops },
    },
    caller,
    db,
  };
}

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'proposal-conflict-'));
  db = new Database(':memory:');
  initSearchSchema(db);
  g = simpleGit(repoDir);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(repoDir, 'doc.md'), '# Title\n\nOriginal body.\n');
  await g.add('doc.md');
  await g.commit('init');
  ctx = buildContext(repoDir);
});

afterEach(() => {
  db.close();
  rmSync(repoDir, { recursive: true, force: true });
});

async function makeProposalAndDriftMain(branch: string): Promise<void> {
  await g.checkoutLocalBranch(branch);
  writeFileSync(join(repoDir, 'doc.md'), '# Title\n\nProposal edit.\n');
  await g.add('doc.md');
  await g.commit('proposal: edit');
  await g.checkout('main');
  writeFileSync(join(repoDir, 'doc.md'), '# Title\n\nMain drift.\n');
  await g.add('doc.md');
  await g.commit('main: drift');
}

describe('handleProposalDiff conflict surfacing', () => {
  it('returns can_merge: true for a non-overlapping proposal', async () => {
    const branch = 'propose/test-caller/doc.md/20260429T100000Z';
    await g.checkoutLocalBranch(branch);
    writeFileSync(join(repoDir, 'doc.md'), '# Title\n\nOriginal body.\n\nAppended.\n');
    await g.add('doc.md');
    await g.commit('proposal: append');
    await g.checkout('main');

    const args: z.infer<typeof ProposalDiffSchema> = { branch, root: ROOT_NAME };
    const result = await handleProposalDiff(args, ctx) as {
      can_merge: boolean;
      conflicts: string[];
    };

    expect(result.can_merge).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('returns can_merge: false with conflict paths when default has drifted', async () => {
    const branch = 'propose/test-caller/doc.md/20260429T100001Z';
    await makeProposalAndDriftMain(branch);

    const args: z.infer<typeof ProposalDiffSchema> = { branch, root: ROOT_NAME };
    const result = await handleProposalDiff(args, ctx) as {
      can_merge: boolean;
      conflicts: string[];
    };

    expect(result.can_merge).toBe(false);
    expect(result.conflicts).toContain('doc.md');
  });
});

describe('handleProposalApprove conflict pre-flight', () => {
  it('throws MergeConflictError and does not merge when the proposal conflicts', async () => {
    const branch = 'propose/test-caller/doc.md/20260429T100002Z';
    await makeProposalAndDriftMain(branch);

    const args: z.infer<typeof ProposalApproveSchema> = { branch, root: ROOT_NAME };

    await expect(handleProposalApprove(args, ctx)).rejects.toThrow(MergeConflictError);

    // Branch must still exist (approve must not have run) and main must be
    // unchanged from the drift commit, not a merge commit.
    const branches = await g.branchLocal();
    expect(branches.all).toContain(branch);
    const head = (await g.raw(['log', '-1', '--format=%s', 'main'])).trim();
    expect(head).toBe('main: drift');
  });

  it('approves cleanly when the proposal does not conflict', async () => {
    const branch = 'propose/test-caller/doc.md/20260429T100003Z';
    await g.checkoutLocalBranch(branch);
    writeFileSync(join(repoDir, 'doc.md'), '# Title\n\nOriginal body.\n\nAppended on branch.\n');
    await g.add('doc.md');
    await g.commit('proposal: append');
    await g.checkout('main');

    const args: z.infer<typeof ProposalApproveSchema> = { branch, root: ROOT_NAME };
    const result = await handleProposalApprove(args, ctx) as {
      success: boolean;
      merge_commit: string;
    };

    expect(result.success).toBe(true);
    expect(result.merge_commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

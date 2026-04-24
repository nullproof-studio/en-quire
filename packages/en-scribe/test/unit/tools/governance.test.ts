// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import type { ToolContext, CallerIdentity } from '@nullproof-studio/en-core';
import { PermissionDeniedError, ValidationError } from '@nullproof-studio/en-core';
// Register plaintext parser so status's supportedExtensions() returns .txt/.text/.log
import '../../../src/parsers/plaintext-parser.js';
import { handleTextStatus } from '../../../src/tools/status/text-status.js';
import {
  handleTextProposalsList,
  handleTextProposalApprove,
  handleTextProposalReject,
} from '../../../src/tools/governance/text-proposals.js';
import { makeCtx } from '../../helpers/ctx.js';

const ROOT = 'notes';

let ctx: ToolContext;
let rootDir: string;
let db: Database.Database;

beforeEach(() => {
  ({ ctx, rootDir, db } = makeCtx({ rootName: ROOT }));
});

afterEach(() => {
  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});

describe('text_status', () => {
  it('reports unindexed text files', async () => {
    writeFileSync(join(rootDir, 'a.txt'), 'one\n');
    writeFileSync(join(rootDir, 'b.log'), 'log\n');
    // Not counted — extension not owned by any registered parser
    writeFileSync(join(rootDir, 'readme.md'), '# readme\n');

    const result = await handleTextStatus({}, ctx) as {
      unindexed: string[];
      indexed: number;
      roots: { name: string; git_active: boolean }[];
    };
    expect(result.unindexed.sort()).toEqual([`${ROOT}/a.txt`, `${ROOT}/b.log`]);
    expect(result.indexed).toBe(0);
    expect(result.roots[0].name).toBe(ROOT);
  });

  it('reports zero pending proposals when no git root is available', async () => {
    const result = await handleTextStatus({}, ctx) as { pending_proposals: number };
    expect(result.pending_proposals).toBe(0);
  });
});

describe('text_proposals_list', () => {
  it('returns empty list when no git-enabled roots', async () => {
    const result = await handleTextProposalsList({}, ctx) as { proposals: unknown[] };
    expect(result.proposals).toEqual([]);
  });
});

// Shared helper — build a git-enabled ctx with a real proposal branch
// landed on the filesystem so approve/reject have something to operate on.
function makeProposalCtx(): {
  ctx: ToolContext;
  rootDir: string;
  db: Database.Database;
  branchName: string;
} {
  const h = makeCtx({ rootName: ROOT, gitEnabled: true });
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: h.rootDir, stdio: 'pipe' });
  };
  const branchName = `propose/alice/${ROOT}-triage.txt/20260424T180000Z`;
  git(['checkout', '-q', '-b', branchName]);
  writeFileSync(join(h.rootDir, 'triage.txt'), 'proposed content\n');
  git(['add', 'triage.txt']);
  git(['commit', '-m', '[en-scribe] Append "Triage" in notes/triage.txt\n\nCaller: alice\nOperation: Append\nTarget: Triage\nMode: propose']);
  git(['checkout', '-q', 'main']);
  return { ...h, branchName };
}

describe('text_proposal_approve — scope', () => {
  it('denies approve when caller lacks approve on the target file', async () => {
    const { ctx: proposalCtx, rootDir: proposalRoot, db: proposalDb, branchName } = makeProposalCtx();
    // Caller can approve everything under notes/public/** but NOT the
    // proposal's target (notes/triage.txt is under notes/ root directly).
    const scopedCaller: CallerIdentity = {
      id: 'narrow',
      scopes: [
        { path: `${ROOT}/public/**`, permissions: ['read', 'write', 'approve'] },
      ],
    };
    proposalCtx.caller = scopedCaller;

    await expect(
      handleTextProposalApprove({ branch: branchName }, proposalCtx),
    ).rejects.toThrow(PermissionDeniedError);

    // Cleanup
    proposalDb.close();
    rmSync(proposalRoot, { recursive: true, force: true });
  });

  it('allows approve when caller has approve on the specific target file', async () => {
    const { ctx: proposalCtx, rootDir: proposalRoot, db: proposalDb, branchName } = makeProposalCtx();
    const scopedCaller: CallerIdentity = {
      id: 'narrow',
      scopes: [
        { path: `${ROOT}/**`, permissions: ['read', 'approve'] },
      ],
    };
    proposalCtx.caller = scopedCaller;

    const result = await handleTextProposalApprove({ branch: branchName }, proposalCtx) as {
      success: boolean;
    };
    expect(result.success).toBe(true);

    proposalDb.close();
    rmSync(proposalRoot, { recursive: true, force: true });
  });
});

describe('text_proposal_reject — scope + branch validation', () => {
  it('denies reject when caller lacks approve on the target file', async () => {
    const { ctx: proposalCtx, rootDir: proposalRoot, db: proposalDb, branchName } = makeProposalCtx();
    const scopedCaller: CallerIdentity = {
      id: 'narrow',
      scopes: [{ path: `${ROOT}/public/**`, permissions: ['approve'] }],
    };
    proposalCtx.caller = scopedCaller;

    await expect(
      handleTextProposalReject({ branch: branchName }, proposalCtx),
    ).rejects.toThrow(PermissionDeniedError);

    proposalDb.close();
    rmSync(proposalRoot, { recursive: true, force: true });
  });

  it('refuses to delete a non-propose branch even with global approve', async () => {
    const { ctx: proposalCtx, rootDir: proposalRoot, db: proposalDb } = makeProposalCtx();
    const permissive: CallerIdentity = {
      id: 'admin',
      scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search'] }],
    };
    proposalCtx.caller = permissive;

    // Create a non-proposal branch that approve-with-full-scope would
    // otherwise be able to delete under the old (buggy) behaviour.
    execFileSync('git', ['checkout', '-q', '-b', 'random-feature-branch'], { cwd: proposalRoot });
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: proposalRoot });

    await expect(
      handleTextProposalReject({ branch: 'random-feature-branch' }, proposalCtx),
    ).rejects.toThrow(ValidationError);

    // Branch must still exist — the reject must not have deleted it.
    const branches = execFileSync('git', ['branch'], { cwd: proposalRoot, encoding: 'utf8' });
    expect(branches).toContain('random-feature-branch');

    proposalDb.close();
    rmSync(proposalRoot, { recursive: true, force: true });
  });

  it('rejects a real proposal branch successfully', async () => {
    const { ctx: proposalCtx, rootDir: proposalRoot, db: proposalDb, branchName } = makeProposalCtx();
    const permissive: CallerIdentity = {
      id: 'admin',
      scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search'] }],
    };
    proposalCtx.caller = permissive;

    const result = await handleTextProposalReject({ branch: branchName }, proposalCtx) as {
      success: boolean;
    };
    expect(result.success).toBe(true);

    proposalDb.close();
    rmSync(proposalRoot, { recursive: true, force: true });
  });
});

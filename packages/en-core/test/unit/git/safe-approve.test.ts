// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitOperations, ValidationError } from '@nullproof-studio/en-core';

let workDir: string;
let remoteDir: string;
let g: SimpleGit;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'safe-approve-work-'));
  remoteDir = mkdtempSync(join(tmpdir(), 'safe-approve-remote-'));

  const bare = simpleGit(remoteDir);
  await bare.init(true);

  g = simpleGit(workDir);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(workDir, 'README'), 'base\n');
  await g.add('README');
  await g.commit('init');
  await g.addRemote('origin', remoteDir);
  await g.push(['-u', 'origin', 'main']);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(remoteDir, { recursive: true, force: true });
});

async function makeAndPushProposal(branch: string, file: string, content: string): Promise<void> {
  await g.checkoutLocalBranch(branch);
  writeFileSync(join(workDir, file), content);
  await g.add(file);
  await g.commit(`proposal: add ${file}`);
  await g.push('origin', branch);
  await g.checkout('main');
}

describe('GitOperations.fetchAndPrune', () => {
  it('fetches and prunes when remote is configured', async () => {
    const ops = new GitOperations(workDir, null, null, 'origin', true);
    const result = await ops.fetchAndPrune();
    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('returns { ok: false } when no remote is configured', async () => {
    const ops = new GitOperations(workDir, null, null, null, false);
    const result = await ops.fetchAndPrune();
    expect(result.ok).toBe(false);
  });

  it('returns a warning instead of throwing on network failure', async () => {
    const ops = new GitOperations(workDir, null, null, 'no-such-remote', true);
    const result = await ops.fetchAndPrune();
    expect(result.ok).toBe(false);
    expect(result.warning).toBeDefined();
  });

  it('after prune, a remote-deleted branch disappears from origin/* refs', async () => {
    const branch = 'propose/m/a.md/20260424T170000Z';
    await makeAndPushProposal(branch, 'a.md', 'payload\n');

    // Simulate upstream merge + branch deletion on the remote
    const bare = simpleGit(remoteDir);
    await bare.raw(['update-ref', '-d', `refs/heads/${branch}`]);

    const ops = new GitOperations(workDir, null, null, 'origin', true);
    const result = await ops.fetchAndPrune();
    expect(result.ok).toBe(true);

    // The remote-tracking ref should now be gone. `show-ref --verify`
    // (without --quiet) exits 128 with a fatal message on stderr for a
    // missing ref, which simple-git surfaces as a thrown error. The
    // --quiet variant exits 1 silently and simple-git resolves it.
    await expect(
      g.raw(['show-ref', '--verify', `refs/remotes/origin/${branch}`]),
    ).rejects.toThrow();
  });
});

describe('GitOperations.approveProposal — safe pre-flight', () => {
  it('refuses to approve when the remote branch has been deleted upstream', async () => {
    const branch = 'propose/m/a.md/20260424T170000Z';
    await makeAndPushProposal(branch, 'a.md', 'payload\n');

    // Remote-side removal (as GitHub "merge + delete branch" would do)
    const bare = simpleGit(remoteDir);
    await bare.raw(['update-ref', '-d', `refs/heads/${branch}`]);

    const ops = new GitOperations(workDir, null, null, 'origin', true);
    await expect(ops.approveProposal(branch, 'Approve from MCP'))
      .rejects.toThrow(ValidationError);
    await expect(ops.approveProposal(branch, 'Approve from MCP'))
      .rejects.toThrow(/no longer on remote|handled upstream/i);

    // Local branch must still exist — approve refused, nothing destructive
    const { all } = await g.branchLocal();
    expect(all).toContain(branch);
  });

  it('allows approve when the remote branch is still present (happy path)', async () => {
    const branch = 'propose/m/b.md/20260424T170000Z';
    await makeAndPushProposal(branch, 'b.md', 'content\n');

    const ops = new GitOperations(workDir, null, null, 'origin', true);
    const { merge_commit } = await ops.approveProposal(branch, 'Approve');
    expect(merge_commit).toMatch(/^[0-9a-f]{40}$/);

    const { all } = await g.branchLocal();
    expect(all).not.toContain(branch);
  });

  it('skips pre-flight when no remote is configured (local-only proposal)', async () => {
    // Make a proposal that was never pushed
    const branch = 'propose/m/local.md/20260424T170000Z';
    await g.checkoutLocalBranch(branch);
    writeFileSync(join(workDir, 'local.md'), 'local\n');
    await g.add('local.md');
    await g.commit('local proposal');
    await g.checkout('main');

    // GitOperations with no remote configured
    const ops = new GitOperations(workDir, null, null, null, false);
    const { merge_commit } = await ops.approveProposal(branch, 'Approve');
    expect(merge_commit).toMatch(/^[0-9a-f]{40}$/);

    const { all } = await g.branchLocal();
    expect(all).not.toContain(branch);
  });

  it('refuses approval when the remote is unreachable (fail-closed)', async () => {
    const branch = 'propose/m/c.md/20260424T170000Z';
    await makeAndPushProposal(branch, 'c.md', 'payload\n');

    // Point at a bogus remote so the pre-flight fetch fails
    const ops = new GitOperations(workDir, null, null, 'no-such-remote', true);
    await expect(ops.approveProposal(branch, 'Approve'))
      .rejects.toThrow(ValidationError);

    // Local branch must still exist — approve refused
    const { all } = await g.branchLocal();
    expect(all).toContain(branch);
  });
});

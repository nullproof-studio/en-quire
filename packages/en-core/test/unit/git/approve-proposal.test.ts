// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitOperations } from '@nullproof-studio/en-core';

let repoDir: string;
let g: SimpleGit;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'approve-proposal-'));
  g = simpleGit(repoDir);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(repoDir, 'README'), 'base\n');
  await g.add('README');
  await g.commit('init');
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

async function makeProposal(branchName: string, file: string, content: string): Promise<void> {
  await g.checkoutLocalBranch(branchName);
  writeFileSync(join(repoDir, file), content);
  await g.add(file);
  await g.commit(`proposal: add ${file}`);
  await g.checkout('main');
}

describe('GitOperations.approveProposal', () => {
  it('merges onto the default branch and returns the merge commit SHA', async () => {
    await makeProposal('propose/m/a.md/20260424T170000Z', 'a.md', 'payload\n');
    const ops = new GitOperations(repoDir);

    const { merge_commit } = await ops.approveProposal(
      'propose/m/a.md/20260424T170000Z',
      'Approve a.md',
    );

    expect(merge_commit).toMatch(/^[0-9a-f]{40}$/);
    // Main now has a merge commit as HEAD
    const head = (await g.raw(['rev-parse', 'HEAD'])).trim();
    expect(head).toBe(merge_commit);
    // The merge commit is on main
    const current = (await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    expect(current).toBe('main');
  });

  it('deletes the proposal branch on success', async () => {
    const branchName = 'propose/m/a.md/20260424T170000Z';
    await makeProposal(branchName, 'a.md', 'payload\n');
    const ops = new GitOperations(repoDir);

    await ops.approveProposal(branchName, 'Approve');

    const { all } = await g.branchLocal();
    expect(all).not.toContain(branchName);
  });

  it('switches to default before merging, even when called from an unrelated branch', async () => {
    await makeProposal('propose/m/a.md/20260424T170000Z', 'a.md', 'payload\n');
    // Put the working tree on a third branch so the merge has to switch
    await g.checkoutLocalBranch('unrelated');
    writeFileSync(join(repoDir, 'other'), 'x\n');
    await g.add('other');
    await g.commit('unrelated work');

    const ops = new GitOperations(repoDir);
    await ops.approveProposal('propose/m/a.md/20260424T170000Z', 'Approve');

    // After approve, we should be back on 'unrelated' — the caller's original branch
    const current = (await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    expect(current).toBe('unrelated');

    // And main has the merge commit with the proposal's payload
    await g.checkout('main');
    const mainLog = await g.log({ from: 'HEAD~1', to: 'HEAD' });
    expect(mainLog.all[0].message).toContain('Approve');
  });

  it('stays on default when the caller was on the proposal branch (now deleted)', async () => {
    const branchName = 'propose/m/a.md/20260424T170000Z';
    await makeProposal(branchName, 'a.md', 'payload\n');
    await g.checkout(branchName);

    const ops = new GitOperations(repoDir);
    await ops.approveProposal(branchName, 'Approve');

    const current = (await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    expect(current).toBe('main');
  });

  it('stays on default when the caller was already on default', async () => {
    await makeProposal('propose/m/a.md/20260424T170000Z', 'a.md', 'payload\n');
    // already on main from beforeEach

    const ops = new GitOperations(repoDir);
    await ops.approveProposal('propose/m/a.md/20260424T170000Z', 'Approve');

    const current = (await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    expect(current).toBe('main');
  });

  it('honours a non-main default branch', async () => {
    // Rebuild the repo on master instead
    rmSync(repoDir, { recursive: true, force: true });
    repoDir = mkdtempSync(join(tmpdir(), 'approve-proposal-master-'));
    g = simpleGit(repoDir);
    await g.init();
    await g.addConfig('user.email', 'test@example.com');
    await g.addConfig('user.name', 'Test');
    await g.addConfig('commit.gpgsign', 'false');
    await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/master']);
    writeFileSync(join(repoDir, 'README'), 'base\n');
    await g.add('README');
    await g.commit('init');

    await g.checkoutLocalBranch('propose/m/a.md/20260424T170000Z');
    writeFileSync(join(repoDir, 'a.md'), 'payload\n');
    await g.add('a.md');
    await g.commit('proposal');
    await g.checkout('master');

    const ops = new GitOperations(repoDir);
    const { merge_commit } = await ops.approveProposal(
      'propose/m/a.md/20260424T170000Z',
      'Approve',
    );

    const current = (await g.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    expect(current).toBe('master');
    expect(merge_commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

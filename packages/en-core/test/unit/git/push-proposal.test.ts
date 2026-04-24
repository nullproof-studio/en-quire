// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitOperations } from '@nullproof-studio/en-core';

let workDir: string;
let remoteDir: string;
let g: SimpleGit;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'push-work-'));
  remoteDir = mkdtempSync(join(tmpdir(), 'push-remote-'));

  // Bare "remote"
  const bare = simpleGit(remoteDir);
  await bare.init(true);

  // Working repo wired to it
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

async function makeProposal(branch: string, file: string, content: string): Promise<void> {
  await g.checkoutLocalBranch(branch);
  writeFileSync(join(workDir, file), content);
  await g.add(file);
  await g.commit(`proposal: add ${file}`);
  await g.checkout('main');
}

describe('GitOperations.pushProposalBranch', () => {
  it('pushes the branch when remote and push_proposals are configured', async () => {
    const branch = 'propose/m/a.md/20260424T170000Z';
    await makeProposal(branch, 'a.md', 'payload\n');

    const ops = new GitOperations(workDir, null, null, 'origin', true);
    const result = await ops.pushProposalBranch(branch);
    expect(result.pushed).toBe(true);
    expect(result.warning).toBeUndefined();

    // Branch now exists on the bare remote
    const remote = simpleGit(remoteDir);
    const branches = await remote.branch();
    expect(branches.all).toContain(branch);
  });

  it('is a no-op when no remote is configured', async () => {
    const branch = 'propose/m/a.md/20260424T170000Z';
    await makeProposal(branch, 'a.md', 'payload\n');

    const ops = new GitOperations(workDir, null, null, null, true);
    const result = await ops.pushProposalBranch(branch);
    expect(result.pushed).toBe(false);
    expect(result.warning).toBeUndefined();

    // Branch NOT on remote
    const remote = simpleGit(remoteDir);
    const branches = await remote.branch();
    expect(branches.all).not.toContain(branch);
  });

  it('is a no-op when push_proposals is false, even with a remote', async () => {
    const branch = 'propose/m/a.md/20260424T170000Z';
    await makeProposal(branch, 'a.md', 'payload\n');

    const ops = new GitOperations(workDir, null, null, 'origin', false);
    const result = await ops.pushProposalBranch(branch);
    expect(result.pushed).toBe(false);

    const remote = simpleGit(remoteDir);
    const branches = await remote.branch();
    expect(branches.all).not.toContain(branch);
  });

  it('returns a warning instead of throwing when push fails', async () => {
    const branch = 'propose/m/a.md/20260424T170000Z';
    await makeProposal(branch, 'a.md', 'payload\n');

    // Non-existent remote
    const ops = new GitOperations(workDir, null, null, 'no-such-remote', true);
    const result = await ops.pushProposalBranch(branch);
    expect(result.pushed).toBe(false);
    expect(result.warning).toBeDefined();
    expect(result.warning).toContain('no-such-remote');
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { GitOperations } from '@nullproof-studio/en-core';

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'git-default-branch-'));
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

async function initRepoOnBranch(dir: string, branch: string): Promise<void> {
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.raw(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
  writeFileSync(join(dir, 'README'), 'x\n');
  await g.add('README');
  await g.commit('init');
}

describe('GitOperations.resolveDefaultBranch', () => {
  it('uses the configured override when provided', async () => {
    await initRepoOnBranch(repoDir, 'main');
    const ops = new GitOperations(repoDir, null, 'trunk');
    expect(await ops.resolveDefaultBranch()).toBe('trunk');
  });

  it('detects main for a main-based repo', async () => {
    await initRepoOnBranch(repoDir, 'main');
    const ops = new GitOperations(repoDir);
    expect(await ops.resolveDefaultBranch()).toBe('main');
  });

  it('detects master for a master-based repo', async () => {
    await initRepoOnBranch(repoDir, 'master');
    const ops = new GitOperations(repoDir);
    expect(await ops.resolveDefaultBranch()).toBe('master');
  });

  it('memoises the resolved value', async () => {
    await initRepoOnBranch(repoDir, 'main');
    const ops = new GitOperations(repoDir);
    const first = await ops.resolveDefaultBranch();
    const second = await ops.resolveDefaultBranch();
    expect(first).toBe(second);
    expect(first).toBe('main');
  });

  it('throws when git is not available', async () => {
    // No init — repoDir has no .git
    const ops = new GitOperations(repoDir);
    await expect(ops.resolveDefaultBranch()).rejects.toThrow();
  });
});

describe('GitOperations.getDiff uses the resolved default branch', () => {
  it('diffs against master in a master-based repo (no hardcoded main)', async () => {
    await initRepoOnBranch(repoDir, 'master');
    const g = simpleGit(repoDir);
    // Create a feature branch with a new commit
    await g.checkoutLocalBranch('feature/x');
    writeFileSync(join(repoDir, 'NEW'), 'payload\n');
    await g.add('NEW');
    await g.commit('add NEW');

    const ops = new GitOperations(repoDir);
    const diff = await ops.getDiff('feature/x');
    expect(diff).toContain('NEW');
    expect(diff).toContain('payload');
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitOperations, buildCommitMessage } from '@nullproof-studio/en-core';

let repoDir: string;
let g: SimpleGit;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'proposal-meta-'));
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

describe('GitOperations.getProposalTipCommit', () => {
  it('returns SHA, author date, full message and diff summary for a proposal tip', async () => {
    const commitBody = buildCommitMessage({
      operation: 'Replace section',
      target: '2.7 Checks',
      file: 'sops/deployment.md',
      caller: 'michelle',
      mode: 'propose',
      userMessage: 'Update threshold',
    });

    await g.checkoutLocalBranch('propose/michelle/sops/deployment.md/20260424T170000Z');
    writeFileSync(join(repoDir, 'payload.md'), '# section\ncontent\n');
    await g.add('payload.md');
    await g.commit(commitBody);

    // Stay on propose — getProposalTipCommit should not care
    const ops = new GitOperations(repoDir);
    const tip = await ops.getProposalTipCommit('propose/michelle/sops/deployment.md/20260424T170000Z');

    expect(tip.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(tip.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(tip.message).toContain('Caller: michelle');
    expect(tip.message).toContain('Operation: Replace section');
    expect(tip.message).toContain('Target: 2.7 Checks');
    expect(tip.message).toContain('Mode: propose');
    expect(tip.message).toContain('Message: Update threshold');
    // Diff summary reflects the single-file add
    expect(tip.diffSummary).toMatch(/1 file changed.*insertion/);
  });

  it('returns an empty diff summary when the branch has no changes vs default', async () => {
    await g.checkoutLocalBranch('propose/empty/a.md/20260424T170000Z');
    await g.commit('empty change', undefined, { '--allow-empty': null });

    const ops = new GitOperations(repoDir);
    const tip = await ops.getProposalTipCommit('propose/empty/a.md/20260424T170000Z');
    expect(tip.diffSummary).toBe('');
  });
});

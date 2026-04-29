// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitOperations } from '@nullproof-studio/en-core';

let workDir: string;
let g: SimpleGit;

beforeEach(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'check-mergeable-'));
  g = simpleGit(workDir);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(workDir, 'doc.md'), '# Title\n\nOriginal body.\n');
  await g.add('doc.md');
  await g.commit('init');
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('GitOperations.checkMergeable', () => {
  it('reports can_merge: true with empty conflicts when branch has no overlap with default', async () => {
    const branch = 'propose/m/doc.md/20260429T000000Z';
    await g.checkoutLocalBranch(branch);
    writeFileSync(join(workDir, 'doc.md'), '# Title\n\nOriginal body.\n\nAppended on branch.\n');
    await g.add('doc.md');
    await g.commit('proposal: append');
    await g.checkout('main');

    const ops = new GitOperations(workDir, null, null, null, false);
    const result = await ops.checkMergeable(branch);

    expect(result.can_merge).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('reports can_merge: false with conflicting paths when default branch has drifted on the same lines', async () => {
    const branch = 'propose/m/doc.md/20260429T000001Z';
    await g.checkoutLocalBranch(branch);
    writeFileSync(join(workDir, 'doc.md'), '# Title\n\nBranch edit.\n');
    await g.add('doc.md');
    await g.commit('proposal: branch edit');
    await g.checkout('main');

    // Drift main on the same line that the proposal edited
    writeFileSync(join(workDir, 'doc.md'), '# Title\n\nMain edit.\n');
    await g.add('doc.md');
    await g.commit('main: divergent edit');

    const ops = new GitOperations(workDir, null, null, null, false);
    const result = await ops.checkMergeable(branch);

    expect(result.can_merge).toBe(false);
    expect(result.conflicts).toContain('doc.md');
  });

  it('does not modify the working tree or HEAD', async () => {
    const branch = 'propose/m/doc.md/20260429T000002Z';
    await g.checkoutLocalBranch(branch);
    writeFileSync(join(workDir, 'doc.md'), '# Title\n\nBranch edit.\n');
    await g.add('doc.md');
    await g.commit('proposal: branch edit');
    await g.checkout('main');
    writeFileSync(join(workDir, 'doc.md'), '# Title\n\nMain edit.\n');
    await g.add('doc.md');
    await g.commit('main: drift');

    const headBefore = (await g.raw(['rev-parse', 'HEAD'])).trim();
    const branchBefore = (await g.status()).current;
    const fileBefore = readFileSync(join(workDir, 'doc.md'), 'utf8');

    const ops = new GitOperations(workDir, null, null, null, false);
    await ops.checkMergeable(branch);

    const headAfter = (await g.raw(['rev-parse', 'HEAD'])).trim();
    const branchAfter = (await g.status()).current;
    const fileAfter = readFileSync(join(workDir, 'doc.md'), 'utf8');

    expect(headAfter).toBe(headBefore);
    expect(branchAfter).toBe(branchBefore);
    expect(fileAfter).toBe(fileBefore);
  });
});

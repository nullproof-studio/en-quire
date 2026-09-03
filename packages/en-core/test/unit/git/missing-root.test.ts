// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { GitOperations, GitRequiredError } from '@nullproof-studio/en-core';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'git-missing-root-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('GitOperations on a document root that does not exist', () => {
  it('constructs without throwing and reports git unavailable', () => {
    const missing = join(tmp, 'does-not-exist');
    let ops: GitOperations | undefined;
    expect(() => { ops = new GitOperations(missing); }).not.toThrow();
    expect(ops!.available).toBe(false);
  });

  it('constructs without throwing when git is explicitly disabled', () => {
    const missing = join(tmp, 'does-not-exist');
    let ops: GitOperations | undefined;
    expect(() => { ops = new GitOperations(missing, false); }).not.toThrow();
    expect(ops!.available).toBe(false);
  });

  it('rejects git operations with GitRequiredError rather than a simple-git error', async () => {
    const ops = new GitOperations(join(tmp, 'does-not-exist'));
    await expect(ops.getCurrentBranch()).rejects.toBeInstanceOf(GitRequiredError);
  });

  it('still detects a real repository at an existing path', async () => {
    const g = simpleGit(tmp);
    await g.init();
    const ops = new GitOperations(tmp);
    expect(ops.available).toBe(true);
  });

  it('respects enabled: false on an existing repository', async () => {
    const g = simpleGit(tmp);
    await g.init();
    const ops = new GitOperations(tmp, false);
    expect(ops.available).toBe(false);
  });
});

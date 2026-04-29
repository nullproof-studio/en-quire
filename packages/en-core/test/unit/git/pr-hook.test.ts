// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitOperations } from '@nullproof-studio/en-core';

let repoDir: string;

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'pr-hook-'));
  const g: SimpleGit = simpleGit(repoDir);
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

describe('GitOperations.runPrHook', () => {
  it('is a no-op when pr_hook is not configured', async () => {
    const ops = new GitOperations(repoDir, null, null, null, false, null);
    const result = await ops.runPrHook({ branch: 'b', file: 'f', caller: 'c' });
    expect(result.ran).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('runs the hook command and returns ran:true on success', async () => {
    // Write a shell script that echoes its substituted args to a marker file
    const marker = join(repoDir, 'hook-output');
    const hook = join(repoDir, 'hook.sh');
    writeFileSync(hook, `#!/bin/sh\necho "branch=$1 file=$2 caller=$3" > "${marker}"\n`, { mode: 0o755 });

    const ops = new GitOperations(
      repoDir, null, null, null, false,
      `${hook} {branch} {file} {caller}`,
    );
    const result = await ops.runPrHook({
      branch: 'propose/m/a.md/20260424T170000Z',
      file: 'a.md',
      caller: 'michelle',
    });

    expect(result.ran).toBe(true);
    expect(result.warning).toBeUndefined();

    const { readFileSync } = await import('node:fs');
    const out = readFileSync(marker, 'utf8').trim();
    expect(out).toBe('branch=propose/m/a.md/20260424T170000Z file=a.md caller=michelle');
  });

  it('returns a warning when the hook exits non-zero', async () => {
    const ops = new GitOperations(repoDir, null, null, null, false, 'false');
    const result = await ops.runPrHook({ branch: 'b', file: 'f', caller: 'c' });
    expect(result.ran).toBe(false);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/exit/i);
  });

  it('returns a warning when the hook command does not exist', async () => {
    const ops = new GitOperations(repoDir, null, null, null, false, 'this-command-does-not-exist-kljh');
    const result = await ops.runPrHook({ branch: 'b', file: 'f', caller: 'c' });
    expect(result.ran).toBe(false);
    expect(result.warning).toBeDefined();
  });

  it('treats substituted tokens as argv values — does not re-tokenise on special chars', async () => {
    // If file is "a; rm -rf /", a shell-interpreted command would be disastrous.
    // execFile bypasses the shell, and substitution happens per-token, so this
    // is just a single argv entry.
    const marker = join(repoDir, 'hook-output');
    const hook = join(repoDir, 'hook.sh');
    writeFileSync(hook, `#!/bin/sh\nprintf '%s' "$1" > "${marker}"\n`, { mode: 0o755 });

    const ops = new GitOperations(repoDir, null, null, null, false, `${hook} {file}`);
    const result = await ops.runPrHook({
      branch: 'b',
      file: 'a; rm -rf /',
      caller: 'c',
    });

    expect(result.ran).toBe(true);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(marker, 'utf8')).toBe('a; rm -rf /');
  });
});

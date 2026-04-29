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
  repoDir = mkdtempSync(join(tmpdir(), 'line-history-'));
  g = simpleGit(repoDir);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

async function commit(file: string, content: string, msg: string): Promise<string> {
  writeFileSync(join(repoDir, file), content);
  await g.add(file);
  await g.commit(msg);
  return (await g.raw(['rev-parse', 'HEAD'])).trim();
}

describe('GitOperations.getLineHistory', () => {
  it('returns commits that touched lines in the given range, newest first', async () => {
    await commit('doc.md', '# A\n\nLine 1.\nLine 2.\nLine 3.\n', 'initial');
    await commit('doc.md', '# A\n\nLine 1.\nLine 2 changed.\nLine 3.\n', 'edit line 4');
    await commit('doc.md', '# A\n\nLine 1.\nLine 2 changed.\nLine 3 changed.\n', 'edit line 5');

    const ops = new GitOperations(repoDir);
    // Line 4 = "Line 2 changed." — touched by commit 2 + initial
    const history = await ops.getLineHistory('doc.md', 4, 4, 10);
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].subject).toMatch(/edit line 4|initial/);
    // Newest first
    expect(history[0].date >= history[history.length - 1].date).toBe(true);
  });

  it('scopes results to the requested line range', async () => {
    await commit('doc.md', 'a\nb\nc\nd\n', 'init');
    await commit('doc.md', 'a\nB\nc\nd\n', 'change line 2');
    await commit('doc.md', 'a\nB\nc\nD\n', 'change line 4');

    const ops = new GitOperations(repoDir);
    const history = await ops.getLineHistory('doc.md', 2, 2, 10);
    const subjects = history.map((h) => h.subject);
    expect(subjects).toContain('change line 2');
    expect(subjects).not.toContain('change line 4');
  });

  it('honours the limit parameter', async () => {
    await commit('doc.md', 'x\n', 'c1');
    await commit('doc.md', 'x\ny\n', 'c2');
    await commit('doc.md', 'x\ny\nz\n', 'c3');

    const ops = new GitOperations(repoDir);
    const history = await ops.getLineHistory('doc.md', 1, 1, 1);
    expect(history.length).toBeLessThanOrEqual(1);
  });

  it('returns an empty array when the file has no history', async () => {
    await commit('other.md', 'unrelated\n', 'init');
    const ops = new GitOperations(repoDir);
    const history = await ops.getLineHistory('other.md', 100, 200, 10);
    expect(history).toEqual([]);
  });

  it('returns sha + ISO date + author + subject for each entry', async () => {
    await commit('doc.md', 'hello\n', 'one');
    const ops = new GitOperations(repoDir);
    const history = await ops.getLineHistory('doc.md', 1, 1, 5);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(history[0].date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(history[0].author).toBe('Test');
    expect(history[0].subject).toBe('one');
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { safePath } from '@nullproof-studio/en-core';
import { PathTraversalError } from '@nullproof-studio/en-core';

let docRoot: string;
let outsideDir: string;

beforeEach(() => {
  docRoot = join(tmpdir(), `enquire-sec-test-${randomUUID()}`);
  outsideDir = join(tmpdir(), `enquire-sec-outside-${randomUUID()}`);
  mkdirSync(docRoot, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, 'secret.md'), '# Secret\n\nDo not read.');
});

afterEach(() => {
  rmSync(docRoot, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

describe('safePath — path traversal', () => {
  it('allows normal relative paths', () => {
    const result = safePath(docRoot, 'docs/file.md');
    expect(result).toBe(join(docRoot, 'docs/file.md'));
  });

  it('rejects ../ traversal', () => {
    expect(() => safePath(docRoot, '../etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects encoded traversal', () => {
    expect(() => safePath(docRoot, 'docs/../../etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects absolute paths outside root', () => {
    expect(() => safePath(docRoot, '/etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects null bytes', () => {
    expect(() => safePath(docRoot, 'file\0.md')).toThrow(PathTraversalError);
    expect(() => safePath(docRoot, '\0../etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects symlinks that escape document root', () => {
    const linkPath = join(docRoot, 'escape-link.md');
    symlinkSync(join(outsideDir, 'secret.md'), linkPath);

    expect(() => safePath(docRoot, 'escape-link.md')).toThrow(PathTraversalError);
  });

  it('allows symlinks that stay within document root', () => {
    const targetDir = join(docRoot, 'real');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'file.md'), '# File');
    symlinkSync(join(targetDir, 'file.md'), join(docRoot, 'link.md'));

    const result = safePath(docRoot, 'link.md');
    expect(result).toBe(join(docRoot, 'link.md'));
  });

  // Regression tests for P1 #67 — safePath must resolve symlinks in the
  // path's *ancestors* even when the final target itself doesn't exist yet.
  // Otherwise a symlinked directory inside the root lets writes land at
  // the symlink's target, outside the root.

  it('rejects new file under a symlinked directory that escapes the root', () => {
    // /docRoot/link-dir -> /outsideDir (pre-existing symlink, target exists)
    symlinkSync(outsideDir, join(docRoot, 'link-dir'));

    // Writing "link-dir/new.md" would realpath to /outsideDir/new.md,
    // which is outside the document root.
    expect(() => safePath(docRoot, 'link-dir/new.md')).toThrow(PathTraversalError);
  });

  it('rejects deeply nested new path whose ancestor symlink escapes the root', () => {
    symlinkSync(outsideDir, join(docRoot, 'link-dir'));

    // Even with multiple missing descendants under the symlinked ancestor,
    // the ancestor walk must find the symlinked directory and reject.
    expect(() => safePath(docRoot, 'link-dir/sub/deep/new.md')).toThrow(PathTraversalError);
  });

  it('allows a new file under a symlinked directory that stays within root', () => {
    // /docRoot/real-dir exists, /docRoot/loop -> /docRoot/real-dir.
    // Writing "loop/new.md" resolves to /docRoot/real-dir/new.md — still
    // inside the root, so it must be allowed.
    const realDir = join(docRoot, 'real-dir');
    mkdirSync(realDir, { recursive: true });
    symlinkSync(realDir, join(docRoot, 'loop'));

    const result = safePath(docRoot, 'loop/new.md');
    expect(result).toBe(join(docRoot, 'loop/new.md'));
  });

  it('allows deeply nested new paths under real directories', () => {
    // No symlinks in the path — nested creation is a common case and
    // must not regress.
    const result = safePath(docRoot, 'a/b/c/new.md');
    expect(result).toBe(join(docRoot, 'a/b/c/new.md'));
  });
});

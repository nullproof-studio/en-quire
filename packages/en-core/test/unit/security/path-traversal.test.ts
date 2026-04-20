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
});

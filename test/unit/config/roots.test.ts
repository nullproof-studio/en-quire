// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { resolveFilePath, resolveScope } from '../../../src/config/roots.js';
import type { ResolvedRoot } from '../../../src/shared/types.js';

const singleRoot: Record<string, ResolvedRoot> = {
  docs: {
    name: 'docs',
    path: '/data/docs',
    git: { enabled: null, auto_commit: true, remote: null, pr_hook: null },
  },
};

const multiRoots: Record<string, ResolvedRoot> = {
  docs: {
    name: 'docs',
    path: '/data/docs',
    git: { enabled: null, auto_commit: true, remote: null, pr_hook: null },
  },
  skills: {
    name: 'skills',
    path: '/data/skills',
    description: 'Agent skills',
    git: { enabled: true, auto_commit: true, remote: null, pr_hook: null },
  },
  memory: {
    name: 'memory',
    path: '/data/memory',
    git: { enabled: false, auto_commit: false, remote: null, pr_hook: null },
  },
};

describe('resolveFilePath', () => {
  it('resolves prefixed path in multi-root', () => {
    const result = resolveFilePath(multiRoots, 'docs/article.md');
    expect(result.rootName).toBe('docs');
    expect(result.relativePath).toBe('article.md');
    expect(result.prefixedPath).toBe('docs/article.md');
    expect(result.root.path).toBe('/data/docs');
  });

  it('resolves nested prefixed path', () => {
    const result = resolveFilePath(multiRoots, 'skills/drafts/triage.md');
    expect(result.rootName).toBe('skills');
    expect(result.relativePath).toBe('drafts/triage.md');
  });

  it('accepts bare path in single-root config', () => {
    const result = resolveFilePath(singleRoot, 'article.md');
    expect(result.rootName).toBe('docs');
    expect(result.relativePath).toBe('article.md');
    expect(result.prefixedPath).toBe('docs/article.md');
  });

  it('also accepts prefixed path in single-root config', () => {
    const result = resolveFilePath(singleRoot, 'docs/article.md');
    expect(result.rootName).toBe('docs');
    expect(result.relativePath).toBe('article.md');
  });

  it('throws on bare path in multi-root config', () => {
    expect(() => resolveFilePath(multiRoots, 'article.md'))
      .toThrow('Cannot resolve root');
  });

  it('throws on unknown root prefix', () => {
    expect(() => resolveFilePath(multiRoots, 'unknown/file.md'))
      .toThrow('Cannot resolve root');
  });

  it('throws on root-only path (no file)', () => {
    expect(() => resolveFilePath(multiRoots, 'docs/'))
      .toThrow('root, not a file');
  });

  it('throws on empty roots', () => {
    expect(() => resolveFilePath({}, 'file.md'))
      .toThrow('No document roots configured');
  });
});

describe('resolveScope', () => {
  it('returns null rootName for ** scope', () => {
    const result = resolveScope(multiRoots, '**');
    expect(result.rootName).toBeNull();
  });

  it('returns null rootName for undefined scope', () => {
    const result = resolveScope(multiRoots);
    expect(result.rootName).toBeNull();
  });

  it('resolves root name from prefixed scope', () => {
    const result = resolveScope(multiRoots, 'docs/sops');
    expect(result.rootName).toBe('docs');
    expect(result.scopeWithinRoot).toBe('sops');
  });

  it('resolves bare root name as scope', () => {
    const result = resolveScope(multiRoots, 'skills');
    expect(result.rootName).toBe('skills');
    expect(result.scopeWithinRoot).toBeUndefined();
  });

  it('treats scope as within root for single-root config', () => {
    const result = resolveScope(singleRoot, 'sops/**');
    expect(result.rootName).toBe('docs');
    expect(result.scopeWithinRoot).toBe('sops/**');
  });
});

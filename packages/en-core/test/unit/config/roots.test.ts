// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveFilePath, resolveScope, safePath,
  NotFoundError, PathTraversalError, ValidationError,
} from '@nullproof-studio/en-core';
import type { ResolvedRoot } from '@nullproof-studio/en-core';

const git = { enabled: null, auto_commit: true, remote: null, pr_hook: null };
const rootsAt = (paths: Record<string, string>): Record<string, ResolvedRoot> =>
  Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, { name, path, git }]));

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
      .toThrow(NotFoundError);
  });

  it('throws on unknown root prefix with ranked candidates and format hint', () => {
    let caught: unknown;
    try {
      resolveFilePath(multiRoots, 'docz/file.md');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    const err = caught as NotFoundError;
    expect(err.resource).toBe('root');
    expect(err.candidates).toBeDefined();
    // "docs" is closest to "docz" (distance 1) and should rank first
    expect(err.candidates![0]).toBe('docs');
    expect(err.candidates!.length).toBeLessThanOrEqual(20);
    expect(err.message).toContain('docs');
    // Format hint should explain how to prefix paths
    expect(err.message).toMatch(/prefix the path with a root name/i);
  });

  it('caps candidate list at 20', () => {
    const manyRoots: Record<string, ResolvedRoot> = {};
    for (let i = 0; i < 50; i++) {
      manyRoots[`root${i}`] = {
        name: `root${i}`,
        path: `/data/root${i}`,
        git: { enabled: null, auto_commit: true, remote: null, pr_hook: null },
      };
    }
    let caught: unknown;
    try {
      resolveFilePath(manyRoots, 'unknown/file.md');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect((caught as NotFoundError).candidates!.length).toBe(20);
  });

  it('throws on root-only path (no file)', () => {
    expect(() => resolveFilePath(multiRoots, 'docs/'))
      .toThrow('root, not a file');
  });

  it('throws on empty roots', () => {
    expect(() => resolveFilePath({}, 'file.md'))
      .toThrow('No document roots configured');
  });

  it('format hint mentions absolute paths are accepted', () => {
    expect(() => resolveFilePath(multiRoots, 'docz/file.md'))
      .toThrow(/absolute path inside a configured root/i);
  });
});

// #152 — agents holding filesystem paths shouldn't have to rewrite them, but
// an absolute path must never become a way to address files outside a root.
describe('resolveFilePath — absolute filesystem paths', () => {
  it('maps an absolute path inside a root to that root (multi-root)', () => {
    const result = resolveFilePath(multiRoots, '/data/skills/sub/skill.md');
    expect(result.rootName).toBe('skills');
    expect(result.relativePath).toBe('sub/skill.md');
    expect(result.prefixedPath).toBe('skills/sub/skill.md');
  });

  it('maps an absolute path in single-root config instead of treating it as bare', () => {
    const result = resolveFilePath(singleRoot, '/data/docs/a/b.md');
    expect(result.relativePath).toBe('a/b.md');
    expect(result.prefixedPath).toBe('docs/a/b.md');
  });

  it('rejects an absolute path outside every root, in single- and multi-root config', () => {
    for (const roots of [singleRoot, multiRoots]) {
      expect(() => resolveFilePath(roots, '/etc/passwd')).toThrow(ValidationError);
      expect(() => resolveFilePath(roots, '/etc/passwd')).toThrow(/not inside any configured root/i);
    }
  });

  it('does not reveal configured root filesystem paths in the rejection', () => {
    expect(() => resolveFilePath(multiRoots, '/etc/passwd')).not.toThrow(/\/data\//);
  });

  it('normalises ".." before matching, so it cannot climb out of a root', () => {
    expect(() => resolveFilePath(multiRoots, '/data/docs/../../etc/passwd'))
      .toThrow(ValidationError);
    // Climbing into a sibling root is just a path into that root.
    expect(resolveFilePath(multiRoots, '/data/docs/../memory/m.md').prefixedPath)
      .toBe('memory/m.md');
  });

  it('matches whole path segments, not string prefixes', () => {
    const roots = rootsAt({ spec: '/data/spec', 'spec-local': '/data/spec-local' });
    expect(resolveFilePath(roots, '/data/spec-local/x.md').prefixedPath).toBe('spec-local/x.md');
    expect(resolveFilePath(roots, '/data/spec/x.md').prefixedPath).toBe('spec/x.md');
    expect(() => resolveFilePath(rootsAt({ spec: '/data/spec' }), '/data/spec-local/x.md'))
      .toThrow(ValidationError);
  });

  it('accepts a file whose name merely starts with ".."', () => {
    expect(resolveFilePath(multiRoots, '/data/docs/..notes.md').prefixedPath).toBe('docs/..notes.md');
  });

  it('prefers the deepest root when roots are nested', () => {
    const roots = rootsAt({ docs: '/data/docs', archive: '/data/docs/archive' });
    expect(resolveFilePath(roots, '/data/docs/archive/old.md').prefixedPath).toBe('archive/old.md');
    expect(resolveFilePath(roots, '/data/docs/new.md').prefixedPath).toBe('docs/new.md');
  });

  it('throws when the absolute path is the root itself', () => {
    expect(() => resolveFilePath(multiRoots, '/data/docs')).toThrow('root, not a file');
    expect(() => resolveFilePath(multiRoots, '/data/docs/')).toThrow('root, not a file');
  });

  describe('symlinks', () => {
    let base: string;
    let realRoot: string;
    let linkedRoot: string;

    beforeAll(() => {
      base = realpathSync(mkdtempSync(join(tmpdir(), 'enquire-roots-')));
      realRoot = join(base, 'real-docs');
      mkdirSync(realRoot);
      mkdirSync(join(base, 'outside'));
      linkedRoot = join(base, 'linked-docs');
      symlinkSync(realRoot, linkedRoot);
      symlinkSync(join(base, 'outside'), join(realRoot, 'escape'));
    });

    afterAll(() => rmSync(base, { recursive: true, force: true }));

    it('accepts the real path when the root is configured through a symlink', () => {
      const roots = rootsAt({ docs: linkedRoot });
      expect(resolveFilePath(roots, join(realRoot, 'a.md')).prefixedPath).toBe('docs/a.md');
    });

    it('accepts the symlinked path when the root is configured by its real path', () => {
      const roots = rootsAt({ docs: realRoot });
      expect(resolveFilePath(roots, join(linkedRoot, 'a.md')).prefixedPath).toBe('docs/a.md');
    });

    it('a symlink inside the root pointing outside is still blocked by safePath', () => {
      const roots = rootsAt({ docs: realRoot });
      const resolved = resolveFilePath(roots, join(realRoot, 'escape', 'x.md'));
      expect(() => safePath(resolved.root.path, resolved.relativePath)).toThrow(PathTraversalError);
    });
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

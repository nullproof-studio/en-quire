// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { checkPermission, requirePermission, resolveWriteMode } from '@nullproof-studio/en-core';
import { PermissionDeniedError } from '@nullproof-studio/en-core';
import type { CallerIdentity } from '@nullproof-studio/en-core';

const adminCaller: CallerIdentity = {
  id: 'admin',
  scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search', 'exec'] }],
};

const readOnlyCaller: CallerIdentity = {
  id: 'analyst',
  scopes: [{ path: '**', permissions: ['read', 'search'] }],
};

const scopedCaller: CallerIdentity = {
  id: 'michelle',
  scopes: [
    { path: 'sops/**', permissions: ['read', 'write', 'search'] },
    { path: 'skills/**', permissions: ['read', 'propose', 'search'] },
  ],
};

const citeCaller: CallerIdentity = {
  id: 'researcher',
  scopes: [
    // Local-only citation: cite granted, cite_web not.
    { path: 'docs/**', permissions: ['read', 'cite'] },
  ],
};

const webCiteCaller: CallerIdentity = {
  id: 'web-researcher',
  scopes: [
    { path: 'docs/**', permissions: ['read', 'cite', 'cite_web'] },
  ],
};

describe('checkPermission', () => {
  it('allows admin full access', () => {
    expect(checkPermission(adminCaller, 'write', 'any/file.md').allowed).toBe(true);
    expect(checkPermission(adminCaller, 'exec', 'any/file.md').allowed).toBe(true);
  });

  it('denies write for read-only caller', () => {
    const result = checkPermission(readOnlyCaller, 'write', 'docs/test.md');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('analyst');
  });

  it('scopes permissions by path', () => {
    expect(checkPermission(scopedCaller, 'write', 'sops/deploy.md').allowed).toBe(true);
    expect(checkPermission(scopedCaller, 'write', 'skills/triage.md').allowed).toBe(false);
    expect(checkPermission(scopedCaller, 'propose', 'skills/triage.md').allowed).toBe(true);
  });

  it('denies access for unmatched paths', () => {
    expect(checkPermission(scopedCaller, 'read', 'memory/notes.md').allowed).toBe(false);
  });

  it('grants cite without cite_web for a local-only researcher', () => {
    expect(checkPermission(citeCaller, 'cite', 'docs/profile.md').allowed).toBe(true);
    expect(checkPermission(citeCaller, 'cite_web', 'docs/profile.md').allowed).toBe(false);
  });

  it('grants both cite and cite_web for a web-enabled researcher', () => {
    expect(checkPermission(webCiteCaller, 'cite', 'docs/profile.md').allowed).toBe(true);
    expect(checkPermission(webCiteCaller, 'cite_web', 'docs/profile.md').allowed).toBe(true);
  });

  it('does not grant cite by default for callers without it', () => {
    expect(checkPermission(readOnlyCaller, 'cite', 'docs/x.md').allowed).toBe(false);
    expect(checkPermission(adminCaller, 'cite', 'docs/x.md').allowed).toBe(false);
  });
});

describe('requirePermission', () => {
  it('does not throw when allowed', () => {
    expect(() => requirePermission(adminCaller, 'read', 'test.md')).not.toThrow();
  });

  it('throws PermissionDeniedError when denied', () => {
    expect(() => requirePermission(readOnlyCaller, 'write', 'test.md')).toThrow(PermissionDeniedError);
  });
});

describe('resolveWriteMode', () => {
  it('defaults to write when caller has write', () => {
    expect(resolveWriteMode(scopedCaller, 'sops/deploy.md')).toBe('write');
  });

  it('defaults to propose when caller only has propose', () => {
    expect(resolveWriteMode(scopedCaller, 'skills/triage.md')).toBe('propose');
  });

  it('respects explicit mode request', () => {
    expect(resolveWriteMode(adminCaller, 'test.md', 'propose')).toBe('propose');
  });

  it('throws when requesting write without permission', () => {
    expect(() =>
      resolveWriteMode(scopedCaller, 'skills/triage.md', 'write'),
    ).toThrow(PermissionDeniedError);
  });

  it('throws when caller has neither write nor propose', () => {
    expect(() =>
      resolveWriteMode(readOnlyCaller, 'test.md'),
    ).toThrow(PermissionDeniedError);
  });
});

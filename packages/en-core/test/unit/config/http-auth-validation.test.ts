// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '@nullproof-studio/en-core';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'http-auth-cfg-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(yaml: string): string {
  const path = join(dir, 'config.yaml');
  writeFileSync(path, yaml);
  return path;
}

describe('loadConfig — HTTP transport caller-key validation', () => {
  it('throws when HTTP transport is configured and any caller lacks a key', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: streamable-http
callers:
  alice:
    key: sk-alice-valid
    scopes:
      - path: "**"
        permissions: [read]
  bob:
    scopes:
      - path: "**"
        permissions: [read]
`);
    // Error must mention both "key" (what's required) and "bob" (who's missing)
    expect(() => loadConfig(path)).toThrow(/key/i);
    expect(() => loadConfig(path)).toThrow(/bob/);
  });

  it('passes when HTTP transport is configured and every caller has a key', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: streamable-http
callers:
  alice:
    key: sk-alice-valid
    scopes:
      - path: "**"
        permissions: [read]
  bob:
    key: sk-bob-valid
    scopes:
      - path: "**"
        permissions: [read]
`);
    const config = loadConfig(path);
    expect(config.transport).toBe('streamable-http');
    expect(Object.keys(config.callers).sort()).toEqual(['alice', 'bob']);
  });

  it('passes when stdio transport is configured even if callers lack keys', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: stdio
callers:
  alice:
    scopes:
      - path: "**"
        permissions: [read]
`);
    const config = loadConfig(path);
    expect(config.transport).toBe('stdio');
    expect(config.callers.alice.key).toBeUndefined();
  });

  it('passes when HTTP transport has no callers configured at all', () => {
    // No callers means no one can authenticate — the server starts but every
    // /mcp request will get 401. That's a valid (if useless) state; the
    // startup validator only complains about misconfigured callers, not
    // absent ones.
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: streamable-http
`);
    expect(() => loadConfig(path)).not.toThrow();
  });
});

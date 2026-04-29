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

// 32+ char placeholder tokens for the "valid config" tests. Intentionally
// look random-ish so they pass the strength + placeholder checks.
const STRONG_ALICE = 'sk-alice-a1B2c3D4e5F6g7H8i9J0kLmNoPqR';
const STRONG_BOB = 'sk-bob-Z9y8x7w6V5u4T3s2R1q0pOnMlK';

describe('loadConfig — HTTP transport caller-key validation', () => {
  it('throws when HTTP transport is configured and any caller lacks a key', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: streamable-http
callers:
  alice:
    key: ${STRONG_ALICE}
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

  it('passes when HTTP transport is configured and every caller has a strong key', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: streamable-http
callers:
  alice:
    key: ${STRONG_ALICE}
    scopes:
      - path: "**"
        permissions: [read]
  bob:
    key: ${STRONG_BOB}
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

describe('loadConfig — HTTP transport caller-key STRENGTH validation', () => {
  it('rejects keys shorter than 32 characters under HTTP transport', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: streamable-http
callers:
  alice:
    key: too-short
    scopes:
      - path: "**"
        permissions: [read]
`);
    expect(() => loadConfig(path)).toThrow(/at least 32/i);
    expect(() => loadConfig(path)).toThrow(/alice/);
  });

  it('rejects placeholder keys even when the length is sufficient', () => {
    // 36 chars of "changeme", so length passes but pattern catches it
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: streamable-http
callers:
  alice:
    key: changeme-changeme-changeme-changeme
    scopes:
      - path: "**"
        permissions: [read]
`);
    expect(() => loadConfig(path)).toThrow(/placeholder/i);
  });

  it('rejects repeated-character keys (looks like a stand-in)', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: streamable-http
callers:
  alice:
    key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    scopes:
      - path: "**"
        permissions: [read]
`);
    expect(() => loadConfig(path)).toThrow(/placeholder/i);
  });

  it('does not enforce key strength under stdio transport', () => {
    // stdio callers don't use bearer auth, so weak-looking keys should pass.
    // The key field may still be set for other purposes (caller ID display,
    // future cross-transport tooling), and stdio validation shouldn't care.
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: stdio
callers:
  alice:
    key: changeme
    scopes:
      - path: "**"
        permissions: [read]
`);
    expect(() => loadConfig(path)).not.toThrow();
  });
});

describe('loadConfig — listen_host', () => {
  it('defaults to 127.0.0.1 when not specified', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: stdio
`);
    const config = loadConfig(path);
    expect(config.listen_host).toBe('127.0.0.1');
  });

  it('accepts an explicit override', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
transport: stdio
listen_host: "0.0.0.0"
`);
    const config = loadConfig(path);
    expect(config.listen_host).toBe('0.0.0.0');
  });
});

describe('loadConfig — legacy search.fulltext key', () => {
  it('silently accepts and ignores `search.fulltext` in old configs', () => {
    // The flag was removed in v0.3 — it never gated any code path, and
    // operators with it set to either value should keep starting up
    // without a config error.
    const path = writeConfig(`
document_roots:
  notes:
    path: .
search:
  fulltext: false
  sync_on_start: blocking
`);
    expect(() => loadConfig(path)).not.toThrow();
    const config = loadConfig(path);
    expect((config.search as Record<string, unknown>).fulltext).toBeUndefined();
  });
});

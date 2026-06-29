// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '@nullproof-studio/en-core';

/**
 * Legacy / deprecated config-key warnings. Operators upgrading from
 * earlier versions may carry stale keys that no longer gate any
 * behaviour — silently dropping them lets the stale key linger and
 * misrepresents what the server is doing. Loader emits an explicit
 * console.warn for each known stale key.
 */

let dir: string;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legacy-cfg-'));
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  warnSpy.mockRestore();
});

function writeConfig(yaml: string): string {
  const path = join(dir, 'config.yaml');
  writeFileSync(path, yaml);
  return path;
}

describe('loadConfig — legacy search.fulltext key', () => {
  it('warns when search.fulltext: false is present (FTS is always on)', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
search:
  fulltext: false
`);
    loadConfig(path);
    expect(warnSpy).toHaveBeenCalled();
    const message = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toMatch(/search\.fulltext/);
    expect(message).toMatch(/deprecated|removed|always on/i);
  });

  it('warns even when search.fulltext: true is present (still no-op)', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
search:
  fulltext: true
`);
    loadConfig(path);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does not warn when search.fulltext is absent', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
`);
    loadConfig(path);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not throw — startup must continue with a clear message rather than fail', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
search:
  fulltext: false
`);
    expect(() => loadConfig(path)).not.toThrow();
  });
});

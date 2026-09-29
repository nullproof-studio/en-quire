// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '@nullproof-studio/en-core';

// #137 — the loader copies search settings field by field, so the refresh
// settings must be carried through explicitly or they never reach doc_search.

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'search-refresh-cfg-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function load(extra: string) {
  const path = join(dir, 'config.yaml');
  writeFileSync(path, `document_roots:\n  notes:\n    path: .\n${extra}`);
  return loadConfig(path).search;
}

describe('loadConfig — search refresh settings', () => {
  it('defaults to refreshing on search with a 30s rescan interval', () => {
    const search = load('');
    expect(search.refresh_on_search).toBe(true);
    expect(search.rescan_interval_ms).toBe(30_000);
  });

  it('carries explicit values through', () => {
    const search = load('search:\n  refresh_on_search: false\n  rescan_interval_ms: 0\n');
    expect(search.refresh_on_search).toBe(false);
    expect(search.rescan_interval_ms).toBe(0);
  });

  it('rejects a negative rescan interval', () => {
    expect(() => load('search:\n  rescan_interval_ms: -1\n')).toThrow();
  });
});

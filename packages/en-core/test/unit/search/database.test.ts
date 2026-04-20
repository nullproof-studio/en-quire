// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '@nullproof-studio/en-core';

let cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup) {
    rmSync(dir, { recursive: true, force: true });
  }
  cleanup = [];
});

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-db-'));
  cleanup.push(dir);
  return join(dir, 'test.db');
}

describe('openDatabase', () => {
  it('enables WAL journal mode', () => {
    const db = openDatabase(tmpDbPath());
    try {
      const mode = db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
    } finally {
      db.close();
    }
  });

});

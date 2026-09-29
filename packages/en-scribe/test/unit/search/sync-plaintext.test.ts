// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initSearchSchema, syncIndex, getIndexedFiles } from '@nullproof-studio/en-core';
import '../../../src/parsers/plaintext-parser.js';

// #147 — en-scribe's startup sync must index the plain-text formats it
// registers, not the markdown/YAML defaults.

let db: Database.Database;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'enscribe-sync-'));
  db = new Database(':memory:');
  initSearchSchema(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('syncIndex in en-scribe', () => {
  it('indexes .txt, .text and .log files', () => {
    writeFileSync(join(dir, 'notes.txt'), 'hello plain text\n');
    writeFileSync(join(dir, 'readme.text'), 'more text\n');
    writeFileSync(join(dir, 'app.log'), 'log line\n');
    const r = syncIndex(db, 'notes', dir);
    expect(r.indexed).toBe(3);
    expect(getIndexedFiles(db).sort()).toEqual(['notes/app.log', 'notes/notes.txt', 'notes/readme.text']);
  });

  it('ignores markdown, which en-scribe has no parser for', () => {
    writeFileSync(join(dir, 'doc.md'), '# Doc\n');
    writeFileSync(join(dir, 'notes.txt'), 'hello\n');
    syncIndex(db, 'notes', dir);
    expect(getIndexedFiles(db)).toEqual(['notes/notes.txt']);
  });
});

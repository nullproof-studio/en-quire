// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { initSearchSchema } from '../../../src/search/schema.js';
import { syncIndex } from '../../../src/search/sync.js';
import { getIndexedCount, getIndexedFiles } from '../../../src/search/indexer.js';

let db: Database.Database;
let docRoot: string;

function createTempDocRoot(): string {
  const dir = join(tmpdir(), `enquire-sync-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMd(name: string, content: string): void {
  const dir = join(docRoot, ...name.split('/').slice(0, -1));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(docRoot, name), content, 'utf-8');
}

beforeEach(() => {
  docRoot = createTempDocRoot();
  db = new Database(':memory:');
  initSearchSchema(db);
});

afterEach(() => {
  db.close();
  rmSync(docRoot, { recursive: true, force: true });
});

describe('syncIndex', () => {
  it('indexes new files', () => {
    writeMd('doc1.md', '# Title\n\nContent here.');
    writeMd('doc2.md', '# Another\n\nMore content.');

    const result = syncIndex(db, docRoot);
    expect(result.indexed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(getIndexedCount(db)).toBe(2);
  });

  it('skips unchanged files on second sync', () => {
    writeMd('doc1.md', '# Title\n\nContent.');

    syncIndex(db, docRoot);
    const result = syncIndex(db, docRoot);

    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('re-indexes modified files', () => {
    writeMd('doc1.md', '# Title\n\nOriginal.');
    syncIndex(db, docRoot);

    // Touch the file with new content (need to ensure mtime changes)
    const future = Date.now() + 2000;
    writeMd('doc1.md', '# Title\n\nUpdated content.');
    utimesSync(join(docRoot, 'doc1.md'), new Date(future), new Date(future));

    const result = syncIndex(db, docRoot);
    expect(result.indexed).toBe(1);
  });

  it('removes deleted files from index', () => {
    writeMd('doc1.md', '# Title\n\nContent.');
    writeMd('doc2.md', '# Title 2\n\nContent 2.');
    syncIndex(db, docRoot);
    expect(getIndexedCount(db)).toBe(2);

    unlinkSync(join(docRoot, 'doc2.md'));

    const result = syncIndex(db, docRoot);
    expect(result.removed).toBe(1);
    expect(getIndexedCount(db)).toBe(1);
  });

  it('batches indexing with custom batch size', () => {
    // Create 5 files, batch size 2 → 3 batches (2, 2, 1)
    for (let i = 0; i < 5; i++) {
      writeMd(`doc${i}.md`, `# Doc ${i}\n\nContent ${i}.`);
    }

    const result = syncIndex(db, docRoot, 2);
    expect(result.indexed).toBe(5);
    expect(getIndexedCount(db)).toBe(5);
  });

  it('handles batch removal of deleted files', () => {
    for (let i = 0; i < 10; i++) {
      writeMd(`doc${i}.md`, `# Doc ${i}\n\nContent.`);
    }
    syncIndex(db, docRoot);
    expect(getIndexedCount(db)).toBe(10);

    // Delete half
    for (let i = 0; i < 5; i++) {
      unlinkSync(join(docRoot, `doc${i}.md`));
    }

    const result = syncIndex(db, docRoot);
    expect(result.removed).toBe(5);
    expect(getIndexedCount(db)).toBe(5);
  });

  it('reports elapsed time', () => {
    writeMd('doc1.md', '# Title\n\nContent.');
    const result = syncIndex(db, docRoot);
    expect(typeof result.elapsed_ms).toBe('number');
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('handles nested directory structures', () => {
    writeMd('sops/deployment.md', '# Deploy\n\nSteps.');
    writeMd('sops/rollback.md', '# Rollback\n\nSteps.');
    writeMd('runbooks/oncall.md', '# Oncall\n\nGuide.');

    const result = syncIndex(db, docRoot);
    expect(result.indexed).toBe(3);
  });

  it('indexes .mdx files alongside .md files', () => {
    writeMd('guide.md', '# Guide\n\nContent.');
    writeMd('component.mdx', '# Button\n\nimport { Button } from "./Button"\n\nA button component.');

    const result = syncIndex(db, docRoot);
    expect(result.indexed).toBe(2);
    expect(getIndexedFiles(db).sort()).toEqual(['component.mdx', 'guide.md']);
  });

  it('skips unparseable files gracefully', () => {
    writeMd('good.md', '# Good\n\nContent.');
    // Write a file with invalid UTF-8
    writeFileSync(join(docRoot, 'bad.md'), Buffer.from([0x80, 0x81, 0x82, 0x83]));

    const result = syncIndex(db, docRoot);
    // good.md indexed, bad.md skipped
    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

describe('getIndexedFiles', () => {
  it('returns empty array for empty index', () => {
    expect(getIndexedFiles(db)).toEqual([]);
  });

  it('returns all indexed file paths', () => {
    writeMd('a.md', '# A\n\nContent.');
    writeMd('b.md', '# B\n\nContent.');
    writeMd('sub/c.md', '# C\n\nContent.');
    syncIndex(db, docRoot);

    const files = getIndexedFiles(db);
    expect(files.sort()).toEqual(['a.md', 'b.md', 'sub/c.md']);
  });
});

describe('scalability smoke test', () => {
  it('indexes 500 files in batches without error', () => {
    for (let i = 0; i < 500; i++) {
      writeMd(`docs/doc${String(i).padStart(4, '0')}.md`, `# Document ${i}\n\n## Section A\n\nContent for document ${i}.\n\n## Section B\n\nMore content.\n`);
    }

    const result = syncIndex(db, docRoot, 100);
    expect(result.indexed).toBe(500);
    expect(getIndexedCount(db)).toBe(500);
    expect(getIndexedFiles(db).length).toBe(500);

    // Second sync should skip all
    const result2 = syncIndex(db, docRoot, 100);
    expect(result2.indexed).toBe(0);
    expect(result2.skipped).toBe(500);
  });
});

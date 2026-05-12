// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initSearchSchema,
  indexDocument,
  parserRegistry,
  removeEmbeddingsForFile,
} from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initSearchSchema(db);
  // Pretend the targets are already indexed so link resolution doesn't `?`-tag them.
  db.prepare(`INSERT INTO index_metadata (file_path, mtime_ms, indexed_at) VALUES (?, ?, ?)`)
    .run('docs/sops/runbook.md', Date.now(), new Date().toISOString());
});

afterEach(() => db.close());

function listLinks(file: string): Array<{ target_file: string; relationship: string }> {
  return db.prepare(
    `SELECT target_file, relationship FROM doc_links WHERE source_file = ? ORDER BY id`,
  ).all(file) as Array<{ target_file: string; relationship: string }>;
}

/**
 * Regression: the write path used to call `indexDocument(db, path, tree, content)`
 * with no links argument, which makes `storeLinks` clear every existing
 * doc_links row for the file. The fix is to extract links via the parser
 * and pass them through. This test simulates the exact call shape the
 * write helpers now use.
 */
describe('write path preserves doc_links', () => {
  it('storing a file with links creates the corresponding doc_links rows', () => {
    const content = '# Doc\n\nSee [the runbook](../sops/runbook.md) for context.\n';
    const parser = parserRegistry.getParser('skills/triage.md');
    const tree = parser.parse(content);
    const links = parser.extractLinks?.(content) ?? [];

    indexDocument(db, 'docs/skills/triage.md', tree, content, undefined, links);

    const rows = listLinks('docs/skills/triage.md');
    expect(rows).toHaveLength(1);
    expect(rows[0].target_file).toBe('docs/sops/runbook.md');
    expect(rows[0].relationship).toBe('references');
  });

  it('omitting the links argument leaves doc_links rows untouched (deferred-storage mode)', () => {
    const content = '# Doc\n\nSee [the runbook](../sops/runbook.md) for context.\n';
    const parser = parserRegistry.getParser('skills/triage.md');
    const tree = parser.parse(content);
    const links = parser.extractLinks?.(content) ?? [];

    // Initial index — links present
    indexDocument(db, 'docs/skills/triage.md', tree, content, undefined, links);
    expect(listLinks('docs/skills/triage.md')).toHaveLength(1);

    // Re-index WITHOUT links argument. With the new contract, undefined
    // means "I'll handle link storage separately" — rows must be left
    // alone. (Used by syncIndex to defer link storage until every file's
    // metadata row is in place.)
    indexDocument(db, 'docs/skills/triage.md', tree, content);
    expect(listLinks('docs/skills/triage.md')).toHaveLength(1);
  });

  it('passing [] for links explicitly clears existing rows', () => {
    const content = '# Doc\n\nSee [the runbook](../sops/runbook.md) for context.\n';
    const parser = parserRegistry.getParser('skills/triage.md');
    const tree = parser.parse(content);
    const links = parser.extractLinks?.(content) ?? [];

    indexDocument(db, 'docs/skills/triage.md', tree, content, undefined, links);
    expect(listLinks('docs/skills/triage.md')).toHaveLength(1);

    indexDocument(db, 'docs/skills/triage.md', tree, content, undefined, []);
    expect(listLinks('docs/skills/triage.md')).toEqual([]);
  });

  it('re-indexing with re-extracted links keeps the doc_links rows in sync', () => {
    const content = '# Doc\n\nSee [the runbook](../sops/runbook.md) for context.\n';
    const parser = parserRegistry.getParser('skills/triage.md');
    const tree = parser.parse(content);
    const links = parser.extractLinks?.(content) ?? [];

    indexDocument(db, 'docs/skills/triage.md', tree, content, undefined, links);
    indexDocument(db, 'docs/skills/triage.md', tree, content, undefined, links);

    expect(listLinks('docs/skills/triage.md')).toHaveLength(1);
  });
});

describe('removeEmbeddingsForFile is safe when semantic is disabled', () => {
  it('no-ops without throwing when vec_section_meta does not exist', () => {
    expect(() => removeEmbeddingsForFile(db, 'docs/anything.md')).not.toThrow();
  });
});

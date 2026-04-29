// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initSearchSchema,
  storeLinks,
  removeLinks,
} from '@nullproof-studio/en-core';

let db: Database.Database;

function indexFakeFile(path: string): void {
  db.prepare(
    `INSERT INTO index_metadata (file_path, mtime_ms, indexed_at) VALUES (?, ?, ?)`,
  ).run(path, Date.now(), new Date().toISOString());
}

function listLinks(source: string): Array<{
  source_section: string | null;
  target_file: string;
  target_section: string | null;
  relationship: string;
}> {
  return db.prepare(
    `SELECT source_section, target_file, target_section, relationship
     FROM doc_links WHERE source_file = ? ORDER BY id`,
  ).all(source) as Array<{
    source_section: string | null;
    target_file: string;
    target_section: string | null;
    relationship: string;
  }>;
}

beforeEach(() => {
  db = new Database(':memory:');
  initSearchSchema(db);
});

afterEach(() => {
  db.close();
});

describe('storeLinks resolution', () => {
  it('resolves a relative markdown link against the source directory', () => {
    indexFakeFile('docs/sops/runbook.md');
    indexFakeFile('docs/skills/triage.md');

    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: 'Tool Selection',
      target_path: '../sops/runbook.md',
      target_section: 'checks',
      relationship: 'references',
      context: 'Read more in [the runbook](../sops/runbook.md#checks)',
    }]);

    const rows = listLinks('docs/skills/triage.md');
    expect(rows).toHaveLength(1);
    expect(rows[0].target_file).toBe('docs/sops/runbook.md');
    expect(rows[0].target_section).toBe('checks');
    expect(rows[0].source_section).toBe('Tool Selection');
  });

  it('treats a leading `/` as root-anchored, not as relative-to-source', () => {
    indexFakeFile('docs/sops/runbook.md');
    indexFakeFile('docs/skills/triage.md');

    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: null,
      target_path: '/docs/sops/runbook.md',
      target_section: null,
      relationship: 'references',
      context: null,
    }]);

    const rows = listLinks('docs/skills/triage.md');
    expect(rows[0].target_file).toBe('docs/sops/runbook.md');
  });

  it('marks an unindexed root-anchored target with `?<stripped>`', () => {
    indexFakeFile('docs/sops/runbook.md');
    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: null,
      target_path: '/docs/sops/missing.md',
      target_section: null,
      relationship: 'references',
      context: null,
    }]);
    expect(listLinks('docs/skills/triage.md')[0].target_file).toBe('?docs/sops/missing.md');
  });

  it('marks an unindexed path-shaped target with `?`', () => {
    indexFakeFile('docs/sops/runbook.md');
    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: null,
      target_path: '../sops/missing.md',
      target_section: null,
      relationship: 'references',
      context: null,
    }]);
    const rows = listLinks('docs/skills/triage.md');
    expect(rows[0].target_file).toBe('?docs/sops/missing.md');
  });

  it('resolves a wiki-style basename to a single indexed file', () => {
    indexFakeFile('docs/sops/runbook.md');
    indexFakeFile('docs/skills/triage.md');

    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: 'Notes',
      target_path: 'runbook',
      target_section: null,
      relationship: 'references',
      context: 'See [[runbook]] for context.',
    }]);
    const rows = listLinks('docs/skills/triage.md');
    expect(rows[0].target_file).toBe('docs/sops/runbook.md');
  });

  it('marks ambiguous wiki targets with `?`', () => {
    indexFakeFile('docs/sops/runbook.md');
    indexFakeFile('skills/runbook.md'); // different file, same basename

    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: null,
      target_path: 'runbook',
      target_section: null,
      relationship: 'references',
      context: null,
    }]);
    expect(listLinks('docs/skills/triage.md')[0].target_file).toBe('?runbook');
  });

  it('marks unmatched wiki targets with `?`', () => {
    indexFakeFile('docs/sops/runbook.md');
    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: null,
      target_path: 'no-such-doc',
      target_section: null,
      relationship: 'references',
      context: null,
    }]);
    expect(listLinks('docs/skills/triage.md')[0].target_file).toBe('?no-such-doc');
  });

  it('passes through prefixed targets without re-resolving', () => {
    storeLinks(db, 'docs/foo.md', [{
      source_section: null,
      target_path: 'docs/sops/runbook.md',
      target_section: null,
      relationship: 'implements',
      context: null,
      prefixed: true,
    }]);
    expect(listLinks('docs/foo.md')[0].target_file).toBe('docs/sops/runbook.md');
  });

  it('replaces all rows for a source on each call (idempotent re-index)', () => {
    indexFakeFile('docs/sops/runbook.md');
    indexFakeFile('docs/skills/triage.md');

    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: 'A', target_path: '../sops/runbook.md', target_section: null,
      relationship: 'references', context: null,
    }, {
      source_section: 'B', target_path: '../sops/runbook.md', target_section: null,
      relationship: 'references', context: null,
    }]);
    expect(listLinks('docs/skills/triage.md')).toHaveLength(2);

    // Re-index with a different shape — must replace, not append
    storeLinks(db, 'docs/skills/triage.md', [{
      source_section: 'C', target_path: '../sops/runbook.md', target_section: null,
      relationship: 'see_also', context: null,
    }]);
    const rows = listLinks('docs/skills/triage.md');
    expect(rows).toHaveLength(1);
    expect(rows[0].source_section).toBe('C');
    expect(rows[0].relationship).toBe('see_also');
  });

  it('removeLinks deletes only rows for the given source', () => {
    indexFakeFile('docs/a.md');
    indexFakeFile('docs/b.md');
    indexFakeFile('docs/c.md');

    storeLinks(db, 'docs/a.md', [{
      source_section: null, target_path: 'b', target_section: null,
      relationship: 'references', context: null,
    }]);
    storeLinks(db, 'docs/b.md', [{
      source_section: null, target_path: 'c', target_section: null,
      relationship: 'references', context: null,
    }]);

    removeLinks(db, 'docs/a.md');

    expect(listLinks('docs/a.md')).toHaveLength(0);
    expect(listLinks('docs/b.md')).toHaveLength(1);
  });
});

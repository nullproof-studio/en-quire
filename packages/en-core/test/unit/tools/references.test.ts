// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  handleReferences,
  handleReferencedBy,
  ReferencesSchema,
  ReferencedBySchema,
  initSearchSchema,
  storeLinks,
  PermissionDeniedError,
} from '@nullproof-studio/en-core';
import type { ToolContext, CallerIdentity, ResolvedConfig } from '@nullproof-studio/en-core';
import type { z } from 'zod';

let db: Database.Database;

function ctxWithReadAll(): ToolContext {
  return buildContext([{ path: '**', permissions: ['read'] }]);
}

function buildContext(scopes: CallerIdentity['scopes']): ToolContext {
  const config: ResolvedConfig = {
    document_roots: {},
    database: ':memory:',
    transport: 'stdio',
    port: 3100,
    listen_host: '127.0.0.1',
    search: {
      fulltext: true,
      sync_on_start: 'blocking',
      batch_size: 500,
      semantic: { enabled: false },
    },
    logging: { level: 'error', dir: null },
    callers: {},
    require_read_before_write: true,
  };
  return {
    config,
    roots: {},
    caller: { id: 'tester', scopes },
    db,
  };
}

function indexFakeFile(path: string): void {
  db.prepare(
    `INSERT INTO index_metadata (file_path, mtime_ms, indexed_at) VALUES (?, ?, ?)`,
  ).run(path, Date.now(), new Date().toISOString());
}

beforeEach(() => {
  db = new Database(':memory:');
  initSearchSchema(db);

  // Seed: skills/triage.md references sops/runbook.md (twice — section A and B)
  // and sops/deployment.md once. sops/runbook.md references sops/deployment.md.
  indexFakeFile('docs/skills/triage.md');
  indexFakeFile('docs/sops/runbook.md');
  indexFakeFile('docs/sops/deployment.md');

  storeLinks(db, 'docs/skills/triage.md', [
    {
      source_section: 'Tool Selection',
      target_path: '../sops/runbook.md',
      target_section: 'checks',
      relationship: 'references',
      context: 'See [the runbook](../sops/runbook.md#checks)',
    },
    {
      source_section: 'Notes',
      target_path: '../sops/runbook.md',
      target_section: null,
      relationship: 'references',
      context: 'and the [runbook](../sops/runbook.md)',
    },
    {
      source_section: 'Notes',
      target_path: '../sops/deployment.md',
      target_section: null,
      relationship: 'see_also',
      context: '[deployment](../sops/deployment.md)',
    },
  ]);
  storeLinks(db, 'docs/sops/runbook.md', [
    {
      source_section: 'Procedure',
      target_path: 'deployment.md',
      target_section: null,
      relationship: 'implements',
      context: 'see [deployment](deployment.md)',
    },
  ]);
});

afterEach(() => {
  db.close();
});

describe('handleReferences', () => {
  it('returns all outgoing references for a file', async () => {
    const args: z.infer<typeof ReferencesSchema> = { file: 'docs/skills/triage.md' };
    const result = await handleReferences(args, ctxWithReadAll()) as {
      references: Array<{ target_file: string; relationship: string }>;
    };
    expect(result.references).toHaveLength(3);
    const targets = result.references.map((r) => r.target_file).sort();
    expect(targets).toEqual([
      'docs/sops/deployment.md',
      'docs/sops/runbook.md',
      'docs/sops/runbook.md',
    ]);
  });

  it('filters to a specific source section when provided', async () => {
    const args: z.infer<typeof ReferencesSchema> = {
      file: 'docs/skills/triage.md',
      section: 'Notes',
    };
    const result = await handleReferences(args, ctxWithReadAll()) as {
      references: Array<{ target_file: string; relationship: string }>;
    };
    expect(result.references).toHaveLength(2);
    for (const r of result.references) {
      expect(['docs/sops/runbook.md', 'docs/sops/deployment.md']).toContain(r.target_file);
    }
  });

  it('returns empty when the file has no outgoing references', async () => {
    const args: z.infer<typeof ReferencesSchema> = { file: 'docs/sops/deployment.md' };
    const result = await handleReferences(args, ctxWithReadAll()) as { references: unknown[] };
    expect(result.references).toEqual([]);
  });

  it('rejects callers without read permission for the file', async () => {
    const ctx = buildContext([{ path: 'docs/sops/**', permissions: ['read'] }]);
    const args: z.infer<typeof ReferencesSchema> = { file: 'docs/skills/triage.md' };
    await expect(handleReferences(args, ctx)).rejects.toThrow(PermissionDeniedError);
  });
});

describe('handleReferencedBy', () => {
  it('returns all incoming references for a file', async () => {
    const args: z.infer<typeof ReferencedBySchema> = { file: 'docs/sops/runbook.md' };
    const result = await handleReferencedBy(args, ctxWithReadAll()) as {
      referenced_by: Array<{ source_file: string; source_section: string | null; relationship: string }>;
    };
    expect(result.referenced_by).toHaveLength(2);
    for (const r of result.referenced_by) {
      expect(r.source_file).toBe('docs/skills/triage.md');
    }
  });

  it('filters to incoming references at a specific target section', async () => {
    const args: z.infer<typeof ReferencedBySchema> = {
      file: 'docs/sops/runbook.md',
      section: 'checks',
    };
    const result = await handleReferencedBy(args, ctxWithReadAll()) as {
      referenced_by: Array<{ source_section: string | null }>;
    };
    expect(result.referenced_by).toHaveLength(1);
    expect(result.referenced_by[0].source_section).toBe('Tool Selection');
  });

  it('returns implements/see_also/etc., not just references', async () => {
    const args: z.infer<typeof ReferencedBySchema> = { file: 'docs/sops/deployment.md' };
    const result = await handleReferencedBy(args, ctxWithReadAll()) as {
      referenced_by: Array<{ source_file: string; relationship: string }>;
    };
    expect(result.referenced_by).toHaveLength(2);
    const rels = result.referenced_by.map((r) => r.relationship).sort();
    expect(rels).toEqual(['implements', 'see_also']);
  });

  it('rejects callers without read permission for the queried file', async () => {
    const ctx = buildContext([{ path: 'docs/skills/**', permissions: ['read'] }]);
    const args: z.infer<typeof ReferencedBySchema> = { file: 'docs/sops/runbook.md' };
    await expect(handleReferencedBy(args, ctx)).rejects.toThrow(PermissionDeniedError);
  });
});

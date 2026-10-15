// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import '../../../src/parsers/markdown-parser.js';
import '../../../src/parsers/yaml-parser.js';
import '../../../src/parsers/jsonl-parser.js';
import type { ToolContext, ResolvedConfig, CallerIdentity, RootContext } from '@nullproof-studio/en-core';
import { initSearchSchema, GitOperations } from '@nullproof-studio/en-core';
import { handleDocCreate, DocCreateSchema } from '../../../src/tools/write/doc-create.js';
import { handleDocRenameSection, DocRenameSectionSchema } from '../../../src/tools/write/doc-rename-section.js';
import { handleDocFindReplace, DocFindReplaceSchema } from '../../../src/tools/write/doc-find-replace.js';
import { handleDocDeleteSection, DocDeleteSectionSchema } from '../../../src/tools/write/doc-delete-section.js';
import { handleDocAppendSection, DocAppendSectionSchema } from '../../../src/tools/write/doc-append-section.js';

/**
 * #154 — changing a heading's text changes its slug, so inbound
 * `[text](doc.md#old-slug)` and `[[doc#Old Heading]]` links break silently.
 * The link index already knows both sides; every write that removes a slug
 * or ^id with inbound links should say so (warn, never block).
 */

interface TestEnv { ctx: ToolContext; dir: string; cleanup: () => void; }

const ALL: CallerIdentity['scopes'] = [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search'] }];

function makeCtx(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-hlw-'));
  const db = new Database(':memory:');
  initSearchSchema(db);
  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false } } },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' }, callers: {}, require_read_before_write: false,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes: ALL };
  const roots: Record<string, RootContext> = { docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) } };
  return { ctx: { config, roots, caller, db }, dir, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

let env: TestEnv;
beforeEach(async () => {
  env = makeCtx();
  // Target first, so the sources' links resolve against an indexed file.
  await create('spec.md', '# Spec\n\n## Storage Mapping ^store-map\n\ns.\n\n## Retry Policy\n\nr.\n\n## Unlinked\n\nu.\n');
  await create('guide.md', '# Guide\n\n## Overview\n\nSee [mapping](spec.md#storage-mapping) and [retries](spec.md#retry-policy).\n');
  await create('notes.md', '# Notes\n\nPer [[spec#Retry Policy]] and [[spec#^store-map]].\n');
});
afterEach(() => { env.cleanup(); });

async function create(file: string, content: string) {
  await handleDocCreate(DocCreateSchema.parse({ file: `docs/${file}`, content }), env.ctx);
}

const warningsOf = (result: unknown) => ((result as { warnings?: string[] }).warnings ?? []).join('\n');

describe('write warnings for inbound links to removed headings', () => {
  it('doc_rename_section warns about slug and wiki links to the old heading', async () => {
    const result = await handleDocRenameSection(
      DocRenameSectionSchema.parse({ file: 'docs/spec.md', section: 'Retry Policy', new_heading: 'Retry Policy (v2)' }),
      env.ctx,
    );
    const w = warningsOf(result);
    expect(w).toMatch(/"Retry Policy"/);
    expect(w).toMatch(/2 inbound links/);
    expect(w).toContain('docs/guide.md (§ Guide > Overview)');
    expect(w).toContain('docs/notes.md');
  });

  it('doc_rename_section keeps ^id links (anchor carried across) but warns about the slug link', async () => {
    const result = await handleDocRenameSection(
      DocRenameSectionSchema.parse({ file: 'docs/spec.md', section: '^store-map', new_heading: 'Storage Layout' }),
      env.ctx,
    );
    const w = warningsOf(result);
    expect(w).toMatch(/1 inbound link\b/);
    expect(w).toContain('docs/guide.md');
    expect(w).not.toContain('docs/notes.md');
  });

  it('a heading changed via doc_find_replace warns and points at doc_rename_section', async () => {
    const result = await handleDocFindReplace(
      DocFindReplaceSchema.parse({ file: 'docs/spec.md', find: '## Retry Policy', replace: '## Retries' }),
      env.ctx,
    );
    const w = warningsOf(result);
    expect(w).toMatch(/"Retry Policy"/);
    expect(w).toMatch(/doc_rename_section/);
  });

  it('doc_delete_section warns, including links to the removed ^id', async () => {
    const result = await handleDocDeleteSection(
      DocDeleteSectionSchema.parse({ file: 'docs/spec.md', section: 'Storage Mapping' }),
      env.ctx,
    );
    const w = warningsOf(result);
    expect(w).toMatch(/2 inbound links/);
    expect(w).toContain('docs/guide.md');
    expect(w).toContain('docs/notes.md');
  });

  it('is silent for body-only edits and for headings nothing links to', async () => {
    const append = await handleDocAppendSection(
      DocAppendSectionSchema.parse({ file: 'docs/spec.md', section: 'Retry Policy', content: 'more.' }),
      env.ctx,
    );
    expect(warningsOf(append)).toBe('');
    const rename = await handleDocRenameSection(
      DocRenameSectionSchema.parse({ file: 'docs/spec.md', section: 'Unlinked', new_heading: 'Still Unlinked' }),
      env.ctx,
    );
    expect(warningsOf(rename)).toBe('');
  });

  it('does not reveal source files the caller cannot read', async () => {
    env.ctx.caller = {
      id: 'scoped',
      scopes: [
        { path: 'docs/spec.md', permissions: ['read', 'write'] },
        { path: 'docs/guide.md', permissions: ['read'] },
      ],
    };
    const result = await handleDocRenameSection(
      DocRenameSectionSchema.parse({ file: 'docs/spec.md', section: 'Retry Policy', new_heading: 'Retries' }),
      env.ctx,
    );
    const w = warningsOf(result);
    expect(w).toContain('docs/guide.md');
    expect(w).not.toContain('notes');
    expect(w).toMatch(/1 inbound link\b/);
  });

  it('caps the listed sources', async () => {
    for (let i = 0; i < 15; i++) {
      await create(`ref${String(i).padStart(2, '0')}.md`, `# Ref ${i}\n\n[r](spec.md#retry-policy)\n`);
    }
    const result = await handleDocRenameSection(
      DocRenameSectionSchema.parse({ file: 'docs/spec.md', section: 'Retry Policy', new_heading: 'Retries' }),
      env.ctx,
    );
    const w = warningsOf(result);
    expect(w).toMatch(/17 inbound links/);
    expect(w).toMatch(/and 7 more/);
  });

  // The backlink index is otherwise refreshed only at startup, on en-quire's
  // own writes and before searches — links added by editors, git or other
  // tools since then must still be seen before warning.
  it('sees links added outside en-quire since the last index refresh', async () => {
    const guide = join(env.dir, 'guide.md');
    writeFileSync(guide, '# Guide\n\n## Overview\n\nNow also [policy](spec.md#unlinked).\n');
    const later = new Date(Date.now() + 5_000);
    utimesSync(guide, later, later);
    writeFileSync(join(env.dir, 'fresh.md'), '# Fresh\n\n[u](spec.md#unlinked)\n');

    const result = await handleDocRenameSection(
      DocRenameSectionSchema.parse({ file: 'docs/spec.md', section: 'Unlinked', new_heading: 'Now Linked' }),
      env.ctx,
    );
    const w = warningsOf(result);
    expect(w).toMatch(/2 inbound links/);
    expect(w).toContain('docs/guide.md');
    expect(w).toContain('docs/fresh.md');
  });
});

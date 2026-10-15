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
import { handleDocRename, DocRenameSchema } from '../../../src/tools/write/doc-rename.js';

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

describe('same-document links', () => {
  it('warns about in-document links to a renamed heading', async () => {
    await create('self.md', '# Self\n\n## Intro\n\nSee [below](#details) and [[#Details]].\n\n## Details\n\nd.\n');
    const result = await handleDocRenameSection(
      DocRenameSectionSchema.parse({ file: 'docs/self.md', section: 'Details', new_heading: 'Specifics' }),
      env.ctx,
    );
    const w = warningsOf(result);
    expect(w).toMatch(/2 inbound links/);
    expect(w).toContain('docs/self.md (§ Self > Intro)');
  });

  it('is silent when the same write updates the in-document links too', async () => {
    await create('self.md', '# Self\n\n## Intro\n\nSee [[#Details]].\n\n## Details\n\nd.\n');
    const result = await handleDocFindReplace(
      DocFindReplaceSchema.parse({ file: 'docs/self.md', find: 'Details', replace: 'Specifics' }),
      env.ctx,
    );
    expect(warningsOf(result)).toBe('');
  });
});

// Renaming or moving a file breaks path links to it, and the moved file's own
// relative links if it changes folder. Wiki links resolve by basename, so a
// folder move alone leaves them working.
describe('doc_rename', () => {
  const rename = (source: string, destination: string) => handleDocRename(
    DocRenameSchema.parse({ source: `docs/${source}`, destination: `docs/${destination}` }),
    env.ctx,
  );

  it('warns about path links to the old location; wiki links survive a folder move', async () => {
    await create('archive/index.md', '# Archive\n'); // doc_rename doesn't create folders
    const w = warningsOf(await rename('spec.md', 'archive/spec.md'));
    expect(w).toMatch(/2 inbound links/); // guide's two path links
    expect(w).toContain('docs/guide.md (§ Guide > Overview)');
    expect(w).not.toContain('docs/notes.md');
    expect(w).toContain('docs/archive/spec.md');
  });

  it('warns about wiki links too when the basename changes', async () => {
    const w = warningsOf(await rename('spec.md', 'design.md'));
    expect(w).toMatch(/4 inbound links/); // guide's two path links + notes' two wiki links
    expect(w).toContain('docs/notes.md');
  });

  it('warns about the moved file\'s relative links that no longer resolve', async () => {
    await create('sub/b.md', '# B\n');
    await create('sub/a.md', '# A\n\n## Links\n\n[b](b.md), [b again](./b.md), [spec](../spec.md), [[guide]], [self](#links).\n');
    const w = warningsOf(await rename('sub/a.md', 'a.md'));
    expect(w).toMatch(/3 links in docs\/a\.md no longer resolve/);
    expect(w).toContain('docs/sub/b.md');
    expect(w).toContain('docs/spec.md');
    expect(w).not.toContain('guide');
  });

  it('indexes the destination so its links and backlinks are live straight away', async () => {
    await rename('guide.md', 'handbook.md');
    const rows = env.ctx.db.prepare('SELECT target_file FROM doc_links WHERE source_file = ?').all('docs/handbook.md');
    expect(rows).toHaveLength(2);
    const indexed = env.ctx.db.prepare('SELECT 1 FROM index_metadata WHERE file_path = ?').get('docs/handbook.md');
    expect(indexed).toBeDefined();
  });

  it('does not reveal linking files the caller cannot read', async () => {
    env.ctx.caller = {
      id: 'scoped',
      scopes: [
        { path: 'docs/spec.md', permissions: ['read', 'write'] },
        { path: 'docs/design.md', permissions: ['read', 'write'] },
        { path: 'docs/guide.md', permissions: ['read'] },
      ],
    };
    const w = warningsOf(await rename('spec.md', 'design.md'));
    expect(w).toMatch(/2 inbound links/); // guide only
    expect(w).not.toContain('notes');
  });

  it('is silent when nothing links to the file and its own links still resolve', async () => {
    expect(warningsOf(await rename('notes.md', 'journal.md'))).toBe('');
  });
});


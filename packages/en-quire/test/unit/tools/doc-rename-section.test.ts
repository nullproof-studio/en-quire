// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import '../../../src/parsers/markdown-parser.js';
import '../../../src/parsers/yaml-parser.js';
import '../../../src/parsers/jsonl-parser.js';
import type { ToolContext, ResolvedConfig, CallerIdentity, RootContext } from '@nullproof-studio/en-core';
import { initSearchSchema, GitOperations, ToolRegistry } from '@nullproof-studio/en-core';
import { registerEnQuireTools } from '../../../src/plugin.js';
import { handleDocRenameSection, DocRenameSectionSchema } from '../../../src/tools/write/doc-rename-section.js';

/**
 * doc_rename_section — see https://github.com/nullproof-studio/en-quire/issues/107
 *
 * Renaming a heading used to mean `doc_replace_section` with
 * `replace_heading: true`, which replaces the section from heading start to
 * body end — so the caller had to read the body and send it back, or lose it.
 * This tool renames the heading line and nothing else. The absence of a
 * `content` parameter is the safety property: there is no way to pass a body,
 * so there is no way to clobber one.
 */

interface TestEnv { ctx: ToolContext; dir: string; cleanup: () => void; }

function makeCtx(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-rs-'));
  const db = new Database(':memory:');
  initSearchSchema(db);
  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false, branch_prefix: '' } } },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' }, callers: {}, require_read_before_write: false,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search'] }] };
  const roots: Record<string, RootContext> = { docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) } };
  return { ctx: { config, roots, caller, db }, dir, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

let env: TestEnv;
beforeEach(() => { env = makeCtx(); });
afterEach(() => { env.cleanup(); });

const write = (name: string, body: string) => writeFileSync(join(env.dir, name), body);
const read = (name: string) => readFileSync(join(env.dir, name), 'utf8');

describe('doc_rename_section renames the heading and nothing else', () => {
  it('changes the heading text while leaving the body byte-identical', async () => {
    write('d.md', '# Doc\n\n## Problem Statement\n\nThe body has *formatting*, a [link](x), and\na hard-wrapped second line.\n\n## Next\n\nother.\n');
    await handleDocRenameSection(
      { file: 'docs/d.md', section: 'Problem Statement', new_heading: 'Motivation' },
      env.ctx,
    );
    const out = read('d.md');
    expect(out).toContain('## Motivation');
    expect(out).not.toContain('Problem Statement');
    expect(out).toContain('The body has *formatting*, a [link](x), and\na hard-wrapped second line.');
    expect(out).toContain('## Next\n\nother.');
  });

  it('preserves children and their content', async () => {
    write('d.md', '# Doc\n\n## Problem Statement\n\nintro.\n\n### Goal\n\ng.\n\n### Non-Goals\n\nng.\n');
    await handleDocRenameSection(
      { file: 'docs/d.md', section: 'Problem Statement', new_heading: 'Motivation' },
      env.ctx,
    );
    const out = read('d.md');
    expect(out).toContain('### Goal\n\ng.');
    expect(out).toContain('### Non-Goals\n\nng.');
    expect(out).toContain('intro.');
  });

  it('preserves the heading level', async () => {
    write('d.md', '# Doc\n\n## Parent\n\np.\n\n### Deep\n\nd.\n');
    await handleDocRenameSection(
      { file: 'docs/d.md', section: 'Parent > Deep', new_heading: 'Deeper' },
      env.ctx,
    );
    expect(read('d.md')).toContain('### Deeper');
  });

  it('carries the stable ^id anchor across the rename', async () => {
    write('d.md', '# Doc\n\n## Problem Statement ^prob\n\nbody.\n');
    await handleDocRenameSection(
      { file: 'docs/d.md', section: '^prob', new_heading: 'Motivation' },
      env.ctx,
    );
    const out = read('d.md');
    expect(out).toContain('## Motivation ^prob');
  });

  it('accepts an explicit new anchor in new_heading rather than forcing the old one', async () => {
    write('d.md', '# Doc\n\n## Old ^a\n\nbody.\n');
    await handleDocRenameSection(
      { file: 'docs/d.md', section: '^a', new_heading: 'New ^b' },
      env.ctx,
    );
    const out = read('d.md');
    expect(out).toContain('## New ^b');
    expect(out).not.toContain('^a');
  });

  it('strips heading markers if the agent includes them', async () => {
    write('d.md', '# Doc\n\n## Old\n\nbody.\n');
    await handleDocRenameSection(
      { file: 'docs/d.md', section: 'Old', new_heading: '## New' },
      env.ctx,
    );
    const out = read('d.md');
    expect(out).toContain('## New\n');
    expect(out).not.toContain('## ## New');
  });

  it('resolves the section by breadcrumb path', async () => {
    write('d.md', '# Doc\n\n## A\n\n### Shared\n\na.\n\n## B\n\n### Shared\n\nb.\n');
    await handleDocRenameSection(
      { file: 'docs/d.md', section: 'B > Shared', new_heading: 'Renamed' },
      env.ctx,
    );
    const out = read('d.md');
    expect(out).toContain('## A\n\n### Shared\n\na.');
    expect(out).toContain('## B\n\n### Renamed\n\nb.');
  });

  it('returns a fresh etag so renames can be chained without re-reading', async () => {
    write('d.md', '# Doc\n\n## One\n\na.\n\n## Two\n\nb.\n');
    const first = await handleDocRenameSection(
      { file: 'docs/d.md', section: 'One', new_heading: 'Uno' },
      env.ctx,
    ) as { etag?: string };
    expect(first.etag).toBeTruthy();
    const second = await handleDocRenameSection(
      { file: 'docs/d.md', section: 'Two', new_heading: 'Dos' },
      env.ctx,
    ) as { etag?: string };
    expect(second.etag).toBeTruthy();
    expect(second.etag).not.toBe(first.etag);
    const out = read('d.md');
    expect(out).toContain('## Uno');
    expect(out).toContain('## Dos');
  });
});

describe('doc_rename_section guards', () => {
  it('has no content parameter, so a body cannot be passed at all', () => {
    expect(Object.keys(DocRenameSectionSchema.shape)).not.toContain('content');
  });

  it('rejects a rename that collides with an existing sibling', async () => {
    write('d.md', '# Doc\n\n## One\n\na.\n\n## Two\n\nb.\n');
    await expect(handleDocRenameSection(
      { file: 'docs/d.md', section: 'One', new_heading: 'Two' },
      env.ctx,
    )).rejects.toThrow(/already exists/i);
    expect(read('d.md')).toContain('## One');
  });

  it('rejects an empty heading', async () => {
    write('d.md', '# Doc\n\n## One\n\na.\n');
    await expect(handleDocRenameSection(
      { file: 'docs/d.md', section: 'One', new_heading: '   ' },
      env.ctx,
    )).rejects.toThrow(/empty/i);
  });

  it('rejects a multi-line heading', async () => {
    write('d.md', '# Doc\n\n## One\n\na.\n');
    await expect(handleDocRenameSection(
      { file: 'docs/d.md', section: 'One', new_heading: 'New\n\nsneaky body' },
      env.ctx,
    )).rejects.toThrow(/single line|one line/i);
  });

  it('refuses YAML, where a key rename is not a heading-line edit', async () => {
    write('c.yaml', 'alpha: 1\nbeta: 2\n');
    const err = await handleDocRenameSection(
      { file: 'docs/c.yaml', section: 'alpha', new_heading: 'gamma' },
      env.ctx,
    ).catch((e: Error) => e) as Error;
    expect(err.message).toMatch(/not supported/i);
    expect(err.message).toContain('doc_set_value');
    expect(read('c.yaml')).toBe('alpha: 1\nbeta: 2\n');
  });
});

describe('doc_rename_section is discoverable', () => {
  it('is registered with a description that says the body is untouched', () => {
    const registry = new ToolRegistry();
    registerEnQuireTools(registry);
    const tool = registry.get('doc_rename_section');
    expect(tool).toBeDefined();
    expect(tool!.description).toMatch(/body/i);
  });

  it('is pointed to from doc_replace_section, the expensive path agents currently find', () => {
    const registry = new ToolRegistry();
    registerEnQuireTools(registry);
    expect(registry.get('doc_replace_section')!.description).toContain('doc_rename_section');
  });
});

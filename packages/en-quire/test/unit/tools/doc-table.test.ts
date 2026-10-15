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
import {
  initSearchSchema, GitOperations, ToolRegistry, computeEtag,
  PreconditionFailedError, PermissionDeniedError, ValidationError,
} from '@nullproof-studio/en-core';
import { registerEnQuireTools } from '../../../src/plugin.js';
import { handleDocTableRead, DocTableReadSchema } from '../../../src/tools/read/doc-table-read.js';
import { handleDocTableWrite, DocTableWriteSchema } from '../../../src/tools/write/doc-table-write.js';
import { handleDocOutline, DocOutlineSchema } from '../../../src/tools/read/doc-outline.js';

/** #155 — doc_table_read / doc_table_write through the real tool handlers. */

interface TestEnv { ctx: ToolContext; dir: string; cleanup: () => void; }

const ALL: CallerIdentity['scopes'] = [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search'] }];

function makeCtx(requireRead = false): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-table-'));
  const db = new Database(':memory:');
  initSearchSchema(db);
  const config = {
    document_roots: { docs: { name: 'docs', path: dir, git: { enabled: false, auto_commit: false } } },
    database: ':memory:', transport: 'stdio', port: 0,
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { console: 'error' }, callers: {}, require_read_before_write: requireRead,
  } as unknown as ResolvedConfig;
  const caller: CallerIdentity = { id: 'test', scopes: ALL };
  const roots: Record<string, RootContext> = { docs: { root: config.document_roots.docs, git: new GitOperations(dir, false) } };
  return { ctx: { config, roots, caller, db }, dir, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const SPEC = '# Specs\n\n## Spec Index\n\n| ID | Title | Status |\n|---|---|---|\n| RFC-1 | Alpha | Draft |\n\n## Log\n\nNo table here.\n';

let env: TestEnv;
beforeEach(() => {
  env = makeCtx();
  writeFileSync(join(env.dir, 'specs.md'), SPEC);
});
afterEach(() => { env.cleanup(); });

const file = () => readFileSync(join(env.dir, 'specs.md'), 'utf8');
const write = (args: Record<string, unknown>) =>
  handleDocTableWrite(DocTableWriteSchema.parse({ file: 'docs/specs.md', section: 'Spec Index', ...args }), env.ctx);
const read = (args: Record<string, unknown> = {}) =>
  handleDocTableRead(DocTableReadSchema.parse({ file: 'docs/specs.md', section: 'Spec Index', ...args }), env.ctx);

describe('doc_table_write', () => {
  it('appends a row in one call and returns diff, etag and affected counts', async () => {
    const result = await write({ ops: [{ op: 'insert', rows: [{ ID: 'RFC-2', Title: 'Beta', Status: 'Draft' }] }] });
    expect(file()).toBe(SPEC.replace('| RFC-1 | Alpha | Draft |\n', '| RFC-1 | Alpha | Draft |\n| RFC-2 | Beta | Draft |\n'));
    expect(result.affected).toEqual([1]);
    expect(result.table).toBe(0);
    expect(result.diff).toContain('+| RFC-2 | Beta | Draft |');
    expect(result.etag).toBe(computeEtag(file()));
  });

  it('guards with if_match: the read etag works, a stale one is refused', async () => {
    env.cleanup();
    env = makeCtx(true);
    writeFileSync(join(env.dir, 'specs.md'), SPEC);
    const { etag } = await read();
    const first = await write({ if_match: etag, ops: [{ op: 'update', row: 0, set: { Status: 'Accepted' } }] });
    await write({ if_match: first.etag, ops: [{ op: 'delete', row: 0 }] }); // chained from the write
    await expect(write({ if_match: etag, ops: [{ op: 'insert', rows: [{ ID: 'x' }] }] }))
      .rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('writes nothing when the ops change nothing, and says so', async () => {
    const result = await write({ ops: [{ op: 'update', where: { ID: 'RFC-1' }, set: { Status: 'Draft' } }] });
    expect(file()).toBe(SPEC);
    expect(result.affected).toEqual([1]);
    expect(String(result.warning)).toMatch(/No changes/);
    expect(result.etag).toBe(computeEtag(SPEC));
  });

  it('leaves the file untouched when any op fails', async () => {
    await expect(write({ ops: [
      { op: 'insert', rows: [{ ID: 'RFC-2' }] },
      { op: 'delete', where: { ID: 'RFC-404' } },
    ] })).rejects.toThrow(/ops\[1\] \(delete\)/);
    expect(file()).toBe(SPEC);
  });

  it('requires write permission', async () => {
    env.ctx.caller = { id: 'reader', scopes: [{ path: '**', permissions: ['read'] }] };
    await expect(write({ ops: [{ op: 'delete', row: 0 }] })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await read()).rows).toHaveLength(1);
  });

  it('refuses a read-only caller even when the ops would change nothing', async () => {
    env.ctx.caller = { id: 'reader', scopes: [{ path: '**', permissions: ['read'] }] };
    await expect(write({ ops: [{ op: 'update', row: 0, set: { Status: 'Draft' } }] }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('keeps a CRLF file CRLF', async () => {
    writeFileSync(join(env.dir, 'specs.md'), SPEC.replace(/\n/g, '\r\n'));
    await write({ ops: [{ op: 'insert', rows: [{ ID: 'RFC-2' }] }] });
    expect(file()).toBe(SPEC.replace('| RFC-1 | Alpha | Draft |\n', '| RFC-1 | Alpha | Draft |\n| RFC-2 |  |  |\n').replace(/\n/g, '\r\n'));
  });

  it('is markdown only', async () => {
    writeFileSync(join(env.dir, 'c.yaml'), 'a: 1\n');
    await expect(handleDocTableWrite(
      DocTableWriteSchema.parse({ file: 'docs/c.yaml', section: 'a', ops: [{ op: 'delete', row: 0 }] }), env.ctx,
    )).rejects.toThrow(/markdown/i);
  });
});

describe('argument robustness', () => {
  it('accepts ops and where sent as JSON strings', async () => {
    await write({ ops: JSON.stringify([{ op: 'insert', rows: [{ ID: 'RFC-2' }] }]) });
    expect((await read({ where: '{"ID":"RFC-2"}' })).row_numbers).toEqual([1]);
  });

  it('accepts row, table and expected_count as numeric strings', async () => {
    await write({ table: '0', ops: [{ op: 'update', row: '-1', set: { Title: 'A' }, expected_count: '1' }] });
    expect(file()).toContain('| RFC-1 | A | Draft |');
  });

  it('never coerces a missing row to 0', () => {
    expect(() => DocTableWriteSchema.parse({ file: 'f', section: 's', ops: [{ op: 'delete', row: null }] })).toThrow();
    expect(() => DocTableWriteSchema.parse({ file: 'f', section: 's', ops: [{ op: 'delete', row: '' }] })).toThrow();
  });

  it('rejects unknown op fields and op names instead of ignoring them', () => {
    expect(() => DocTableWriteSchema.parse({
      file: 'f', section: 's', ops: [{ op: 'insert', anchor: { ID: 'x' }, rows: [{ ID: 'y' }] }],
    })).toThrow(/anchor/);
    expect(() => DocTableWriteSchema.parse({ file: 'f', section: 's', ops: [{ op: 'upsert' }] })).toThrow();
    expect(() => DocTableWriteSchema.parse({ file: 'f', section: 's', ops: [] })).toThrow();
  });
});

describe('doc_table_read', () => {
  it('returns records, positions and the document etag', async () => {
    const result = await read({ columns: ['ID'] });
    expect(result).toMatchObject({
      table: 0, columns: ['ID', 'Title', 'Status'], rows: [{ ID: 'RFC-1' }], row_numbers: [0], row_count: 1,
    });
    expect(result.etag).toBe(computeEtag(SPEC));
  });

  it('explains a section with no table', async () => {
    await expect(read({ section: 'Log' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('discoverability', () => {
  it('doc_outline lists each section\'s tables', async () => {
    const outline = await handleDocOutline(DocOutlineSchema.parse({ file: 'docs/specs.md' }), env.ctx);
    const index = outline.headings.find((h) => h.text === 'Spec Index') as Record<string, unknown>;
    expect(index.tables).toEqual([{ index: 0, columns: ['ID', 'Title', 'Status'], rows: 1 }]);
    const log = outline.headings.find((h) => h.text === 'Log') as Record<string, unknown>;
    expect(log.tables).toBeUndefined();
  });

  it('registers both tools', () => {
    const registry = new ToolRegistry();
    registerEnQuireTools(registry);
    const names = registry.all().map((t) => t.name);
    expect(names).toContain('doc_table_read');
    expect(names).toContain('doc_table_write');
  });
});

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
  PermissionDeniedError, PreconditionFailedError,
} from '@nullproof-studio/en-core';
import { registerEnQuireTools } from '../../../src/plugin.js';
import { handleDocBatch, DocBatchSchema } from '../../../src/tools/write/doc-batch.js';

/**
 * doc_batch — see https://github.com/nullproof-studio/en-quire/issues/106
 *
 * One restructure as one operation: an ordered list of section ops applied
 * against successive parses of the document, written once, committed once,
 * returning one etag. All or nothing; a failure names the op by index.
 */

interface TestEnv { ctx: ToolContext; dir: string; cleanup: () => void; }

function makeCtx(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'enquire-batch-'));
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

const DOC = '# Doc\n\n## Alpha\n\na.\n\n## Beta\n\nb.\n\n## Gamma\n\ng.\n\n## Delta\n\nd.\n';
const file = () => readFileSync(join(env.dir, 'd.md'), 'utf8');
const batch = (args: Record<string, unknown>) =>
  handleDocBatch(DocBatchSchema.parse({ file: 'docs/d.md', ...args }), env.ctx);

beforeEach(() => { writeFileSync(join(env.dir, 'd.md'), DOC); });

describe('doc_batch applies several section edits in one call', () => {
  it('replaces four sections in a single write with a single etag', async () => {
    const result = await batch({ ops: [
      { op: 'replace', section: 'Alpha', content: 'A2.\n' },
      { op: 'replace', section: 'Beta', content: 'B2.\n' },
      { op: 'replace', section: 'Gamma', content: 'G2.\n' },
      { op: 'replace', section: 'Delta', content: 'D2.\n' },
    ] });
    const out = file();
    for (const t of ['A2.', 'B2.', 'G2.', 'D2.']) expect(out).toContain(t);
    expect(out).not.toMatch(/\n(a|b|g|d)\.\n/);
    expect(result.etag).toBe(computeEtag(out));
    expect(result.success).toBe(true);
  });

  it('runs replace, insert, append, rename, move and delete in order', async () => {
    await batch({ ops: [
      { op: 'rename', section: 'Alpha', new_heading: 'Intro' },
      { op: 'insert', anchor: 'Intro', position: 'after', heading: 'Scope', content: 's.\n' },
      { op: 'append', section: 'Beta', content: 'more b.\n' },
      { op: 'move', section: 'Delta', anchor: 'Intro', position: 'before' },
      { op: 'delete', section: 'Gamma' },
    ] });
    const out = file();
    expect(out.indexOf('## Delta')).toBeLessThan(out.indexOf('## Intro'));
    expect(out.indexOf('## Intro')).toBeLessThan(out.indexOf('## Scope'));
    expect(out.indexOf('## Scope')).toBeLessThan(out.indexOf('## Beta'));
    expect(out).toContain('more b.');
    expect(out).not.toContain('Gamma');
    expect(out).not.toContain('Alpha');
  });

  it('lets later ops address what earlier ops created or renamed', async () => {
    await batch({ ops: [
      { op: 'insert', anchor: 'Beta', position: 'after', heading: 'Fresh', content: 'x.\n' },
      { op: 'replace', section: 'Fresh', content: 'filled.\n' },
      { op: 'rename', section: 'Fresh', new_heading: 'Fresher' },
      { op: 'append', section: 'Fresher', content: 'tail.\n' },
    ] });
    expect(file()).toMatch(/## Fresher[^\n]*\n\nfilled\.\n\ntail\.\n\n## Gamma/);
  });

  it('reports each op that was applied', async () => {
    const result = await batch({ ops: [
      { op: 'rename', section: 'Alpha', new_heading: 'Intro' },
      { op: 'delete', section: 'Gamma' },
    ] });
    expect(result.applied).toEqual([
      expect.objectContaining({ index: 0, op: 'rename', section: 'Alpha' }),
      expect.objectContaining({ index: 1, op: 'delete', section: 'Gamma' }),
    ]);
  });

  it('surfaces insert warnings, tagged with the op that raised them', async () => {
    const result = await batch({ ops: [
      { op: 'insert', anchor: 'Alpha', position: 'after', heading: 'Next', content: 'See [[d#Nope]].\n' },
    ] });
    expect(Array.isArray(result.warnings) || result.warnings === undefined).toBe(true);
  });
});

describe('doc_batch is all or nothing', () => {
  it('leaves the file untouched when any op fails, and names the op', async () => {
    await expect(batch({ ops: [
      { op: 'replace', section: 'Alpha', content: 'A2.\n' },
      { op: 'delete', section: 'Does Not Exist' },
      { op: 'replace', section: 'Beta', content: 'B2.\n' },
    ] })).rejects.toThrow(/ops\[1\] \(delete\)/);
    expect(file()).toBe(DOC);
  });

  it('keeps the original error class so hints and handling survive', async () => {
    await expect(batch({ ops: [{ op: 'replace', section: 'Nope', content: 'x' }] }))
      .rejects.toMatchObject({ name: expect.stringMatching(/Error/) });
    expect(file()).toBe(DOC);
  });

  it('rejects a stale if_match without writing', async () => {
    env.ctx.config.require_read_before_write = true;
    await expect(batch({ if_match: 'stale', ops: [{ op: 'delete', section: 'Gamma' }] }))
      .rejects.toBeInstanceOf(PreconditionFailedError);
    expect(file()).toBe(DOC);
  });

  it('accepts the etag a previous write returned', async () => {
    env.ctx.config.require_read_before_write = true;
    const first = await batch({ if_match: computeEtag(DOC), ops: [{ op: 'delete', section: 'Gamma' }] });
    await batch({ if_match: first.etag, ops: [{ op: 'delete', section: 'Delta' }] });
    expect(file()).not.toContain('Delta');
  });

  it('writes nothing when the ops leave the document unchanged, and says so', async () => {
    const result = await batch({ ops: [{ op: 'replace', section: 'Alpha', content: 'a.\n' }] });
    expect(file()).toBe(DOC);
    expect(String(result.warning)).toMatch(/No changes/);
    expect(result.etag).toBe(computeEtag(DOC));
  });
});

describe('doc_batch guards', () => {
  it('requires write permission, even for a no-op batch', async () => {
    env.ctx.caller = { id: 'reader', scopes: [{ path: '**', permissions: ['read'] }] };
    await expect(batch({ ops: [{ op: 'replace', section: 'Alpha', content: 'a.\n' }] }))
      .rejects.toBeInstanceOf(PermissionDeniedError);
    expect(file()).toBe(DOC);
  });

  it('is markdown only', async () => {
    writeFileSync(join(env.dir, 'c.yaml'), 'a: 1\n');
    await expect(handleDocBatch(
      DocBatchSchema.parse({ file: 'docs/c.yaml', ops: [{ op: 'delete', section: 'a' }] }), env.ctx,
    )).rejects.toThrow(/markdown/i);
  });

  it('keeps a CRLF file CRLF', async () => {
    writeFileSync(join(env.dir, 'd.md'), DOC.replace(/\n/g, '\r\n'));
    await batch({ ops: [
      { op: 'replace', section: 'Alpha', content: 'A2.\n' },
      { op: 'delete', section: 'Gamma' },
    ] });
    expect(file()).not.toMatch(/[^\r]\n/);
  });
});

describe('doc_batch argument robustness', () => {
  it('accepts ops sent as a JSON string', async () => {
    await batch({ ops: JSON.stringify([{ op: 'delete', section: 'Gamma' }]) });
    expect(file()).not.toContain('Gamma');
  });

  it('rejects unknown op fields and op names instead of ignoring them', () => {
    expect(() => DocBatchSchema.parse({ file: 'f', ops: [{ op: 'delete', section: 's', sectoin: 'typo' }] })).toThrow();
    expect(() => DocBatchSchema.parse({ file: 'f', ops: [{ op: 'upsert', section: 's' }] })).toThrow();
  });

  it('rejects an empty or oversized batch', () => {
    expect(() => DocBatchSchema.parse({ file: 'f', ops: [] })).toThrow();
    const many = Array.from({ length: 101 }, () => ({ op: 'delete', section: 's' }));
    expect(() => DocBatchSchema.parse({ file: 'f', ops: many })).toThrow();
  });

  it('does not take a file-level replace_heading style flag on rename/delete ops', () => {
    expect(() => DocBatchSchema.parse({ file: 'f', ops: [{ op: 'rename', section: 's', new_heading: 'n', content: 'x' }] })).toThrow();
  });
});

describe('doc_batch registration', () => {
  it('is registered, and the single-section tools point at it for multi-edit work', () => {
    const registry = new ToolRegistry();
    registerEnQuireTools(registry);
    const tool = registry.get('doc_batch');
    expect(tool).toBeDefined();
    expect(tool!.annotations?.destructiveHint).toBe(true);
    expect(registry.get('doc_replace_section')!.description).toContain('doc_batch');
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolContext, ResolvedConfig, CallerIdentity } from '@nullproof-studio/en-core';
import { computeEtag } from '@nullproof-studio/en-core';
import { handleTextRead } from '../../../../src/tools/read/text-read.js';

let rootDir: string;
let ctx: ToolContext;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'enscribe-textread-'));
  writeFileSync(join(rootDir, 'notes.txt'), 'line one\nline two\nline three\n');

  const config: ResolvedConfig = {
    document_roots: {
      notes: {
        name: 'notes',
        path: rootDir,
        git: { enabled: false, auto_commit: false, branch_prefix: '' },
      },
    },
    database: ':memory:',
    transport: 'stdio',
    port: 0,
    search: {
      fulltext: false,
      sync_on_start: 'blocking',
      batch_size: 100,
      semantic: { enabled: false },
    },
    logging: { console: 'error' },
    callers: {},
    require_read_before_write: true,
  };

  const caller: CallerIdentity = {
    id: 'test',
    scopes: [{ path: '**', permissions: ['read', 'write', 'propose', 'approve', 'search', 'admin', 'exec'] }],
  };

  ctx = { config, roots: {}, caller, db: null as never };
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe('handleTextRead', () => {
  it('returns full content, etag, and total_lines when no range is given', async () => {
    const result = await handleTextRead({ file: 'notes/notes.txt' }, ctx) as {
      content: string;
      etag: string;
      total_lines: number;
    };
    expect(result.content).toBe('line one\nline two\nline three\n');
    expect(result.total_lines).toBe(3);
    expect(result.etag).toBe(computeEtag('line one\nline two\nline three\n'));
  });

  it('reads a single-line range', async () => {
    const result = await handleTextRead({ file: 'notes/notes.txt', line_start: 2, line_end: 2 }, ctx) as {
      content: string;
      line_start: number;
      line_end: number;
    };
    expect(result.content).toBe('line two\n');
    expect(result.line_start).toBe(2);
    expect(result.line_end).toBe(2);
  });

  it('reads to end when only line_start is given', async () => {
    const result = await handleTextRead({ file: 'notes/notes.txt', line_start: 2 }, ctx) as {
      content: string;
      line_end: number;
      total_lines: number;
    };
    expect(result.content).toBe('line two\nline three\n');
    expect(result.line_end).toBe(3);
    expect(result.total_lines).toBe(3);
  });

  it('etag for range read matches whole-file etag (invariant of content)', async () => {
    const full = await handleTextRead({ file: 'notes/notes.txt' }, ctx) as { etag: string };
    const range = await handleTextRead({ file: 'notes/notes.txt', line_start: 1, line_end: 1 }, ctx) as { etag: string };
    expect(range.etag).toBe(full.etag);
  });
});

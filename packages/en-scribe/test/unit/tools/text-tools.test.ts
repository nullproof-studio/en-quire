// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { ToolContext } from '@nullproof-studio/en-core';
import { computeEtag, ValidationError, PermissionDeniedError } from '@nullproof-studio/en-core';
import type { CallerIdentity } from '@nullproof-studio/en-core';
// Register plaintext parser for the root in these tests
import '../../../src/parsers/plaintext-parser.js';
import { handleTextRead } from '../../../src/tools/read/text-read.js';
import { handleTextFind } from '../../../src/tools/read/text-find.js';
import { handleTextList } from '../../../src/tools/read/text-list.js';
import { handleTextReplaceRange } from '../../../src/tools/write/text-replace-range.js';
import { handleTextCreate } from '../../../src/tools/write/text-create.js';
import { handleTextAppend } from '../../../src/tools/write/text-append.js';
import { handleTextEdit } from '../../../src/tools/write/text-edit.js';
import { handleTextInsertAtAnchor } from '../../../src/tools/write/text-insert-at-anchor.js';
import { handleTextRename } from '../../../src/tools/write/text-rename.js';
import { handleTextDelete } from '../../../src/tools/write/text-delete.js';
import { makeCtx } from '../../helpers/ctx.js';

const ROOT = 'notes';
const sample = 'alpha\nbeta\ngamma\ndelta\n';

let ctx: ToolContext;
let rootDir: string;
let db: Database.Database;

beforeEach(() => {
  ({ ctx, rootDir, db } = makeCtx({ rootName: ROOT }));
  writeFileSync(join(rootDir, 'a.txt'), sample);
});

afterEach(() => {
  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});

describe('text_find', () => {
  it('finds a match with context', async () => {
    const result = await handleTextFind({ file: `${ROOT}/a.txt`, query: 'gamma', context_lines: 1, case_sensitive: true, whole_word: false }, ctx) as {
      total_matches: number;
      matches: { line: number; context_before: string; context_after: string }[];
    };
    expect(result.total_matches).toBe(1);
    expect(result.matches[0].line).toBe(3);
    expect(result.matches[0].context_before).toBe('beta\n');
    expect(result.matches[0].context_after).toBe('delta\n');
  });

  it('returns empty matches for zero hits', async () => {
    const result = await handleTextFind({ file: `${ROOT}/a.txt`, query: 'nope', context_lines: 5, case_sensitive: true, whole_word: false }, ctx) as { total_matches: number };
    expect(result.total_matches).toBe(0);
  });
});

describe('text_replace_range', () => {
  it('replaces a single line', async () => {
    await handleTextReplaceRange({ file: `${ROOT}/a.txt`, line_start: 2, line_end: 2, content: 'BETA\n' }, ctx);
    expect(readFileSync(join(rootDir, 'a.txt'), 'utf-8')).toBe('alpha\nBETA\ngamma\ndelta\n');
  });

  it('inserts via zero-length range (endLine = startLine - 1)', async () => {
    await handleTextReplaceRange({ file: `${ROOT}/a.txt`, line_start: 2, line_end: 1, content: 'INS\n' }, ctx);
    expect(readFileSync(join(rootDir, 'a.txt'), 'utf-8')).toBe('alpha\nINS\nbeta\ngamma\ndelta\n');
  });

  it('rejects stale etag when require_read_before_write is enabled', async () => {
    const gated = makeCtx({ rootName: ROOT, requireReadBeforeWrite: true });
    writeFileSync(join(gated.rootDir, 'a.txt'), sample);
    try {
      await expect(
        handleTextReplaceRange({ file: `${ROOT}/a.txt`, line_start: 1, line_end: 1, content: 'x\n', if_match: 'stale' }, gated.ctx),
      ).rejects.toThrow();
    } finally {
      gated.db.close();
      rmSync(gated.rootDir, { recursive: true, force: true });
    }
  });
});

describe('text_create', () => {
  it('creates a new file', async () => {
    const result = await handleTextCreate({ file: `${ROOT}/new.txt`, content: 'hello\n' }, ctx) as { success: boolean };
    expect(result.success).toBe(true);
    expect(readFileSync(join(rootDir, 'new.txt'), 'utf-8')).toBe('hello\n');
  });

  it('fails if file already exists', async () => {
    await expect(
      handleTextCreate({ file: `${ROOT}/a.txt`, content: 'nope' }, ctx),
    ).rejects.toThrow(/already exists/);
  });
});

describe('text_append', () => {
  it('appends content to EOF', async () => {
    await handleTextAppend({ file: `${ROOT}/a.txt`, content: 'epsilon\n' }, ctx);
    expect(readFileSync(join(rootDir, 'a.txt'), 'utf-8')).toBe(sample + 'epsilon\n');
  });
});

describe('text_edit (sugar)', () => {
  it('replaces a unique literal occurrence', async () => {
    await handleTextEdit({ file: `${ROOT}/a.txt`, old_string: 'gamma', new_string: 'GAMMA' }, ctx);
    expect(readFileSync(join(rootDir, 'a.txt'), 'utf-8')).toBe('alpha\nbeta\nGAMMA\ndelta\n');
  });

  it('fails with helpful hint when old_string matches multiple times', async () => {
    writeFileSync(join(rootDir, 'dupes.txt'), 'foo\nbar foo\nbaz foo\n');
    try {
      await handleTextEdit({ file: `${ROOT}/dupes.txt`, old_string: 'foo', new_string: 'FOO' }, ctx);
      expect.fail('expected multi-match to throw');
    } catch (err) {
      const e = err as ValidationError;
      expect(e.message).toMatch(/requires a unique match/);
      expect(e.message).toMatch(/text_find \+ text_replace_range/);
      expect(e.message).toMatch(/found 3 matches/);
    }
  });

  it('fails when old_string is not found', async () => {
    await expect(
      handleTextEdit({ file: `${ROOT}/a.txt`, old_string: 'nope', new_string: 'x' }, ctx),
    ).rejects.toThrow(/not found/);
  });
});

describe('text_insert_at_anchor (sugar)', () => {
  it('inserts before a unique anchor', async () => {
    await handleTextInsertAtAnchor({ file: `${ROOT}/a.txt`, anchor: 'gamma', position: 'before', content: 'INS\n' }, ctx);
    expect(readFileSync(join(rootDir, 'a.txt'), 'utf-8')).toBe('alpha\nbeta\nINS\ngamma\ndelta\n');
  });

  it('inserts after a unique anchor', async () => {
    await handleTextInsertAtAnchor({ file: `${ROOT}/a.txt`, anchor: 'gamma', position: 'after', content: 'INS\n' }, ctx);
    expect(readFileSync(join(rootDir, 'a.txt'), 'utf-8')).toBe('alpha\nbeta\ngamma\nINS\ndelta\n');
  });

  it('fails on ambiguous anchor with match listing', async () => {
    writeFileSync(join(rootDir, 'dupes.txt'), 'foo one\nfoo two\nfoo three\n');
    await expect(
      handleTextInsertAtAnchor({ file: `${ROOT}/dupes.txt`, anchor: 'foo', position: 'after', content: 'x\n' }, ctx),
    ).rejects.toThrow(/requires a unique anchor/);
  });
});

describe('text_list', () => {
  it('lists text files in a root', async () => {
    writeFileSync(join(rootDir, 'b.log'), 'log content\n');
    mkdirSync(join(rootDir, 'sub'), { recursive: true });
    writeFileSync(join(rootDir, 'sub', 'c.text'), 'sub content\n');
    const result = await handleTextList({ scope: ROOT }, ctx) as { total: number; files: { path: string }[] };
    expect(result.total).toBe(3);
    const paths = result.files.map(f => f.path).sort();
    expect(paths).toEqual([`${ROOT}/a.txt`, `${ROOT}/b.log`, `${ROOT}/sub/c.text`]);
  });
});

describe('text_rename', () => {
  it('renames a file within a root', async () => {
    const result = await handleTextRename({ source: `${ROOT}/a.txt`, destination: `${ROOT}/renamed.txt` }, ctx) as { success: boolean };
    expect(result.success).toBe(true);
    expect(existsSync(join(rootDir, 'a.txt'))).toBe(false);
    expect(existsSync(join(rootDir, 'renamed.txt'))).toBe(true);
  });

  it('fails if destination already exists', async () => {
    writeFileSync(join(rootDir, 'b.txt'), 'other\n');
    await expect(
      handleTextRename({ source: `${ROOT}/a.txt`, destination: `${ROOT}/b.txt` }, ctx),
    ).rejects.toThrow(/already exists/);
  });

  it('fails if source does not exist', async () => {
    await expect(
      handleTextRename({ source: `${ROOT}/missing.txt`, destination: `${ROOT}/also-missing.txt` }, ctx),
    ).rejects.toThrow();
  });

  it('denies rename when caller lacks write permission on the destination, even with write on source', async () => {
    // Caller can write anywhere under notes/public/ but not notes/protected/
    const scopedCaller: CallerIdentity = {
      id: 'scoped',
      scopes: [
        { path: `${ROOT}/public/**`, permissions: ['read', 'write', 'search'] },
        { path: `${ROOT}/protected/**`, permissions: ['read', 'search'] },
      ],
    };
    ctx.caller = scopedCaller;

    // Seed a file the caller can write
    mkdirSync(join(rootDir, 'public'), { recursive: true });
    writeFileSync(join(rootDir, 'public', 'a.txt'), sample);

    // Intra-scope rename is fine
    await expect(
      handleTextRename({ source: `${ROOT}/public/a.txt`, destination: `${ROOT}/public/b.txt` }, ctx),
    ).resolves.toBeTruthy();

    // Cross-scope rename must be denied — this is the bug fix.
    // Seed a fresh source first.
    writeFileSync(join(rootDir, 'public', 'a.txt'), sample);
    await expect(
      handleTextRename({ source: `${ROOT}/public/a.txt`, destination: `${ROOT}/protected/a.txt` }, ctx),
    ).rejects.toThrow(PermissionDeniedError);

    // Source must not have been moved
    expect(existsSync(join(rootDir, 'public', 'a.txt'))).toBe(true);
    expect(existsSync(join(rootDir, 'protected', 'a.txt'))).toBe(false);
  });
});

describe('text_delete', () => {
  it('deletes a file', async () => {
    await handleTextDelete({ file: `${ROOT}/a.txt` }, ctx);
    expect(existsSync(join(rootDir, 'a.txt'))).toBe(false);
  });

  it('fails if file does not exist', async () => {
    await expect(
      handleTextDelete({ file: `${ROOT}/missing.txt` }, ctx),
    ).rejects.toThrow();
  });
});

describe('text_read returns etag usable by write tools', () => {
  it('etag round-trips through a write', async () => {
    const read = await handleTextRead({ file: `${ROOT}/a.txt` }, ctx) as { etag: string; content: string };
    expect(read.etag).toBe(computeEtag(sample));
    // Write with the fresh etag succeeds (even under require_read_before_write)
    await handleTextReplaceRange({ file: `${ROOT}/a.txt`, line_start: 1, line_end: 1, content: 'ALPHA\n', if_match: read.etag }, ctx);
    expect(readFileSync(join(rootDir, 'a.txt'), 'utf-8')).toBe('ALPHA\nbeta\ngamma\ndelta\n');
  });
});

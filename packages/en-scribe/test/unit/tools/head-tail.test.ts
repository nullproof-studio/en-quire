// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { ToolContext } from '@nullproof-studio/en-core';
// Register plaintext parser so .txt roots resolve
import '../../../src/parsers/plaintext-parser.js';
import { handleTextHead, handleTextTail } from '../../../src/tools/read/text-head-tail.js';
import { makeCtx } from '../../helpers/ctx.js';

const ROOT = 'notes';
const sample = 'one\ntwo\nthree\nfour\nfive\n';

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

describe('text_head', () => {
  it('returns the first N lines by default (10)', async () => {
    const result = await handleTextHead({ file: `${ROOT}/a.txt`, lines: 10 }, ctx) as {
      content: string; line_start: number; line_end: number; total_lines: number;
    };
    expect(result.content).toBe(sample);
    expect(result.line_start).toBe(1);
    expect(result.line_end).toBe(5);
    expect(result.total_lines).toBe(5);
  });

  it('respects a custom line count', async () => {
    const result = await handleTextHead({ file: `${ROOT}/a.txt`, lines: 2 }, ctx) as {
      content: string; line_end: number;
    };
    expect(result.content).toBe('one\ntwo\n');
    expect(result.line_end).toBe(2);
  });

  it('returns the whole file when lines exceeds total', async () => {
    const result = await handleTextHead({ file: `${ROOT}/a.txt`, lines: 999 }, ctx) as {
      content: string; line_end: number;
    };
    expect(result.content).toBe(sample);
    expect(result.line_end).toBe(5);
  });

  it('returns empty content + zero line range for an empty file', async () => {
    writeFileSync(join(rootDir, 'empty.txt'), '');
    const result = await handleTextHead({ file: `${ROOT}/empty.txt`, lines: 10 }, ctx) as {
      content: string; line_start: number; line_end: number; total_lines: number;
    };
    expect(result.content).toBe('');
    expect(result.line_start).toBe(0);
    expect(result.line_end).toBe(0);
    expect(result.total_lines).toBe(0);
  });
});

describe('text_tail', () => {
  it('returns the last N lines by default (10)', async () => {
    const result = await handleTextTail({ file: `${ROOT}/a.txt`, lines: 10 }, ctx) as {
      content: string; line_start: number; line_end: number; total_lines: number;
    };
    expect(result.content).toBe(sample);
    expect(result.line_start).toBe(1);
    expect(result.line_end).toBe(5);
    expect(result.total_lines).toBe(5);
  });

  it('respects a custom line count', async () => {
    const result = await handleTextTail({ file: `${ROOT}/a.txt`, lines: 2 }, ctx) as {
      content: string; line_start: number; line_end: number;
    };
    expect(result.content).toBe('four\nfive\n');
    expect(result.line_start).toBe(4);
    expect(result.line_end).toBe(5);
  });

  it('returns the whole file when lines exceeds total', async () => {
    const result = await handleTextTail({ file: `${ROOT}/a.txt`, lines: 999 }, ctx) as {
      content: string; line_start: number;
    };
    expect(result.content).toBe(sample);
    expect(result.line_start).toBe(1);
  });

  it('returns empty content + zero line range for an empty file', async () => {
    writeFileSync(join(rootDir, 'empty.txt'), '');
    const result = await handleTextTail({ file: `${ROOT}/empty.txt`, lines: 10 }, ctx) as {
      content: string; total_lines: number;
    };
    expect(result.content).toBe('');
    expect(result.total_lines).toBe(0);
  });

  it('handles a single-line file', async () => {
    writeFileSync(join(rootDir, 'one.txt'), 'only line\n');
    const result = await handleTextTail({ file: `${ROOT}/one.txt`, lines: 5 }, ctx) as {
      content: string; line_start: number; line_end: number; total_lines: number;
    };
    expect(result.content).toBe('only line\n');
    expect(result.line_start).toBe(1);
    expect(result.line_end).toBe(1);
    expect(result.total_lines).toBe(1);
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext } from '@nullproof-studio/en-core';
import type Database from 'better-sqlite3';
import '../../../src/parsers/plaintext-parser.js';
import { handleTextList } from '../../../src/tools/read/text-list.js';
import { makeCtx } from '../../helpers/ctx.js';

// text_list must filter each entry by read permission, not only check the
// `scope` argument. A caller limited to top-level files (`notes/*`) plus one
// named file can pass scope "notes/secret" (which itself matches `notes/*`) —
// the listing must still exclude notes/secret/hidden.txt.

let ctx: ToolContext;
let rootDir: string;
let db: Database.Database;

beforeEach(() => {
  ({ ctx, rootDir, db } = makeCtx({ rootName: 'notes' }));
  mkdirSync(join(rootDir, 'secret'), { recursive: true });
  writeFileSync(join(rootDir, 'top.txt'), 'public\n');
  writeFileSync(join(rootDir, 'secret', 'hidden.txt'), 'classified\n');
  writeFileSync(join(rootDir, 'secret', 'allowed.txt'), 'shared\n');
});

const RESTRICTED = {
  id: 'restricted',
  scopes: [
    { path: 'notes/*', permissions: ['read' as const] },
    { path: 'notes/secret/allowed.txt', permissions: ['read' as const] },
  ],
};

afterEach(() => {
  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});

async function listPaths(scope?: string): Promise<string[]> {
  const result = await handleTextList({ scope }, ctx) as { files: { path: string }[]; total: number };
  expect(result.total).toBe(result.files.length);
  return result.files.map((f) => f.path).sort();
}

describe('text_list filters each entry by read permission', () => {
  // text_list scopes are directory paths, not globs.
  it('lists only permitted files beneath a scope that passes the entry check', async () => {
    ctx.caller = RESTRICTED;
    expect(await listPaths('notes/secret')).toEqual(['notes/secret/allowed.txt']);
  });

  it('is unchanged for a full-access caller', async () => {
    expect(await listPaths()).toEqual([
      'notes/secret/allowed.txt', 'notes/secret/hidden.txt', 'notes/top.txt',
    ]);
  });
});

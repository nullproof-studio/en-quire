// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { ToolContext } from '@nullproof-studio/en-core';
// Register plaintext parser so status's supportedExtensions() returns .txt/.text/.log
import '../../../src/parsers/plaintext-parser.js';
import { handleTextStatus } from '../../../src/tools/status/text-status.js';
import { handleTextProposalsList } from '../../../src/tools/governance/text-proposals.js';
import { makeCtx } from '../../helpers/ctx.js';

const ROOT = 'notes';

let ctx: ToolContext;
let rootDir: string;
let db: Database.Database;

beforeEach(() => {
  ({ ctx, rootDir, db } = makeCtx({ rootName: ROOT }));
});

afterEach(() => {
  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});

describe('text_status', () => {
  it('reports unindexed text files', async () => {
    writeFileSync(join(rootDir, 'a.txt'), 'one\n');
    writeFileSync(join(rootDir, 'b.log'), 'log\n');
    // Not counted — extension not owned by any registered parser
    writeFileSync(join(rootDir, 'readme.md'), '# readme\n');

    const result = await handleTextStatus({}, ctx) as {
      unindexed: string[];
      indexed: number;
      roots: { name: string; git_active: boolean }[];
    };
    expect(result.unindexed.sort()).toEqual([`${ROOT}/a.txt`, `${ROOT}/b.log`]);
    expect(result.indexed).toBe(0);
    expect(result.roots[0].name).toBe(ROOT);
  });

  it('reports zero pending proposals when no git root is available', async () => {
    const result = await handleTextStatus({}, ctx) as { pending_proposals: number };
    expect(result.pending_proposals).toBe(0);
  });
});

describe('text_proposals_list', () => {
  it('returns empty list when no git-enabled roots', async () => {
    const result = await handleTextProposalsList({}, ctx) as { proposals: unknown[] };
    expect(result.proposals).toEqual([]);
  });
});

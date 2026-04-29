// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { initSearchSchema, syncIndex } from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';

let workRoot: string;
let docsRoot: string;
let db: Database.Database;

function setOldMtime(file: string): void {
  // Force the file's mtime into the past so the next sync's mtime check
  // reads it as "unchanged". statSync uses ms, so a 1s-in-the-past mtime
  // is enough to be < the previous indexed_at.
  const past = new Date(Date.now() - 60_000);
  utimesSync(file, past, past);
}

function listLinks(source: string): string[] {
  return (db.prepare(
    `SELECT target_file FROM doc_links WHERE source_file = ? ORDER BY id`,
  ).all(source) as Array<{ target_file: string }>).map((r) => r.target_file);
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'sync-links-'));
  docsRoot = join(workRoot, 'docs');
  mkdirSync(docsRoot, { recursive: true });
  mkdirSync(join(docsRoot, 'sops'), { recursive: true });
  mkdirSync(join(docsRoot, 'skills'), { recursive: true });
  db = new Database(':memory:');
  initSearchSchema(db);
});

afterEach(() => {
  db.close();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('syncIndex link resolution — within a single sync', () => {
  it('resolves cross-file links regardless of file iteration order', () => {
    // Source links to a target that, depending on filesystem listing
    // order, may be parsed AFTER the source. The deferred-storage phase
    // ensures index_metadata is fully populated before resolution runs.
    writeFileSync(
      join(docsRoot, 'skills', 'triage.md'),
      '# Triage\n\nSee [the runbook](../sops/runbook.md) for context.\n',
    );
    writeFileSync(
      join(docsRoot, 'sops', 'runbook.md'),
      '# Runbook\n\nProcedure body.\n',
    );
    syncIndex(db, 'docs', docsRoot);

    const links = listLinks('docs/skills/triage.md');
    expect(links).toEqual(['docs/sops/runbook.md']); // resolved, not `?docs/sops/runbook.md`
  });

  it('resolves Obsidian wiki links against the discovered file set', () => {
    writeFileSync(
      join(docsRoot, 'skills', 'triage.md'),
      '# Triage\n\nSee [[runbook]] for context.\n',
    );
    writeFileSync(
      join(docsRoot, 'sops', 'runbook.md'),
      '# Runbook\n\nProcedure body.\n',
    );
    syncIndex(db, 'docs', docsRoot);

    expect(listLinks('docs/skills/triage.md')).toEqual(['docs/sops/runbook.md']);
  });
});

describe('syncIndex link resolution — across syncs', () => {
  it('re-resolves stale `?`-tagged path links when the target appears in a later sync', () => {
    // Sync 1: source-only — link target doesn't exist yet
    writeFileSync(
      join(docsRoot, 'skills', 'triage.md'),
      '# Triage\n\nSee [the runbook](../sops/runbook.md) for context.\n',
    );
    syncIndex(db, 'docs', docsRoot);
    expect(listLinks('docs/skills/triage.md')).toEqual(['?docs/sops/runbook.md']);

    // Pin source mtime so the next sync mtime-skips it (real-world: the
    // source hasn't been edited; only the target was added).
    setOldMtime(join(docsRoot, 'skills', 'triage.md'));

    // Sync 2: target is added, source is unchanged. The mtime-skip means
    // we don't re-extract from triage.md — but resolveStaleLinks should
    // upgrade the `?` row when index_metadata sees the new target.
    writeFileSync(
      join(docsRoot, 'sops', 'runbook.md'),
      '# Runbook\n\nProcedure body.\n',
    );
    syncIndex(db, 'docs', docsRoot);

    expect(listLinks('docs/skills/triage.md')).toEqual(['docs/sops/runbook.md']);
  });

  it('re-resolves stale `?`-tagged wiki links when the target appears in a later sync', () => {
    writeFileSync(
      join(docsRoot, 'skills', 'triage.md'),
      '# Triage\n\nSee [[runbook]] for context.\n',
    );
    syncIndex(db, 'docs', docsRoot);
    expect(listLinks('docs/skills/triage.md')).toEqual(['?runbook']);
    setOldMtime(join(docsRoot, 'skills', 'triage.md'));

    writeFileSync(
      join(docsRoot, 'sops', 'runbook.md'),
      '# Runbook\n\nProcedure body.\n',
    );
    syncIndex(db, 'docs', docsRoot);

    expect(listLinks('docs/skills/triage.md')).toEqual(['docs/sops/runbook.md']);
  });

  it('downgrades incoming-reference rows when the target file is deleted', () => {
    // skills/triage.md links to sops/runbook.md. Both indexed.
    writeFileSync(
      join(docsRoot, 'skills', 'triage.md'),
      '# Triage\n\nSee [the runbook](../sops/runbook.md) for context.\n',
    );
    writeFileSync(
      join(docsRoot, 'sops', 'runbook.md'),
      '# Runbook\n\nProcedure body.\n',
    );
    syncIndex(db, 'docs', docsRoot);
    expect(listLinks('docs/skills/triage.md')).toEqual(['docs/sops/runbook.md']);

    // Pin source mtime so triage.md is mtime-skipped on the next sync —
    // the source is unchanged; only the TARGET disappears. The fix
    // must downgrade the incoming row even though the source isn't
    // re-extracted.
    setOldMtime(join(docsRoot, 'skills', 'triage.md'));

    rmSync(join(docsRoot, 'sops', 'runbook.md'));
    syncIndex(db, 'docs', docsRoot);

    // The link is now broken — must be re-tagged to `?` so consumers
    // know it points at a missing file rather than appearing valid.
    expect(listLinks('docs/skills/triage.md')).toEqual(['?docs/sops/runbook.md']);
  });

  it('re-resolves cross-root stale `?` rows when the target lives in a different root', () => {
    // Two roots: `docs` and `agents`. A skill in agents/ links to an SOP
    // in docs/. If agents syncs first, the link stores as
    // `?docs/sops/runbook.md`. When docs then syncs, the agents-side
    // row stays stale unless resolveStaleLinks scans globally rather
    // than per-root.
    const agentsRoot = join(workRoot, 'agents');
    mkdirSync(join(agentsRoot, 'skills'), { recursive: true });
    writeFileSync(
      join(agentsRoot, 'skills', 'michelle.md'),
      '# Michelle\n\nUse [the runbook](../../docs/sops/runbook.md) for triage.\n',
    );

    // Sync agents FIRST — target lives in a root that hasn't been
    // indexed yet, so the link must store as `?`.
    syncIndex(db, 'agents', agentsRoot);
    expect(listLinks('agents/skills/michelle.md')).toEqual(['?docs/sops/runbook.md']);

    // Now sync docs (the target's root). The agents source is in a
    // DIFFERENT root and is untouched — only a global resolveStaleLinks
    // pass fixes the `?` row.
    writeFileSync(
      join(docsRoot, 'sops', 'runbook.md'),
      '# Runbook\n\nProcedure body.\n',
    );
    syncIndex(db, 'docs', docsRoot);

    expect(listLinks('agents/skills/michelle.md')).toEqual(['docs/sops/runbook.md']);
  });
});

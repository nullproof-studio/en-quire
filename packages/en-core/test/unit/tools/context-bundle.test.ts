// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import {
  handleContextBundle,
  ContextBundleSchema,
  initSearchSchema,
  syncIndex,
  storeLinks,
} from '@nullproof-studio/en-core';
import type { ToolContext, ResolvedConfig, CallerIdentity } from '@nullproof-studio/en-core';
import type { z } from 'zod';
import '../../../../en-quire/src/parsers/markdown-parser.js';

let workRoot: string;
let docsRoot: string;
let db: Database.Database;

function buildContext(scopes: CallerIdentity['scopes']): ToolContext {
  const config: ResolvedConfig = {
    document_roots: {
      docs: { name: 'docs', path: docsRoot, git: {
        enabled: false, auto_commit: false, remote: null, pr_hook: null,
        pr_hook_secret: null, default_branch: null, push_proposals: false,
      }},
    },
    database: ':memory:',
    transport: 'stdio',
    port: 3100,
    listen_host: '127.0.0.1',
    search: {
      sync_on_start: 'blocking',
      batch_size: 500,
      semantic: { enabled: false },
    },
    logging: { level: 'error', dir: null },
    callers: {},
    require_read_before_write: true,
  };
  return {
    config,
    roots: { docs: { root: config.document_roots.docs, git: null } },
    caller: { id: 'tester', scopes },
    db,
  };
}

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'context-bundle-'));
  docsRoot = join(workRoot, 'docs');
  mkdirSync(docsRoot, { recursive: true });
  mkdirSync(join(docsRoot, 'sops'), { recursive: true });
  mkdirSync(join(docsRoot, 'skills'), { recursive: true });

  // Three files. "metrics" appears in two; one is linked to via a third.
  writeFileSync(join(docsRoot, 'sops', 'deployment.md'),
    '# Deployment\n\n## Metrics\n\nWe track p99 latency and error rate.\n');
  writeFileSync(join(docsRoot, 'sops', 'incidents.md'),
    '# Incidents\n\n## Metrics\n\nMetrics during incidents are noisy.\n');
  // Body deliberately avoids the search term "metrics" (including in link
  // text and URL fragment) so this file is reachable only via the link
  // graph, not as a direct search hit.
  writeFileSync(join(docsRoot, 'skills', 'observability.md'),
    '# Observability\n\nFollow [the deployment runbook](../sops/deployment.md) for the latest baselines.\n');

  db = new Database(':memory:');
  initSearchSchema(db);
  syncIndex(db, 'docs', docsRoot);

  // Manually seed a link from skills/observability.md → sops/deployment.md.
  // (syncIndex above already does this through the markdown extractor; this
  // belt-and-braces step keeps the test independent of extractor coverage.)
  storeLinks(db, 'docs/skills/observability.md', [{
    source_section: 'Observability',
    target_path: '../sops/deployment.md',
    target_section: 'Metrics',
    relationship: 'references',
    context: '[the deployment metrics](../sops/deployment.md#metrics)',
  }]);
});

afterEach(() => {
  db.close();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('handleContextBundle', () => {
  const readAll: CallerIdentity['scopes'] = [{ path: '**', permissions: ['read', 'search'] }];

  it('returns search hits with hop_distance: 0 when max_depth is 0', async () => {
    const ctx = buildContext(readAll);
    const args: z.infer<typeof ContextBundleSchema> = {
      query: 'metrics',
      max_depth: 0,
      max_sections: 10,
    };
    const result = await handleContextBundle(args, ctx) as {
      sections: Array<{ file: string; section_path: string; hop_distance: number; relevance_score: number }>;
    };
    expect(result.sections.length).toBeGreaterThan(0);
    for (const s of result.sections) {
      expect(s.hop_distance).toBe(0);
      expect(s.relevance_score).toBeGreaterThan(0);
    }
  });

  it('expands the bundle with link-graph neighbours when max_depth >= 1', async () => {
    const ctx = buildContext(readAll);
    const result0 = await handleContextBundle(
      { query: 'metrics', max_depth: 0, max_sections: 50 },
      ctx,
    ) as { sections: Array<{ file: string }> };
    const result1 = await handleContextBundle(
      { query: 'metrics', max_depth: 1, max_sections: 50 },
      ctx,
    ) as { sections: Array<{ file: string; hop_distance: number }> };

    // observability.md is NOT a search hit for "metrics" but IS linked to a hit
    expect(result0.sections.some((s) => s.file === 'docs/skills/observability.md')).toBe(false);
    expect(result1.sections.some((s) => s.file === 'docs/skills/observability.md' && s.hop_distance === 1)).toBe(true);
  });

  it('caps results at max_sections', async () => {
    const ctx = buildContext(readAll);
    const args: z.infer<typeof ContextBundleSchema> = {
      query: 'metrics',
      max_depth: 1,
      max_sections: 2,
    };
    const result = await handleContextBundle(args, ctx) as { sections: unknown[] };
    expect(result.sections).toHaveLength(2);
  });

  it('returns content for each section in the bundle', async () => {
    const ctx = buildContext(readAll);
    const args: z.infer<typeof ContextBundleSchema> = {
      query: 'metrics',
      max_depth: 0,
      max_sections: 5,
    };
    const result = await handleContextBundle(args, ctx) as {
      sections: Array<{ content: string }>;
    };
    for (const s of result.sections) {
      expect(s.content.length).toBeGreaterThan(0);
    }
  });

  it('filters out sections the caller cannot read', async () => {
    // Caller can only read sops/**, so observability.md (in skills/) is hidden
    const ctx = buildContext([
      { path: 'docs/sops/**', permissions: ['read', 'search'] },
    ]);
    const result = await handleContextBundle(
      { query: 'metrics', max_depth: 1, max_sections: 50 },
      ctx,
    ) as { sections: Array<{ file: string }> };
    for (const s of result.sections) {
      expect(s.file.startsWith('docs/sops/')).toBe(true);
    }
  });

  it('does not throw when no sections match the query', async () => {
    const ctx = buildContext(readAll);
    const result = await handleContextBundle(
      { query: 'kjhdfgkjsdhfg-impossible-token', max_depth: 1, max_sections: 5 },
      ctx,
    ) as { sections: unknown[] };
    expect(result.sections).toEqual([]);
  });

  it('resolves slug-form URL fragments to actual heading text', async () => {
    // Wipe the default link seed so deployment.md is reached ONLY via
    // the slug-form link from observability.md; the search query
    // ("observability") doesn't hit deployment directly.
    db.prepare('DELETE FROM doc_links').run();
    storeLinks(db, 'docs/skills/observability.md', [{
      source_section: 'Observability',
      target_path: '../sops/deployment.md',
      target_section: 'metrics', // ← slug form, NOT 'Metrics'
      relationship: 'references',
      context: '[link](../sops/deployment.md#metrics)',
    }]);

    const ctx = buildContext(readAll);
    const result = await handleContextBundle(
      { query: 'observability', max_depth: 1, max_sections: 5 },
      ctx,
    ) as { sections: Array<{ file: string; section_path: string; content: string }> };

    const linked = result.sections.find((s) => s.file === 'docs/sops/deployment.md');
    expect(linked).toBeDefined();
    // Returns the CANONICAL section path ("Deployment > Metrics"), not
    // the raw slug ("metrics"), so doc_read_section / doc_history can
    // round-trip the response without re-resolving.
    expect(linked!.section_path).toBe('Deployment > Metrics');
    expect(linked!.content).toContain('p99 latency');
  });

  it('traverses document-level links via the file\'s first section', async () => {
    // Replace the section-targeted link with a whole-document one
    // (target_section: null). Without representative-section expansion,
    // this edge would be skipped by the BFS and the linked file would
    // not appear in the bundle at depth>=1.
    db.prepare('DELETE FROM doc_links').run();
    storeLinks(db, 'docs/skills/observability.md', [{
      source_section: 'Observability',
      target_path: '../sops/deployment.md',
      target_section: null,
      relationship: 'references',
      context: '[runbook](../sops/deployment.md)',
    }]);

    const ctx = buildContext(readAll);
    const result = await handleContextBundle(
      { query: 'metrics', max_depth: 1, max_sections: 50 },
      ctx,
    ) as { sections: Array<{ file: string; hop_distance: number }> };

    // observability.md should appear via the document-level link.
    expect(result.sections.some((s) => s.file === 'docs/skills/observability.md' && s.hop_distance === 1)).toBe(true);
  });

  it('resolves URL-encoded fragments via the slug fallback', async () => {
    db.prepare('DELETE FROM doc_links').run();
    storeLinks(db, 'docs/skills/observability.md', [{
      source_section: 'Observability',
      target_path: '../sops/deployment.md',
      target_section: 'Tool%20Selection', // not in this fixture, but exercises the encoding path
      relationship: 'references',
      context: '[link](../sops/deployment.md#Tool%20Selection)',
    }, {
      source_section: 'Observability',
      target_path: '../sops/deployment.md',
      target_section: 'metrics', // slug that DOES exist as 'Metrics'
      relationship: 'references',
      context: null,
    }]);

    const ctx = buildContext(readAll);
    const result = await handleContextBundle(
      { query: 'observability', max_depth: 1, max_sections: 5 },
      ctx,
    ) as { sections: Array<{ section_path: string }> };

    // The URL-encoded fragment doesn't match any heading in the fixture
    // and is silently dropped; the slug-form `metrics` resolves to the
    // canonical "Deployment > Metrics".
    const paths = result.sections.map((s) => s.section_path);
    expect(paths).toContain('Deployment > Metrics');
  });

  it('resolves space-form section fragments (Obsidian-style wiki) via the slug fallback', async () => {
    // Set up a file with a heading "Tool Selection" so the space-form
    // fragment normalisation can be exercised.
    writeFileSync(join(docsRoot, 'sops', 'deployment.md'),
      '# Deployment\n\n## Tool Selection\n\nNotes on chosen tooling.\n');
    db.close();
    db = new Database(':memory:');
    initSearchSchema(db);
    syncIndex(db, 'docs', docsRoot);
    storeLinks(db, 'docs/skills/observability.md', [{
      source_section: 'Observability',
      target_path: '../sops/deployment.md',
      target_section: 'tool selection', // space-form, not slug-form
      relationship: 'references',
      context: null,
    }]);

    const ctx = buildContext(readAll);
    const result = await handleContextBundle(
      { query: 'observability', max_depth: 1, max_sections: 5 },
      ctx,
    ) as { sections: Array<{ file: string; section_path: string }> };

    const linked = result.sections.find((s) => s.file === 'docs/sops/deployment.md');
    expect(linked).toBeDefined();
    expect(linked!.section_path).toBe('Deployment > Tool Selection');
  });

  it('skips __preamble when picking a representative section for whole-doc links', async () => {
    // Replace deployment.md with one that has frontmatter, then a
    // heading. The synthetic __preamble is at line 1; a naive
    // first-by-line_start lookup would land on it. Whole-document
    // links should expand to the real heading instead.
    writeFileSync(join(docsRoot, 'sops', 'deployment.md'),
      '---\ntitle: Deployment SOP\n---\n\n# Deployment\n\nReal content.\n');
    db.close();
    db = new Database(':memory:');
    initSearchSchema(db);
    syncIndex(db, 'docs', docsRoot);

    db.prepare('DELETE FROM doc_links').run();
    storeLinks(db, 'docs/skills/observability.md', [{
      source_section: 'Observability',
      target_path: '../sops/deployment.md',
      target_section: null, // whole-document link
      relationship: 'references',
      context: null,
    }]);

    const ctx = buildContext(readAll);
    const result = await handleContextBundle(
      { query: 'observability', max_depth: 1, max_sections: 5 },
      ctx,
    ) as { sections: Array<{ file: string; section_path: string }> };

    const linked = result.sections.find((s) => s.file === 'docs/sops/deployment.md');
    expect(linked).toBeDefined();
    expect(linked!.section_path).toBe('Deployment');
    expect(linked!.section_path).not.toContain('__preamble');
  });

  it('does not let unreadable high-ranked candidates consume the cap', async () => {
    // Caller has search on **, but read only on docs/sops/**.
    // observability.md is in skills/ and is one of the candidates
    // (graph neighbour of deployment.md). The old behaviour was
    // cap-first-then-filter, which could leave observability
    // occupying the cap and produce fewer than `max_sections`
    // readable results. New behaviour walks the ranked list until N
    // readable sections are collected.
    const ctx = buildContext([
      { path: '**', permissions: ['search'] },
      { path: 'docs/sops/**', permissions: ['read'] },
    ]);
    const result = await handleContextBundle(
      { query: 'metrics', max_depth: 1, max_sections: 2 },
      ctx,
    ) as { sections: Array<{ file: string }> };

    expect(result.sections.length).toBe(2);
    for (const s of result.sections) {
      expect(s.file.startsWith('docs/sops/')).toBe(true);
    }
  });
});

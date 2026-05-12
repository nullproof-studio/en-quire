// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initSearchSchema,
  searchDocuments,
  loadVectorExtension,
  initVectorSchema,
  upsertEmbedding,
  indexDocument,
} from '@nullproof-studio/en-core';
import type { SectionNode } from '@nullproof-studio/en-core';

const DIM = 4;
let db: Database.Database;
let vectorOk = false;

function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

function buildLeafSection(heading: string, body: string): { tree: SectionNode[]; markdown: string } {
  // Tiny manual section tree: one heading, body follows. Real offsets so
  // indexDocument's `markdown.slice(bodyStart, bodyEnd)` produces real text
  // for FTS.
  const headingLine = `# ${heading}\n`;
  const markdown = `${headingLine}\n${body}\n`;
  const headingStart = 0;
  const bodyStart = headingLine.length;
  const bodyEnd = markdown.length;
  const node: SectionNode = {
    heading: {
      text: heading,
      level: 1,
      position: { start: { line: 1, column: 1, offset: headingStart }, end: { line: 1, column: headingLine.length, offset: bodyStart - 1 } },
    },
    headingStartOffset: headingStart,
    bodyStartOffset: bodyStart,
    bodyEndOffset: bodyEnd,
    sectionEndOffset: bodyEnd,
    children: [],
    parent: null,
    index: 0,
    depth: 0,
  };
  return { tree: [node], markdown };
}

beforeAll(async () => {
  const probe = new Database(':memory:');
  vectorOk = (await loadVectorExtension(probe)).loaded;
  probe.close();
});

beforeEach(async () => {
  db = new Database(':memory:');
  initSearchSchema(db);

  // Seed FTS via indexDocument so the row shape matches production usage
  const a = buildLeafSection('Deployment', 'We track p99 latency and error rate.');
  indexDocument(db, 'docs/sops/deployment.md', a.tree, a.markdown);
  const b = buildLeafSection('Observability', 'Follow the deployment runbook for baselines.');
  indexDocument(db, 'docs/skills/observability.md', b.tree, b.markdown);

  if (vectorOk) {
    await loadVectorExtension(db);
    initVectorSchema(db, DIM);
    // Two embeddings: deployment.md is closest to [1,0,0,0]; observability is at [0,1,0,0]
    upsertEmbedding(db, {
      file_path: 'docs/sops/deployment.md',
      section_path: 'Deployment',
      section_heading: 'Deployment',
      section_level: 1, line_start: 1, line_end: 3,
    }, vec([1, 0, 0, 0]));
    upsertEmbedding(db, {
      file_path: 'docs/skills/observability.md',
      section_path: 'Observability',
      section_heading: 'Observability',
      section_level: 1, line_start: 1, line_end: 3,
    }, vec([0, 1, 0, 0]));
  }
});

afterEach(() => db.close());

describe('searchDocuments — fulltext mode (default)', () => {
  it('returns FTS5 hits with structural ranking', () => {
    const results = searchDocuments(db, 'latency');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('docs/sops/deployment.md');
  });

  it('treats search_type: fulltext as the default behaviour', () => {
    const a = searchDocuments(db, 'latency');
    const b = searchDocuments(db, 'latency', { search_type: 'fulltext' });
    expect(a).toEqual(b);
  });
});

describe('searchDocuments — semantic mode', () => {
  it('returns the closest vector to the query embedding', () => {
    if (!vectorOk) return;
    const results = searchDocuments(db, 'unused fts query', {
      search_type: 'semantic',
      query_embedding: vec([0.95, 0.05, 0, 0]),
      max_results: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('docs/sops/deployment.md');
  });

  it('returns empty when query_embedding is missing', () => {
    const results = searchDocuments(db, 'latency', { search_type: 'semantic' });
    expect(results).toEqual([]);
  });

  it('returns empty silently when sqlite-vec is unavailable (degraded mode)', () => {
    if (vectorOk) return; // Only meaningful when vec is missing
    const results = searchDocuments(db, 'q', {
      search_type: 'semantic',
      query_embedding: vec([1, 0, 0, 0]),
    });
    expect(results).toEqual([]);
  });
});

describe('searchDocuments — hybrid mode', () => {
  it('blends FTS and semantic results', () => {
    if (!vectorOk) return;

    const ftsOnly = searchDocuments(db, 'latency', { search_type: 'fulltext', max_results: 5 });
    const hybrid = searchDocuments(db, 'latency', {
      search_type: 'hybrid',
      query_embedding: vec([0, 1, 0, 0]), // closer to observability.md
      max_results: 5,
    });

    // FTS-only finds only deployment.md ("latency" is in its body); hybrid
    // pulls in observability.md via the semantic side.
    expect(ftsOnly.map((r) => r.file)).toEqual(['docs/sops/deployment.md']);
    const hybridFiles = hybrid.map((r) => r.file);
    expect(hybridFiles).toContain('docs/sops/deployment.md');
    expect(hybridFiles).toContain('docs/skills/observability.md');
  });

  it('falls back to FTS-only behaviour when semantic side returns nothing', () => {
    const hybrid = searchDocuments(db, 'latency', {
      search_type: 'hybrid',
      // No query_embedding → semanticSearch returns empty → blend collapses to FTS
      max_results: 5,
    });
    expect(hybrid.map((r) => r.file)).toEqual(['docs/sops/deployment.md']);
  });
});

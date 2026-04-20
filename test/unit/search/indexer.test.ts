// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initSearchSchema } from '@nullproof-studio/en-core';
import { indexDocument, getIndexedCount, removeFromIndex } from '@nullproof-studio/en-core';
import { searchDocuments, sanitiseFts5Query } from '@nullproof-studio/en-core';
import { parseMarkdown } from '../../../src/document/parser.js';
import { buildSectionTree } from '../../../src/document/markdown-parser.js';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/docs');

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initSearchSchema(db);
});

afterEach(() => {
  db.close();
});

function indexFixture(name: string) {
  const md = readFileSync(resolve(fixturesDir, name), 'utf-8');
  const ast = parseMarkdown(md);
  const tree = buildSectionTree(ast, md);
  indexDocument(db, name, tree, md);
  return md;
}

describe('indexDocument', () => {
  it('indexes all sections of a document', () => {
    indexFixture('simple.md');
    const count = db.prepare('SELECT COUNT(*) as c FROM sections_fts').get() as { c: number };
    expect(count.c).toBeGreaterThan(0);
  });

  it('re-indexes cleanly (no duplicates)', () => {
    indexFixture('simple.md');
    indexFixture('simple.md');
    const count = db.prepare('SELECT COUNT(*) as c FROM sections_fts WHERE file_path = ?').get('simple.md') as { c: number };
    // Should be same as single index, not doubled
    const ast = parseMarkdown(readFileSync(resolve(fixturesDir, 'simple.md'), 'utf-8'));
    const md = readFileSync(resolve(fixturesDir, 'simple.md'), 'utf-8');
    const tree = buildSectionTree(ast, md);
    const expectedSections = 6; // simple.md has 6 headings
    expect(count.c).toBe(expectedSections);
  });

  it('tracks indexed file count', () => {
    expect(getIndexedCount(db)).toBe(0);
    indexFixture('simple.md');
    expect(getIndexedCount(db)).toBe(1);
    indexFixture('nested-headings.md');
    expect(getIndexedCount(db)).toBe(2);
  });
});

describe('removeFromIndex', () => {
  it('removes a file from the index', () => {
    indexFixture('simple.md');
    expect(getIndexedCount(db)).toBe(1);
    removeFromIndex(db, 'simple.md');
    expect(getIndexedCount(db)).toBe(0);
  });
});

describe('searchDocuments', () => {
  it('finds matching sections', () => {
    indexFixture('simple.md');
    const results = searchDocuments(db, 'content');
    expect(results.length).toBeGreaterThan(0);
  });

  it('ranks heading matches higher', () => {
    indexFixture('nested-headings.md');
    const results = searchDocuments(db, 'Environment Check');
    expect(results.length).toBeGreaterThan(0);
    // The section with "Environment Check" as its heading should rank highest
    expect(results[0].section_heading).toBe('1.1 Environment Check');
  });

  it('respects max_results', () => {
    indexFixture('simple.md');
    indexFixture('nested-headings.md');
    const results = searchDocuments(db, 'content', { max_results: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('filters by scope', () => {
    indexFixture('simple.md');
    indexFixture('nested-headings.md');
    const results = searchDocuments(db, 'content', { scope: 'simple*' });
    expect(results.every((r) => r.file.startsWith('simple'))).toBe(true);
  });

  it('returns breadcrumb array', () => {
    indexFixture('simple.md');
    const results = searchDocuments(db, 'Subsection');
    const sub = results.find((r) => r.section_heading === 'Subsection 2.1');
    expect(sub).toBeDefined();
    expect(sub!.breadcrumb).toContain('Simple Document');
    expect(sub!.breadcrumb).toContain('Section Two');
  });

  it('handles hyphenated search terms (FTS5 operator escaping)', () => {
    indexFixture('component-doc.mdx');
    // "en-quire" should not be parsed as "en NOT quire"
    const results = searchDocuments(db, 'en-quire');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('component-doc.mdx');
  });

  it('indexes and searches .mdx files', () => {
    indexFixture('component-doc.mdx');
    const results = searchDocuments(db, 'button');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('component-doc.mdx');
  });
});

describe('sanitiseFts5Query', () => {
  it('quotes simple terms', () => {
    expect(sanitiseFts5Query('hello world')).toBe('"hello" "world"');
  });

  it('handles hyphenated terms', () => {
    expect(sanitiseFts5Query('en-quire')).toBe('"en-quire"');
  });

  it('escapes internal double quotes', () => {
    expect(sanitiseFts5Query('say "hello"')).toBe('"say" """hello"""');
  });

  it('handles empty query', () => {
    expect(sanitiseFts5Query('')).toBe('""');
    expect(sanitiseFts5Query('   ')).toBe('""');
  });

  it('handles single term', () => {
    expect(sanitiseFts5Query('deployment')).toBe('"deployment"');
  });
});

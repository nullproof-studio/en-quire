// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { parseMarkdown } from '../../../src/document/parser.js';
import { buildSectionTree, getSectionPath, flattenTree } from '../../../src/document/section-tree.js';
import { resolveAddress } from '../../../src/document/section-address.js';
import { readSection, buildOutline, findReplace } from '../../../src/document/section-ops.js';
import { initSearchSchema } from '../../../src/search/schema.js';
import { indexDocument } from '../../../src/search/indexer.js';
import { searchDocuments } from '../../../src/search/query.js';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/docs');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

function parse(md: string) {
  const ast = parseMarkdown(md);
  return buildSectionTree(ast, md);
}

describe('French document', () => {
  const md = loadFixture('french.md');
  const tree = parse(md);

  it('parses accented headings correctly', () => {
    const flat = flattenTree(tree);
    const headings = flat.map((n) => n.heading.text);
    expect(headings).toContain('Procédures de Déploiement');
    expect(headings).toContain("1.1 Vérification de l'Environnement");
    expect(headings).toContain('2. Étapes de Déploiement');
  });

  it('resolves text address with accents', () => {
    const matches = resolveAddress(tree, { type: 'text', text: '1. Pré-déploiement' });
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('1. Pré-déploiement');
  });

  it('resolves path address with accents', () => {
    const matches = resolveAddress(tree, {
      type: 'path',
      segments: ['Procédures de Déploiement', '1. Pré-déploiement', '1.1 Vérification de l\'Environnement'],
    });
    expect(matches.length).toBe(1);
  });

  it('reads section content preserving accented characters', () => {
    const result = readSection(md, tree, { type: 'text', text: '1. Pré-déploiement' }, false);
    expect(result.content).toContain('Étapes à suivre');
  });

  it('builds outline with accented headings', () => {
    const outline = buildOutline(md, tree);
    expect(outline[0].text).toBe('Procédures de Déploiement');
    expect(outline.some((e) => e.text === '3.2 Plan de Retour Arrière')).toBe(true);
  });

  it('find-replace works with accented text', () => {
    const { matches } = findReplace(md, tree, 'déploiement', 'mise en service', { preview: true });
    expect(matches.length).toBeGreaterThan(0);
  });
});

describe('Spanish document', () => {
  const md = loadFixture('spanish.md');
  const tree = parse(md);

  it('parses Spanish headings with tildes and accents', () => {
    const flat = flattenTree(tree);
    const headings = flat.map((n) => n.heading.text);
    expect(headings).toContain('Guía de Operaciones');
    expect(headings).toContain('1.1 Clasificación');
    expect(headings).toContain('1.2 Escalación');
    expect(headings).toContain('2.2 Monitorización');
  });

  it('resolves text address with ñ and accents', () => {
    const matches = resolveAddress(tree, { type: 'text', text: '1.1 Clasificación' });
    expect(matches.length).toBe(1);
  });

  it('reads section with Spanish content', () => {
    const result = readSection(md, tree, { type: 'text', text: '1.1 Clasificación' });
    expect(result.content).toContain('Crítico');
    expect(result.content).toContain('Funcionalidad principal degradada');
  });

  it('section path works with Spanish headings', () => {
    const flat = flattenTree(tree);
    const clasificacion = flat.find((n) => n.heading.text === '1.1 Clasificación');
    expect(getSectionPath(clasificacion!)).toBe('Guía de Operaciones > 1. Gestión de Incidentes > 1.1 Clasificación');
  });

  it('pattern match works with Spanish characters', () => {
    const matches = resolveAddress(tree, { type: 'pattern', pattern: '*Equipo*' });
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('3.1 Equipo de Guardia');
  });
});

describe('Chinese document', () => {
  const md = loadFixture('chinese.md');
  const tree = parse(md);

  it('parses Chinese headings', () => {
    const flat = flattenTree(tree);
    const headings = flat.map((n) => n.heading.text);
    expect(headings).toContain('部署运维手册');
    expect(headings).toContain('1.1 环境检查');
    expect(headings).toContain('2.2 发布流程');
    expect(headings).toContain('3.1 回滚方案');
  });

  it('resolves text address with Chinese characters', () => {
    const matches = resolveAddress(tree, { type: 'text', text: '1.1 环境检查' });
    expect(matches.length).toBe(1);
  });

  it('resolves path with Chinese segments', () => {
    const matches = resolveAddress(tree, {
      type: 'path',
      segments: ['部署运维手册', '2. 部署步骤', '2.2 发布流程'],
    });
    expect(matches.length).toBe(1);
  });

  it('reads section content preserving Chinese characters', () => {
    const result = readSection(md, tree, { type: 'text', text: '1.1 环境检查' });
    expect(result.content).toContain('数据库连接字符串');
    expect(result.content).toContain('API密钥和认证令牌');
  });

  it('builds outline with Chinese headings', () => {
    const outline = buildOutline(md, tree);
    expect(outline[0].text).toBe('部署运维手册');
    // char_count should count code points, not bytes
    expect(outline[0].char_count).toBeGreaterThan(0);
  });

  it('find-replace works with Chinese text', () => {
    const { matches } = findReplace(md, tree, '部署', '发布', { preview: true });
    expect(matches.length).toBeGreaterThan(0);
  });

  it('section path uses Chinese breadcrumbs', () => {
    const flat = flattenTree(tree);
    const node = flat.find((n) => n.heading.text === '2.2 发布流程');
    expect(getSectionPath(node!)).toBe('部署运维手册 > 2. 部署步骤 > 2.2 发布流程');
  });
});

describe('i18n search indexing', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initSearchSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('indexes and searches French content', () => {
    const md = loadFixture('french.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);
    indexDocument(db, 'french.md', tree, md);

    const results = searchDocuments(db, 'déploiement');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('french.md');
  });

  it('indexes and searches Spanish content', () => {
    const md = loadFixture('spanish.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);
    indexDocument(db, 'spanish.md', tree, md);

    const results = searchDocuments(db, 'incidentes');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file).toBe('spanish.md');
  });

  it('indexes Chinese content (FTS5 unicode61 has limited CJK tokenization)', () => {
    const md = loadFixture('chinese.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);
    indexDocument(db, 'chinese.md', tree, md);

    // FTS5 unicode61 tokenizer doesn't segment CJK text (no word boundaries).
    // Verify the content is indexed even if MATCH queries on Chinese substrings
    // don't work well. Semantic search (v0.3) will handle CJK better.
    const count = db.prepare(
      "SELECT COUNT(*) as c FROM sections_fts WHERE file_path = 'chinese.md'"
    ).get() as { c: number };
    expect(count.c).toBeGreaterThan(0);

    // Search for "npm" which appears space-delimited in a code block
    const results = searchDocuments(db, 'npm');
    const chinese = results.filter((r) => r.file === 'chinese.md');
    expect(chinese.length).toBeGreaterThan(0);
  });
});

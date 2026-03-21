// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import '../../../src/document/markdown-parser.js';
import '../../../src/document/yaml-parser.js';
import { parserRegistry } from '../../../src/document/parser-registry.js';

describe('ParserRegistry', () => {
  it('returns markdown parser for .md files', () => {
    const parser = parserRegistry.getParser('article.md');
    expect(parser.extensions).toContain('.md');
  });

  it('returns markdown parser for .mdx files', () => {
    const parser = parserRegistry.getParser('component.mdx');
    expect(parser.extensions).toContain('.mdx');
  });

  it('returns YAML parser for .yaml files', () => {
    const parser = parserRegistry.getParser('config.yaml');
    expect(parser.extensions).toContain('.yaml');
  });

  it('returns YAML parser for .yml files', () => {
    const parser = parserRegistry.getParser('docker-compose.yml');
    expect(parser.extensions).toContain('.yml');
  });

  it('throws on unsupported extension', () => {
    expect(() => parserRegistry.getParser('data.json')).toThrow('Unsupported file format');
  });

  it('returns all supported extensions', () => {
    const exts = parserRegistry.supportedExtensions();
    expect(exts).toContain('.md');
    expect(exts).toContain('.mdx');
    expect(exts).toContain('.yaml');
    expect(exts).toContain('.yml');
  });

  it('is case-insensitive for extensions', () => {
    expect(() => parserRegistry.getParser('CONFIG.YAML')).not.toThrow();
  });
});

describe('DocumentParser — validate', () => {
  it('returns no warnings for valid YAML', () => {
    const parser = parserRegistry.getParser('test.yaml');
    const warnings = parser.validate('name: test\nversion: 1.0\n');
    expect(warnings).toEqual([]);
  });

  it('returns warnings for invalid YAML syntax', () => {
    const parser = parserRegistry.getParser('test.yaml');
    const warnings = parser.validate('name: test\n  bad indent: oops\n');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('YAML');
  });

  it('returns warnings for YAML with unclosed quotes', () => {
    const parser = parserRegistry.getParser('test.yaml');
    const warnings = parser.validate('name: "unclosed\n');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('returns no warnings for valid markdown', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('# Title\n\nBody text.\n');
    expect(warnings).toEqual([]);
  });

  it('returns no warnings for empty content', () => {
    const yamlParser = parserRegistry.getParser('test.yaml');
    expect(yamlParser.validate('')).toEqual([]);
    const mdParser = parserRegistry.getParser('test.md');
    expect(mdParser.validate('')).toEqual([]);
  });

  it('returns warning for duplicate sibling headings in markdown', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('# Title\n\n## Section A\n\nContent.\n\n## Section A\n\nMore content.\n');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('Section A');
    expect(warnings[0]).toContain('Duplicate');
  });

  it('allows same heading text under different parents', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('# Doc\n\n## Part 1\n\n### Overview\n\n## Part 2\n\n### Overview\n');
    expect(warnings).toEqual([]);
  });

  it('returns no warnings for unique sibling headings', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('# Title\n\n## A\n\n## B\n\n## C\n');
    expect(warnings).toEqual([]);
  });

  it('detects duplicates at nested levels', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('# Doc\n\n## Parent\n\n### Child\n\nText.\n\n### Child\n\nText.\n');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('Child');
  });
});

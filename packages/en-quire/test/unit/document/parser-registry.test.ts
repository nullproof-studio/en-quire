// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import '../../../src/parsers/markdown-parser.js';
import '../../../src/parsers/yaml-parser.js';
import { parserRegistry } from '@nullproof-studio/en-core';

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

  it('lists extensions supporting a capability (generateToc)', () => {
    const exts = parserRegistry.extensionsSupporting('generateToc');
    // Markdown declares generateToc: true; YAML does not.
    expect(exts).toContain('.md');
    expect(exts).toContain('.mdx');
    expect(exts).not.toContain('.yaml');
    expect(exts).not.toContain('.yml');
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

describe('DocumentParser — setext heading detection (#32)', () => {
  it('warns when --- after text creates a setext heading', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('# Doc\n\n## Section\n\n*Pending*\n---\n');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('---');
    expect(warnings[0]).toContain('Pending');
    expect(warnings[0]).toContain('horizontal rule');
  });

  it('warns when === after text creates a setext h1 heading', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('Title Text\n===\n\n## Section\n\nContent.\n');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('===');
    expect(warnings[0]).toContain('Title Text');
  });

  it('does not warn for --- with a blank line before it (true horizontal rule)', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('# Doc\n\n## Section\n\nSome text.\n\n---\n\n## Next\n\nMore.\n');
    expect(warnings).toEqual([]);
  });

  it('does not warn for ATX headings', () => {
    const parser = parserRegistry.getParser('test.md');
    const warnings = parser.validate('# Title\n\n## Section A\n\n### Subsection\n\nContent.\n');
    expect(warnings).toEqual([]);
  });

  it('produces both setext warning and duplicate sibling error together', () => {
    const parser = parserRegistry.getParser('test.md');
    // Two identical setext headings from --- separators
    const md = '# Doc\n\n## Hypothesis 1\n\n*Pending*\n---\n\n## Hypothesis 2\n\n*Pending*\n---\n';
    const warnings = parser.validate(md);
    const setextWarnings = warnings.filter(w => w.includes('---'));
    const duplicateWarnings = warnings.filter(w => w.includes('Duplicate'));
    expect(setextWarnings.length).toBe(2);
    expect(duplicateWarnings.length).toBe(1);
    expect(duplicateWarnings[0]).toContain('Pending');
  });

  it('handles the real-world agent pattern with multiple --- separators', () => {
    const parser = parserRegistry.getParser('test.md');
    const md =
      '# Hypothesis Testing\n\n' +
      '## Executive Summary\n\n' +
      '*To be populated*\n---\n\n' +
      '## Hypothesis 1\n\n' +
      '### Findings\n\n' +
      '*Pending test execution*\n---\n\n' +
      '## Hypothesis 2\n\n' +
      '### Findings\n\n' +
      '*Pending test execution*\n---\n';
    const warnings = parser.validate(md);
    const setextWarnings = warnings.filter(w => w.includes('---'));
    // Each *text*\n--- creates a setext heading
    expect(setextWarnings.length).toBe(3);
    // Each warning should name the text that became a heading
    expect(setextWarnings[0]).toContain('To be populated');
    expect(setextWarnings[1]).toContain('Pending test execution');
    expect(setextWarnings[2]).toContain('Pending test execution');
  });
});

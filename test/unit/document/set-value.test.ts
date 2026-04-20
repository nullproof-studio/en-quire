// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import '../../../src/document/markdown-parser.js';
import '../../../src/document/yaml-parser.js';
import { parserRegistry } from '@nullproof-studio/en-core';
import { setValue } from '@nullproof-studio/en-core';

const yamlParser = parserRegistry.getParser('test.yaml');
const mdParser = parserRegistry.getParser('test.md');

describe('setValue — YAML scalars', () => {
  it('sets a top-level scalar value', () => {
    const yaml = 'name: old\nversion: 1.0\n';
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('name');
    const result = setValue(yaml, tree, address, 'new-name', yamlParser.ops);
    expect(result).toBe('name: new-name\nversion: 1.0\n');
  });

  it('sets a nested scalar value', () => {
    const yaml = 'services:\n  api:\n    image: node:22-slim\n    port: 3100\n';
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('services.api.port');
    const result = setValue(yaml, tree, address, '8080', yamlParser.ops);
    expect(result).toContain('port: 8080');
    expect(result).not.toContain('3100');
    expect(result).toContain('image: node:22-slim');
  });

  it('sets a quoted string value', () => {
    const yaml = "version: '3.8'\nname: test\n";
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('version');
    const result = setValue(yaml, tree, address, "'4.0'", yamlParser.ops);
    expect(result).toBe("version: '4.0'\nname: test\n");
  });

  it('sets a boolean value', () => {
    const yaml = 'debug: false\nport: 3000\n';
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('debug');
    const result = setValue(yaml, tree, address, 'true', yamlParser.ops);
    expect(result).toBe('debug: true\nport: 3000\n');
  });

  it('sets a deeply nested value', () => {
    const yaml = 'a:\n  b:\n    c:\n      d: old\n';
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('a.b.c.d');
    const result = setValue(yaml, tree, address, 'new', yamlParser.ops);
    expect(result).toBe('a:\n  b:\n    c:\n      d: new\n');
  });

  it('preserves comments on other lines', () => {
    const yaml = '# Config\nname: old  # app name\nport: 3000\n';
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('port');
    const result = setValue(yaml, tree, address, '4000', yamlParser.ops);
    expect(result).toContain('# Config');
    expect(result).toContain('name: old  # app name');
    expect(result).toBe('# Config\nname: old  # app name\nport: 4000\n');
  });

  it('preserves double-quote style from original value', () => {
    const yaml = 'name: "old-value"\nversion: 1.0\n';
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('name');
    const result = setValue(yaml, tree, address, 'new-value', yamlParser.ops);
    expect(result).toBe('name: "new-value"\nversion: 1.0\n');
  });

  it('preserves single-quote style from original value', () => {
    const yaml = "version: '3.8'\nname: test\n";
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('version');
    const result = setValue(yaml, tree, address, '4.0', yamlParser.ops);
    expect(result).toBe("version: '4.0'\nname: test\n");
  });

  it('does not add quotes when original was unquoted', () => {
    const yaml = 'port: 3000\n';
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('port');
    const result = setValue(yaml, tree, address, '8080', yamlParser.ops);
    expect(result).toBe('port: 8080\n');
  });

  it('throws when targeting a container node', () => {
    const yaml = 'services:\n  api:\n    image: node:22-slim\n';
    const tree = yamlParser.parse(yaml);
    const address = yamlParser.parseAddress('services.api');
    expect(() => setValue(yaml, tree, address, 'scalar', yamlParser.ops)).toThrow();
  });
});

describe('setValue — markdown fallback', () => {
  it('replaces section body content', () => {
    const md = '# Title\n\n## Tools\n\nOld tools list.\n\n## Other\n\nStuff.\n';
    const tree = mdParser.parse(md);
    const address = mdParser.parseAddress('Tools');
    const result = setValue(md, tree, address, 'Updated tools list here.', mdParser.ops);
    expect(result).toContain('## Tools');
    expect(result).toContain('Updated tools list here.');
    expect(result).not.toContain('Old tools list.');
    expect(result).toContain('## Other');
  });

  it('preserves heading when replacing body', () => {
    const md = '# Doc\n\n## Section A\n\nOld body.\n';
    const tree = mdParser.parse(md);
    const address = mdParser.parseAddress('Section A');
    const result = setValue(md, tree, address, 'New body.', mdParser.ops);
    expect(result).toContain('## Section A');
    expect(result).toContain('New body.');
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import '../../../src/document/yaml-parser.js';
import { parserRegistry } from '@nullproof-studio/en-core';
import { resolveAddress, resolveSingleSection } from '@nullproof-studio/en-core';
import { readSection, replaceSection, deleteSection, buildOutline, appendToSection } from '@nullproof-studio/en-core';
import { yamlStrategy } from '../../../src/document/yaml-strategy.js';

const parser = parserRegistry.getParser('test.yaml');

const DOCKER_COMPOSE = `version: '3.8'
services:
  api:
    image: node:22-slim
    environment:
      NODE_ENV: production
      PORT: 3100
    volumes:
      - ./data:/data
  worker:
    image: node:22-slim
    command: node worker.js
`;

describe('YAML parser — basic parsing', () => {
  it('parses top-level scalar keys', () => {
    const yaml = 'name: test\nversion: 1.0\n';
    const tree = parser.parse(yaml);
    expect(tree.length).toBe(2);
    expect(tree[0].heading.text).toBe('name');
    expect(tree[0].heading.level).toBe(1);
    expect(tree[1].heading.text).toBe('version');
  });

  it('parses nested mappings', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    expect(tree[0].heading.text).toBe('version');
    expect(tree[1].heading.text).toBe('services');
    expect(tree[1].children.length).toBe(2);
    expect(tree[1].children[0].heading.text).toBe('api');
    expect(tree[1].children[0].heading.level).toBe(2);
  });

  it('parses deeply nested keys', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const api = tree[1].children[0]; // services.api
    expect(api.children.length).toBe(3); // image, environment, volumes
    const env = api.children[1]; // environment
    expect(env.heading.text).toBe('environment');
    expect(env.children.length).toBe(2);
    expect(env.children[0].heading.text).toBe('NODE_ENV');
    expect(env.children[1].heading.text).toBe('PORT');
  });

  it('parses sequences as indexed children', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const volumes = tree[1].children[0].children[2]; // services.api.volumes
    expect(volumes.heading.text).toBe('volumes');
    expect(volumes.children.length).toBe(1);
    expect(volumes.children[0].heading.text).toBe('[0]');
  });

  it('returns empty tree for empty YAML', () => {
    const tree = parser.parse('');
    expect(tree).toEqual([]);
  });

  it('returns empty tree for whitespace-only YAML', () => {
    const tree = parser.parse('   \n  \n');
    expect(tree).toEqual([]);
  });

  it('sets parent references correctly', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const api = tree[1].children[0];
    expect(api.parent).toBe(tree[1]);
    expect(api.parent!.heading.text).toBe('services');
  });

  it('rejects multi-document YAML', () => {
    const yaml = 'a: 1\n---\nb: 2\n---\nc: 3\n';
    expect(() => parser.parse(yaml)).toThrow('Multi-document YAML');
  });
});

describe('YAML parser — byte offsets', () => {
  it('provides accurate body content via offsets', () => {
    const yaml = 'name: hello\ncount: 42\n';
    const tree = parser.parse(yaml);
    const nameBody = yaml.slice(tree[0].bodyStartOffset, tree[0].bodyEndOffset);
    expect(nameBody).toContain('hello');
  });

  it('heading start offset is at line start', () => {
    const yaml = 'top:\n  nested: value\n';
    const tree = parser.parse(yaml);
    const nested = tree[0].children[0];
    expect(yaml[nested.headingStartOffset]).not.toBe('\n');
    // Should start at indentation
    expect(yaml.slice(nested.headingStartOffset, nested.headingStartOffset + 8)).toBe('  nested');
  });
});

describe('YAML parser — addressing', () => {
  it('parses simple key as text address', () => {
    const address = parser.parseAddress('version');
    expect(address.type).toBe('text');
  });

  it('parses dot-path as dotpath address', () => {
    const address = parser.parseAddress('services.api.environment');
    expect(address.type).toBe('dotpath');
    if (address.type === 'dotpath') {
      expect(address.segments).toEqual(['services', 'api', 'environment']);
    }
  });

  it('parses bracket notation for dotted keys', () => {
    const address = parser.parseAddress("services['my.dotted.key'].port");
    expect(address.type).toBe('dotpath');
    if (address.type === 'dotpath') {
      expect(address.segments).toEqual(['services', 'my.dotted.key', 'port']);
    }
  });

  it('parses sequence index notation', () => {
    const address = parser.parseAddress('services.api.volumes[0]');
    expect(address.type).toBe('dotpath');
    if (address.type === 'dotpath') {
      expect(address.segments).toEqual(['services', 'api', 'volumes', '[0]']);
    }
  });

  it('parses index address [0,1]', () => {
    const address = parser.parseAddress('[0, 1]');
    expect(address.type).toBe('index');
  });

  it('parses " > " path address for YAML keys', () => {
    const address = parser.parseAddress('services > api > environment');
    expect(address.type).toBe('path');
    if (address.type === 'path') {
      expect(address.segments).toEqual(['services', 'api', 'environment']);
    }
  });

  it('resolves " > " path address against YAML tree', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const address = parser.parseAddress('services > api > environment');
    const matches = resolveAddress(tree, address);
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('environment');
  });

  it('resolves dot-path address against tree', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const address = parser.parseAddress('services.api.environment');
    const matches = resolveAddress(tree, address);
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('environment');
  });

  it('resolves simple key via text address', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const address = parser.parseAddress('version');
    const matches = resolveAddress(tree, address);
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('version');
  });

  it('resolves sequence item via dot-path', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const address = parser.parseAddress('services.api.volumes[0]');
    const matches = resolveAddress(tree, address);
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('[0]');
  });
});

describe('YAML parser — section operations', () => {
  it('reads a section by dot-path', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const address = parser.parseAddress('services.api.environment');
    const result = readSection(DOCKER_COMPOSE, tree, address);
    expect(result.heading).toBe('environment');
    expect(result.content).toContain('NODE_ENV');
    expect(result.content).toContain('PORT');
  });

  it('replaces a container section body without duplication', () => {
    const yaml = `services:
  api:
    environment:
      NODE_ENV: production
      PORT: 3100
    image: node:22-slim
`;
    const tree = parser.parse(yaml);
    const address = parser.parseAddress('services.api.environment');
    const result = replaceSection(yaml, tree, address,
      '\n      NODE_ENV: staging\n      PORT: 4000\n      DEBUG: true\n', false, yamlStrategy);
    // Old values must be gone
    expect(result).not.toContain('production');
    expect(result).not.toContain('3100');
    // New values must be present
    expect(result).toContain('staging');
    expect(result).toContain('4000');
    expect(result).toContain('DEBUG: true');
    // Sibling key must be preserved
    expect(result).toContain('image: node:22-slim');
  });

  it('does not insert blank lines between YAML key and replaced values', () => {
    const yaml = `config:
  database:
    host: localhost
    port: 5432
  cache:
    enabled: true
`;
    const tree = parser.parse(yaml);
    const address = parser.parseAddress('config.database');
    const result = replaceSection(yaml, tree, address,
      '\n    host: remote.db\n    port: 3306\n', false, yamlStrategy);
    // No blank lines between key and first value
    expect(result).toMatch(/database:\n    host: remote\.db/);
    expect(result).not.toMatch(/database:\n\n/);
    // Sibling preserved
    expect(result).toContain('cache:');
    expect(result).toContain('enabled: true');
  });

  it('replaces a scalar section body', () => {
    const yaml = 'name: old-value\nversion: 1.0\n';
    const tree = parser.parse(yaml);
    const address = parser.parseAddress('name');
    const result = replaceSection(yaml, tree, address, ' new-value', false, yamlStrategy);
    expect(result).toContain('new-value');
    expect(result).not.toContain('old-value');
    expect(result).toContain('version: 1.0');
  });

  it('deletes a section', () => {
    const yaml = 'a: 1\nb: 2\nc: 3\n';
    const tree = parser.parse(yaml);
    const address = parser.parseAddress('b');
    const result = deleteSection(yaml, tree, address);
    expect(result).toContain('a: 1');
    expect(result).toContain('c: 3');
    expect(result).not.toContain('b: 2');
  });

  it('builds outline', () => {
    const tree = parser.parse(DOCKER_COMPOSE);
    const outline = buildOutline(DOCKER_COMPOSE, tree);
    expect(outline.length).toBeGreaterThan(0);
    expect(outline[0].text).toBe('version');
    const services = outline.find((e) => e.text === 'services');
    expect(services).toBeDefined();
    expect(services!.has_children).toBe(true);
  });
});

describe('YAML parser — whitespace consistency', () => {
  it('does not insert blank line before appended content', () => {
    const yaml = `services:
  api:
    image: node:22-slim
    environment:
      NODE_ENV: production
`;
    const tree = parser.parse(yaml);
    const address = parser.parseAddress('services.api.environment');
    const result = appendToSection(yaml, tree, address, '      DEBUG: true\n', yamlStrategy);
    // Appended key should be contiguous with existing keys — no blank line
    expect(result).toMatch(/NODE_ENV: production\n      DEBUG: true/);
    expect(result).not.toMatch(/production\n\n/);
  });

  it('does not leave double blank lines after replacing a container section', () => {
    const yaml = `services:
  api:
    image: node:22-slim
  worker:
    image: node:22-slim
version: '3.8'
`;
    const tree = parser.parse(yaml);
    const address = parser.parseAddress('services.api');
    const result = replaceSection(yaml, tree, address,
      '    image: node:24-slim\n    command: node server.js\n', false, yamlStrategy);
    // Should have at most one blank line before the next sibling/key
    expect(result).not.toMatch(/\n\n\n/);
    expect(result).toContain('worker:');
    expect(result).toContain("version: '3.8'");
  });
});

describe('YAML parser — append does not check for markdown headings', () => {
  it('allows appending content with # characters (YAML comments)', () => {
    const yaml = 'config:\n  key: value\n';
    const tree = parser.parse(yaml);
    const address = parser.parseAddress('config');
    // # in YAML is a comment, not a heading — should not be rejected
    const result = appendToSection(yaml, tree, address, '  # new comment\n  other: data\n', yamlStrategy);
    expect(result).toContain('# new comment');
  });
});

describe('YAML parser — comment preservation', () => {
  it('preserves comments when deleting a section', () => {
    const yaml = '# Top comment\na: 1\n# Middle comment\nb: 2\nc: 3\n';
    const tree = parser.parse(yaml);
    const address = parser.parseAddress('b');
    const result = deleteSection(yaml, tree, address);
    expect(result).toContain('# Top comment');
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '../../../src/parsers/jsonl-parser.js';
import { parserRegistry, resolveAddress, resolveSingleSection } from '@nullproof-studio/en-core';
import { buildJsonlHeading } from '../../../src/parsers/jsonl-parser.js';

const fixturesDir = resolve(import.meta.dirname, '../../../../../test/fixtures/docs');
const parser = parserRegistry.getParser('chat.jsonl');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('JsonlParser registration', () => {
  it('claims .jsonl and .ndjson', () => {
    expect(parserRegistry.getParser('a.jsonl').extensions).toContain('.jsonl');
    expect(parserRegistry.getParser('b.ndjson').extensions).toContain('.ndjson');
  });

  it('declares generateToc: false', () => {
    expect(parser.capabilities.generateToc).toBe(false);
  });
});

describe('buildJsonlHeading heuristic', () => {
  it('coalesces identifier fields with · separator', () => {
    const h = buildJsonlHeading({ name: 'alice', id: 42, description: 'admin' }, 0);
    expect(h).toBe('[0] alice · 42 · admin');
  });

  it('appends a snippet from the first non-identifier scalar when an identifier matched', () => {
    const h = buildJsonlHeading({ role: 'user', content: 'Hello how are you today' }, 0);
    // role matches identifier; content is the first non-identifier scalar
    // Snippet = first 15 chars of content ("Hello how are y") + ellipsis
    expect(h).toBe('[0] user: Hello how are y…');
  });

  it('falls back to firstKey: snippet when no identifier matches', () => {
    const h = buildJsonlHeading({ weather: 'sunny', wind: 5 }, 0);
    expect(h).toBe('[0] weather: sunny');
  });

  it('handles arrays, scalars, null at the top level', () => {
    expect(buildJsonlHeading(null, 0)).toBe('[0] null');
    expect(buildJsonlHeading(42, 1)).toBe('[1] 42');
    expect(buildJsonlHeading([1, 2, 3], 2)).toBe('[2] [1,2,3]');
  });

  it('truncates long scalar values with an ellipsis', () => {
    const h = buildJsonlHeading({ role: 'user', content: 'A'.repeat(100) }, 0);
    expect(h).toContain('…');
    expect(h.length).toBeLessThan(50);
  });

  it('gracefully handles an empty object', () => {
    expect(buildJsonlHeading({}, 0)).toBe('[0] {}');
  });

  it('ignores non-scalar identifier fields (e.g. nested objects)', () => {
    const h = buildJsonlHeading({ id: { nested: true }, name: 'alice' }, 0);
    // id isn't a scalar, so only name is used
    expect(h).toBe('[0] alice');
  });
});

describe('parse()', () => {
  it('returns one section per line for the ChatML fixture', () => {
    const content = loadFixture('chat.jsonl');
    const tree = parser.parse(content);
    expect(tree.length).toBe(4);
    expect(tree.map((n) => n.heading.level)).toEqual([1, 1, 1, 1]);
    expect(tree[0].heading.text).toBe('[0] system: You are a helpf…');
    expect(tree[1].heading.text).toBe('[1] user: Hello how are y…');
    expect(tree[2].heading.text).toBe('[2] assistant: I am doing well…');
    expect(tree[3].heading.text).toBe('[3] user: Great, can you …');
  });

  it('returns empty tree for empty content', () => {
    expect(parser.parse('')).toEqual([]);
  });

  it('skips blank lines without creating phantom sections', () => {
    const content = '{"a":1}\n\n{"b":2}\n\n\n';
    const tree = parser.parse(content);
    expect(tree.length).toBe(2);
  });

  it('still produces a section for a malformed JSON line (heading flags the error)', () => {
    const content = '{"a":1}\n{broken\n{"b":2}\n';
    const tree = parser.parse(content);
    expect(tree.length).toBe(3);
    // The malformed line's heading contains the raw content fallback
    expect(tree[1].heading.text).toContain('[1]');
  });

  it('computes byte offsets that cover exactly the record line including its trailing newline', () => {
    const content = '{"a":1}\n{"b":2}\n';
    const tree = parser.parse(content);
    expect(tree[0].headingStartOffset).toBe(0);
    expect(tree[0].bodyEndOffset).toBe(7);        // up to, not including, \n
    expect(tree[0].sectionEndOffset).toBe(8);     // past \n
    expect(tree[1].headingStartOffset).toBe(8);
    expect(tree[1].sectionEndOffset).toBe(16);
  });
});

describe('parseAddress()', () => {
  it('parses [N] as an index address', () => {
    expect(parser.parseAddress('[2]')).toEqual({ type: 'index', indices: [2] });
  });

  it('parses [*] glob-style addresses as patterns', () => {
    const addr = parser.parseAddress('[*] user*');
    expect(addr.type).toBe('pattern');
  });

  it('falls back to a text address when the input is literal heading text', () => {
    const addr = parser.parseAddress('[0] system: You are…');
    expect(addr.type).toBe('text');
  });
});

describe('validate()', () => {
  it('returns empty warnings for a well-formed file', () => {
    const content = loadFixture('chat.jsonl');
    expect(parser.validate(content)).toEqual([]);
  });

  it('returns a line-numbered warning for each malformed line', () => {
    const content = '{"a":1}\n{broken\n{"b":2}\n';
    const warnings = parser.validate(content);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('Line 2');
    expect(warnings[0]).toContain('parse error');
  });

  it('returns empty for an empty file', () => {
    expect(parser.validate('')).toEqual([]);
    expect(parser.validate('   \n\n\n')).toEqual([]);
  });
});

describe('round-trip via section-ops core (replaceSection)', () => {
  it('replacing a record keeps the remaining records parseable', async () => {
    const { replaceSection } = await import('@nullproof-studio/en-core');
    const { jsonlStrategy } = await import('../../../src/parsers/jsonl-strategy.js');

    const original = '{"role":"system","content":"old"}\n{"role":"user","content":"hi"}\n';
    const tree = parser.parse(original);
    const updated = replaceSection(
      original,
      tree,
      { type: 'index', indices: [0] },
      '{"role":"system","content":"new"}',
      false,
      jsonlStrategy,
    );

    // Re-parse the updated file and verify both records round-trip cleanly.
    const retree = parser.parse(updated);
    expect(retree.length).toBe(2);
    expect(retree[0].heading.text).toContain('system');
    expect(retree[1].heading.text).toContain('user');

    // The underlying JSON for record 0 is the new content.
    const newFirstLine = updated.slice(retree[0].bodyStartOffset, retree[0].bodyEndOffset);
    expect(JSON.parse(newFirstLine)).toEqual({ role: 'system', content: 'new' });
  });
});

describe('address resolution via resolveAddress() / resolveSingleSection()', () => {
  it('resolves [N] index to the correct record', () => {
    const content = loadFixture('chat.jsonl');
    const tree = parser.parse(content);
    const node = resolveSingleSection(tree, { type: 'index', indices: [1] });
    expect(node.heading.text).toBe('[1] user: Hello how are y…');
  });

  it('resolves a pattern to multiple records', () => {
    const content = loadFixture('chat.jsonl');
    const tree = parser.parse(content);
    const matches = resolveAddress(tree, { type: 'pattern', pattern: '*user*' });
    // both [1] and [3] are user messages
    expect(matches.length).toBe(2);
  });
});

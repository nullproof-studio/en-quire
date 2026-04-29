// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { parserRegistry } from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';

const parser = parserRegistry.getParser('test.md');

describe('duplicate sibling validation', () => {
  it('warning identifies the duplicate by index path so agent can disambiguate', () => {
    // Two top-level "## Foo" siblings.
    const md = '# Doc\n\n## Foo\n\nA.\n\n## Bar\n\nx.\n\n## Foo\n\nB.\n';
    const warnings = parser.validate(md);
    const dupWarnings = warnings.filter((w) => w.includes('Duplicate sibling'));
    expect(dupWarnings.length).toBe(1);
    // The warning should include the index path of the duplicate so the agent
    // can target it via {type: "index", indices: [...]} on a follow-up call.
    expect(dupWarnings[0]).toMatch(/index\s*\[\s*\d/);
    // And should still mention the duplicate's heading text.
    expect(dupWarnings[0]).toContain('Foo');
  });

  it('warning identifies the parent path for nested duplicates', () => {
    // Two "### Foo" siblings under "## Section A".
    const md = '# Doc\n\n## Section A\n\n### Foo\n\nA.\n\n### Foo\n\nB.\n';
    const warnings = parser.validate(md);
    const dupWarnings = warnings.filter((w) => w.includes('Duplicate sibling'));
    expect(dupWarnings.length).toBe(1);
    expect(dupWarnings[0]).toContain('Section A');
    expect(dupWarnings[0]).toMatch(/index\s*\[\s*\d/);
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeAll } from 'vitest';
import type { RawLink } from '@nullproof-studio/en-core';
import { parserRegistry } from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';

let extract: (content: string) => RawLink[];

beforeAll(() => {
  const parser = parserRegistry.getParser('foo.md');
  if (!parser.extractLinks) {
    throw new Error('markdown parser does not implement extractLinks');
  }
  extract = parser.extractLinks.bind(parser);
});

describe('markdown link extractor — markdown links', () => {
  it('extracts a relative markdown link as a reference', () => {
    const links = extract('See [the runbook](sops/runbook.md) for details.\n');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      target_path: 'sops/runbook.md',
      target_section: null,
      relationship: 'references',
      source_section: null,
    });
  });

  it('captures target_section from URL fragments', () => {
    const links = extract('Refer to [section 2.7](sops/deployment.md#checks) before deploying.\n');
    expect(links).toHaveLength(1);
    expect(links[0].target_path).toBe('sops/deployment.md');
    expect(links[0].target_section).toBe('checks');
  });

  it('skips external http(s) links', () => {
    const links = extract('See [Anthropic](https://anthropic.com) and [docs](https://example.com/x.md).\n');
    expect(links).toHaveLength(0);
  });

  it('skips mailto: and other non-http schemes', () => {
    const links = extract('Email [us](mailto:a@b.com) or [check](tel:+1).\n');
    expect(links).toHaveLength(0);
  });

  it('skips image references (no inversion of intent)', () => {
    const links = extract('![diagram](diagram.png) and [real link](real.md)\n');
    const targets = links.map((l) => l.target_path);
    expect(targets).toEqual(['real.md']);
  });

  it('skips links inside fenced code blocks', () => {
    const md = [
      '# Title',
      '',
      '```',
      'See [fake](skipme.md) here',
      '```',
      '',
      'But [real](real.md) is captured.',
    ].join('\n');
    const links = extract(md);
    expect(links.map((l) => l.target_path)).toEqual(['real.md']);
  });

  it('attributes links to their containing section', () => {
    const md = [
      '# Top',
      '',
      'Pre-heading text here is not in a section path.',
      '',
      '## Foo',
      '',
      'See [bar](bar.md) here.',
      '',
      '## Quux',
      '',
      'And [baz](baz.md) here.',
    ].join('\n');
    const links = extract(md);
    const foo = links.find((l) => l.target_path === 'bar.md');
    const quux = links.find((l) => l.target_path === 'baz.md');
    expect(foo?.source_section).toBe('Top > Foo');
    expect(quux?.source_section).toBe('Top > Quux');
  });
});

describe('markdown link extractor — Obsidian wiki links', () => {
  it('extracts [[doc-name]] as a bare basename reference', () => {
    const links = extract('See [[triage-agent]] for details.\n');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      target_path: 'triage-agent',
      target_section: null,
      relationship: 'references',
    });
  });

  it('extracts [[doc-name#section]] with target_section', () => {
    const links = extract('See [[triage-agent#tool selection]].\n');
    expect(links[0].target_path).toBe('triage-agent');
    expect(links[0].target_section).toBe('tool selection');
  });

  it('extracts [[doc-name|alias]] ignoring the alias for resolution', () => {
    const links = extract('See [[triage-agent|the triage skill]] for details.\n');
    expect(links[0].target_path).toBe('triage-agent');
    expect(links[0].target_section).toBeNull();
  });

  it('skips wiki links inside code blocks', () => {
    const md = [
      '```',
      '[[fake]]',
      '```',
      '[[real]]',
    ].join('\n');
    const links = extract(md);
    expect(links.map((l) => l.target_path)).toEqual(['real']);
  });
});

describe('markdown link extractor — frontmatter relationships', () => {
  it('extracts implements / supersedes / see_also / references arrays', () => {
    const md = [
      '---',
      'implements:',
      '  - sops/runbook.md',
      '  - skills/triage.md',
      'supersedes:',
      '  - old/v1.md',
      'see_also:',
      '  - codex/related.mdx',
      'references:',
      '  - other/doc.md',
      '---',
      '# Title',
      '',
      'Body.',
    ].join('\n');
    const links = extract(md);

    const byRel = (rel: RawLink['relationship']) =>
      links.filter((l) => l.relationship === rel).map((l) => l.target_path).sort();

    expect(byRel('implements')).toEqual(['skills/triage.md', 'sops/runbook.md']);
    expect(byRel('supersedes')).toEqual(['old/v1.md']);
    expect(byRel('see_also')).toEqual(['codex/related.mdx']);
    expect(byRel('references')).toEqual(['other/doc.md']);

    // Frontmatter relationships have no source section
    for (const link of links) {
      expect(link.source_section).toBeNull();
    }

    // Frontmatter paths are intended as fully-qualified document refs;
    // mark them as `prefixed` so the resolver doesn't re-resolve them.
    for (const link of links) {
      expect(link.prefixed).toBe(true);
    }
  });

  it('ignores frontmatter keys that are not relationship arrays', () => {
    const md = [
      '---',
      'title: Test',
      'tags: [a, b]',
      '---',
      '# Title',
    ].join('\n');
    expect(extract(md)).toHaveLength(0);
  });

  it('tolerates missing or malformed frontmatter', () => {
    expect(() => extract('# Just a heading\n')).not.toThrow();
    expect(() => extract('---\nnot: valid: yaml: at all\n---\n# t\n')).not.toThrow();
  });
});

describe('markdown link extractor — context', () => {
  it('captures a short snippet around each markdown link for disambiguation', () => {
    const links = extract('Read more in [the runbook](sops/runbook.md) when you have time.\n');
    expect(links[0].context).toBeDefined();
    expect(links[0].context).toContain('runbook');
  });
});

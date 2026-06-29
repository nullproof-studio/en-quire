// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import {
  extractAnchor,
  slugify,
  uniqueSlug,
  assignAnchors,
} from '../../../src/document/anchors.js';

describe('extractAnchor', () => {
  it('splits a trailing ^id token from the heading text', () => {
    expect(extractAnchor('Storage Mapping ^store-map')).toEqual({
      text: 'Storage Mapping',
      anchorId: 'store-map',
    });
  });

  it('returns clean text and no id when there is no anchor', () => {
    expect(extractAnchor('Storage Mapping')).toEqual({ text: 'Storage Mapping' });
  });

  it('accepts ids with digits, hyphens and underscores', () => {
    expect(extractAnchor('Heading ^sec_13-1a').anchorId).toBe('sec_13-1a');
  });

  it('does not treat a mid-heading caret as an anchor', () => {
    // Carets inside the text (e.g. exponents) must not be captured.
    expect(extractAnchor('E = mc^2 in prose')).toEqual({ text: 'E = mc^2 in prose' });
  });

  it('requires whitespace before the caret', () => {
    expect(extractAnchor('word^id')).toEqual({ text: 'word^id' });
  });

  it('ignores a bare caret with no slug', () => {
    expect(extractAnchor('Heading ^')).toEqual({ text: 'Heading ^' });
  });
});

describe('slugify', () => {
  it('lowercases, strips punctuation, and hyphenates spaces', () => {
    expect(slugify('Storage Mapping (Postgres, pending OQ-004)')).toBe(
      'storage-mapping-postgres-pending-oq-004',
    );
  });

  it('collapses repeated separators and trims edges', () => {
    expect(slugify('  Foo   &   Bar!! ')).toBe('foo-bar');
  });
});

describe('uniqueSlug', () => {
  it('returns the base when free', () => {
    expect(uniqueSlug('intro', new Set())).toBe('intro');
  });

  it('suffixes -2, -3 on collision', () => {
    const taken = new Set(['intro', 'intro-2']);
    expect(uniqueSlug('intro', taken)).toBe('intro-3');
  });
});

describe('assignAnchors', () => {
  it('appends a ^id to every heading lacking one, deriving from heading text', () => {
    const md = '# Title\n\n## Background\n\nx.\n\n## Design\n\ny.\n';
    const { content, assigned } = assignAnchors(md);
    expect(content).toContain('# Title ^title');
    expect(content).toContain('## Background ^background');
    expect(content).toContain('## Design ^design');
    expect(assigned.map((a) => a.anchorId)).toEqual(['title', 'background', 'design']);
  });

  it('leaves existing anchors untouched and does not reassign', () => {
    const md = '# Title ^t\n\n## Background\n\nx.\n';
    const { content, assigned } = assignAnchors(md);
    expect(content).toContain('# Title ^t');
    // Only the un-anchored heading is assigned.
    expect(assigned).toHaveLength(1);
    expect(assigned[0].anchorId).toBe('background');
  });

  it('avoids collisions with existing anchors and across newly assigned ones', () => {
    const md = '# Dup ^dup\n\n## Dup\n\nx.\n\n## Dup\n\ny.\n';
    const { content } = assignAnchors(md);
    // The two "Dup" headings slug to "dup", already taken → -2, -3.
    expect(content).toContain('## Dup ^dup-2');
    expect(content).toContain('## Dup ^dup-3');
  });

  it('does not touch headings inside fenced code blocks', () => {
    const md = '# Real\n\n```\n# Not A Heading\n```\n';
    const { content, assigned } = assignAnchors(md);
    expect(content).toContain('# Real ^real');
    expect(content).toContain('# Not A Heading'); // unchanged, no anchor
    expect(assigned).toHaveLength(1);
  });
});

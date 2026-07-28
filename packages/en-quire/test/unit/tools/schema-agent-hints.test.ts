// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { DocReadSectionSchema } from '../../../src/tools/read/doc-read-section.js';
import { DocInsertSectionSchema } from '../../../src/tools/write/doc-insert-section.js';
import { DocMoveSectionSchema } from '../../../src/tools/write/doc-move-section.js';

/**
 * Regression coverage for https://github.com/nullproof-studio/en-quire/issues/103 —
 * agents sending a stringified boolean or an invented enum value used to get a
 * bare zod dump back with no way to self-correct. These assert the schema-level
 * fixes: forgiving boolean coercion, and an enriched enum error message (applied
 * to every position-style enum, not just the one in the reported transcript).
 */

describe('DocReadSectionSchema — booleanish include_children', () => {
  const base = { file: 'root/f.md', section: 'Intro' };

  it('accepts a native boolean', () => {
    const result = DocReadSectionSchema.safeParse({ ...base, include_children: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.include_children).toBe(false);
  });

  it('coerces a stringified boolean, matching the reported agent transcript', () => {
    const result = DocReadSectionSchema.safeParse({ ...base, include_children: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.include_children).toBe(true);
  });

  it('still rejects a value that is not a recognised boolean form', () => {
    const result = DocReadSectionSchema.safeParse({ ...base, include_children: 'maybe' });
    expect(result.success).toBe(false);
  });
});

describe('DocInsertSectionSchema — enriched position enum error', () => {
  const base = { file: 'root/f.md', anchor: 'Intro', heading: 'New', content: 'body' };

  it('accepts a valid position', () => {
    const result = DocInsertSectionSchema.safeParse({ ...base, position: 'after' });
    expect(result.success).toBe(true);
  });

  it('points the agent at doc_replace_section when it invents "replace", matching the reported transcript', () => {
    const result = DocInsertSectionSchema.safeParse({ ...base, position: 'replace' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('doc_replace_section');
      expect(result.error.issues[0].message).toContain('before, after, child_start, child_end');
    }
  });

  it('falls back to the default zod message for a non-enum-value error (wrong type)', () => {
    const result = DocInsertSectionSchema.safeParse({ ...base, position: 42 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).not.toContain('doc_replace_section');
    }
  });
});

describe('DocMoveSectionSchema — enriched position enum error', () => {
  const base = { file: 'root/f.md', section: 'Changelog', anchor: 'Intro' };

  it('accepts a valid position', () => {
    const result = DocMoveSectionSchema.safeParse({ ...base, position: 'after' });
    expect(result.success).toBe(true);
  });

  it('points the agent at doc_replace_section when it invents "replace" — same failure mode as doc_insert_section, on a sibling tool', () => {
    const result = DocMoveSectionSchema.safeParse({ ...base, position: 'replace' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('doc_replace_section');
      expect(result.error.issues[0].message).toContain('before, after, child_start, child_end');
    }
  });
});

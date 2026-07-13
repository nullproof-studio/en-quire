// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { booleanish, enumWithHint } from '@nullproof-studio/en-core';

describe('booleanish', () => {
  it('accepts native booleans unchanged', () => {
    expect(booleanish().parse(true)).toBe(true);
    expect(booleanish().parse(false)).toBe(false);
  });

  it('coerces common string forms, case-insensitively', () => {
    expect(booleanish().parse('true')).toBe(true);
    expect(booleanish().parse('True')).toBe(true);
    expect(booleanish().parse('TRUE')).toBe(true);
    expect(booleanish().parse('1')).toBe(true);
    expect(booleanish().parse('false')).toBe(false);
    expect(booleanish().parse('False')).toBe(false);
    expect(booleanish().parse('0')).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(booleanish().parse(' true ')).toBe(true);
  });

  it('rejects strings that are not a recognised boolean form', () => {
    expect(() => booleanish().parse('yes')).toThrow(/Expected boolean, received string/);
  });

  it('rejects non-boolean, non-string types with the standard zod message', () => {
    expect(() => booleanish().parse(5)).toThrow(/Expected boolean, received number/);
    expect(() => booleanish().parse(null)).toThrow();
  });

  it('composes with .default()', () => {
    const schema = booleanish().default(true);
    expect(schema.parse(undefined)).toBe(true);
    expect(schema.parse('false')).toBe(false);
  });

  it('composes with .optional()', () => {
    const schema = booleanish().optional();
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse('true')).toBe(true);
  });

  it('composes with .describe()', () => {
    const schema = booleanish().describe('some flag');
    expect(schema.description).toBe('some flag');
  });

  it('works as an object field alongside other zod types', () => {
    const schema = z.object({ flag: booleanish().default(false) });
    expect(schema.parse({ flag: 'true' })).toEqual({ flag: true });
    expect(schema.parse({})).toEqual({ flag: false });
  });
});

describe('enumWithHint', () => {
  const schema = enumWithHint(['before', 'after'], 'Use doc_replace_section instead.');

  it('accepts a valid value', () => {
    expect(schema.parse('before')).toBe('before');
  });

  it('lists the valid values and appends the hint on an invalid value', () => {
    const result = schema.safeParse('replace');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Invalid value "replace". Valid values: before, after. Use doc_replace_section instead.',
      );
    }
  });

  it('falls back to the default zod message for a wrong-type input', () => {
    const result = schema.safeParse(42);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).not.toContain('Use doc_replace_section instead.');
    }
  });
});

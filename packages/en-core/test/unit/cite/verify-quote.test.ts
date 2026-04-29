// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { verifyQuote, ValidationError } from '@nullproof-studio/en-core';

describe('verifyQuote — exact match path', () => {
  it('returns verified when the quote is a verbatim substring of the source', () => {
    const source = 'Anthropic announced a $14 billion annualised revenue run rate today.\n';
    const quote = '$14 billion annualised revenue run rate';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.match.offset).toBe(source.indexOf(quote));
      expect(result.match.line).toBe(1);
      expect(result.match.col).toBeGreaterThan(0);
    }
  });

  it('reports first-occurrence position when the quote appears more than once', () => {
    const source = 'foo and foo and foo';
    const result = verifyQuote(source, 'foo');
    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.match.offset).toBe(0);
    }
  });

  it('verifies a multi-line quote that spans newlines', () => {
    const source = 'line one\nline two\nline three\n';
    const quote = 'line one\nline two';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('verified');
  });

  it('verifies a quote at the very end of the source', () => {
    const source = 'preamble end of file';
    const result = verifyQuote(source, 'end of file');
    expect(result.status).toBe('verified');
  });

  it('is case-sensitive — different case is not a match', () => {
    const source = 'Anthropic announced...';
    const result = verifyQuote(source, 'ANTHROPIC announced...');
    expect(result.status).toBe('not_found');
  });
});

describe('verifyQuote — numeric truncation guard', () => {
  it('flags a trailing-digit truncation', () => {
    const source = 'The company raised $2,500 last year.';
    const quote = 'raised $2,50';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.warning_code).toBe('numeric_truncation');
    }
  });

  it('flags a leading-digit truncation', () => {
    const source = 'value 1234 noted';
    const quote = '234 noted';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.warning_code).toBe('numeric_truncation');
    }
  });

  it('does not flag when the full numeric token is contained in the quote', () => {
    const source = 'The company raised $2,500 last year.';
    const quote = '$2,500 last year';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('verified');
  });

  it('does not flag when the adjacent character is a non-digit (currency, percent, space)', () => {
    // "$15M and $150M" — quote "150M" — char before is "$" (not digit), char after is end-of-source (no char)
    expect(verifyQuote('$15M and $150M', '150M').status).toBe('verified');
    expect(verifyQuote('reach 90% growth', '90%').status).toBe('verified');
    expect(verifyQuote('a 25 cent gain', '25 cent').status).toBe('verified');
  });

  it('does not flag when the matched quote ends with a non-digit', () => {
    // Quote "raised $2," ends in ",". Source contains "raised $2,500". Should NOT flag — the
    // boundary at the end of the match is a digit ("5") in the source, but the quote's last
    // char is "," not a digit. Truncation guard is about digit-end-in-quote vs digit-after.
    const source = 'raised $2,500 last year.';
    const quote = 'raised $2,';
    const result = verifyQuote(source, quote);
    // Per the digit-adjacency rule, this is not a numeric truncation: comma is not a digit.
    // It might still be a boundary warning, but not numeric_truncation.
    if (result.status === 'warning') {
      expect(result.warning_code).not.toBe('numeric_truncation');
    }
  });
});

describe('verifyQuote — word boundary guard', () => {
  it('flags a quote that lands inside a larger word', () => {
    const source = 'critics have called the approach unconstitutional in scope.';
    const quote = 'constitutional';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.warning_code).toBe('boundary_warning');
    }
  });

  it('does not flag when the match sits on a word boundary', () => {
    const source = 'a constitutional approach';
    const quote = 'constitutional';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('verified');
  });

  it('flags a leading word-boundary intrusion', () => {
    const source = 'precondition met';
    const quote = 'condition met';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.warning_code).toBe('boundary_warning');
    }
  });

  it('numeric truncation takes precedence over word boundary when both could apply', () => {
    // Source "x123y" — quote "23" — leading "1" (digit), trailing "y" (letter). Numeric wins.
    const source = 'x123y';
    const quote = '23';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.warning_code).toBe('numeric_truncation');
    }
  });
});

describe('verifyQuote — formatting-difference fallback', () => {
  it('flags a smart-quote difference as formatting_difference', () => {
    const source = 'She wrote: “we raised $14M”.';
    const quote = '"we raised $14M"';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.warning_code).toBe('formatting_difference');
    }
  });

  it('flags an NBSP-vs-space difference as formatting_difference', () => {
    const source = 'two words on a page'; // NBSP between two and words
    const quote = 'two words';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.warning_code).toBe('formatting_difference');
    }
  });

  it('flags an en-dash-vs-hyphen difference as formatting_difference', () => {
    const source = 'range of $150–200M was discussed';
    const quote = '$150-200M';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('warning');
    if (result.status === 'warning') {
      expect(result.warning_code).toBe('formatting_difference');
    }
  });
});

describe('verifyQuote — failure modes', () => {
  it('returns not_found for a fabricated quote', () => {
    const source = 'real source content here';
    const result = verifyQuote(source, 'completely made-up quote');
    expect(result.status).toBe('not_found');
    if (result.status === 'not_found') {
      expect(result.reason).toBe('not_found');
    }
  });

  it('returns not_found for a mangled number where neither exact nor formatting match works', () => {
    // Source has "$150–200M", quote has "$150–20M" — that is a digit edit, not a formatting variant.
    const source = 'revenue range of $150–200M annualised';
    const quote = '$150–20M annualised';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('not_found');
  });

  it('returns not_found when the quote is longer than the source', () => {
    const source = 'short';
    const quote = 'a much much longer quote than the source';
    const result = verifyQuote(source, quote);
    expect(result.status).toBe('not_found');
  });

  it('throws ValidationError for an empty quote', () => {
    expect(() => verifyQuote('source', '')).toThrow(ValidationError);
  });

  it('does not return any fetched-content fields in the result (content-free design)', () => {
    const source = 'real source content here';
    const result = verifyQuote(source, 'completely made-up quote');
    // The result must be a small fixed-shape object with no source fragments leaking back.
    const allowedKeys = new Set(['status', 'reason', 'warning_code', 'match']);
    for (const key of Object.keys(result)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    // Specifically check none of the disallowed fields are present.
    expect((result as Record<string, unknown>).nearest_matches).toBeUndefined();
    expect((result as Record<string, unknown>).source_context).toBeUndefined();
    expect((result as Record<string, unknown>).suggested_correction).toBeUndefined();
    expect((result as Record<string, unknown>).source_title).toBeUndefined();
  });
});

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { parserRegistry } from '../../../src/document/parser-registry.js';
import '../../../src/document/markdown-parser.js';

const parser = parserRegistry.getParser('test.md');

describe('code fence balance validation', () => {
  it('accepts a document with balanced fences', () => {
    const md = [
      '# Title',
      '',
      '```typescript',
      'const x = 1;',
      '```',
      '',
      '## Next',
    ].join('\n');
    const warnings = parser.validate(md);
    expect(warnings.filter(w => w.includes('Unbalanced'))).toHaveLength(0);
  });

  it('accepts a document with no fences', () => {
    const md = '# Title\n\nSome text.\n\n## Next\n';
    const warnings = parser.validate(md);
    expect(warnings.filter(w => w.includes('Unbalanced'))).toHaveLength(0);
  });

  it('accepts multiple balanced fence pairs', () => {
    const md = [
      '# Title',
      '',
      '```json',
      '{ "a": 1 }',
      '```',
      '',
      '```typescript',
      'const x = 1;',
      '```',
      '',
      '```python',
      'print("hi")',
      '```',
    ].join('\n');
    const warnings = parser.validate(md);
    expect(warnings.filter(w => w.includes('Unbalanced'))).toHaveLength(0);
  });

  it('accepts tilde fences', () => {
    const md = [
      '# Title',
      '',
      '~~~',
      'code here',
      '~~~',
    ].join('\n');
    const warnings = parser.validate(md);
    expect(warnings.filter(w => w.includes('Unbalanced'))).toHaveLength(0);
  });

  it('rejects a document with an unclosed fence', () => {
    const md = [
      '# Title',
      '',
      '```typescript',
      'const x = 1;',
      '',
      '## This heading is inside the fence',
    ].join('\n');
    const warnings = parser.validate(md);
    const fenceWarnings = warnings.filter(w => w.includes('Unbalanced'));
    expect(fenceWarnings).toHaveLength(1);
    expect(fenceWarnings[0]).toContain('syntax error');
    expect(fenceWarnings[0]).toContain('line 3');
  });

  it('rejects nested code fences (the real-world failure pattern)', () => {
    // This is the pattern that caused structural damage in SPEC-AUTHOR-AGENT.md:
    // a ```markdown block containing ```json — the inner ```json is NOT a
    // closing fence (it has trailing text), so the ``` after the JSON closes
    // the outer fence. The final ``` then opens a new fence that's never closed.
    const md = [
      '# Template Quick-Start',
      '',
      '```markdown',       // Opens fence
      '## Template Heading',
      '',
      '```json',           // NOT a closing fence (has info string "json")
      '{ "key": 1 }',
      '```',               // Closes the outer markdown fence
      '',
      '## Another Heading',
      '```',               // Opens a new fence — never closed!
      '',
      '## Real Section',
    ].join('\n');
    const warnings = parser.validate(md);
    const fenceWarnings = warnings.filter(w => w.includes('Unbalanced'));
    expect(fenceWarnings).toHaveLength(1);
    expect(fenceWarnings[0]).toContain('syntax error');
  });

  it('correctly handles closing fence requiring matching marker type', () => {
    // ~~~ cannot close a ``` fence
    const md = [
      '# Title',
      '',
      '```typescript',
      'const x = 1;',
      '~~~',              // Wrong marker — does NOT close the ``` fence
      '',
      '## Heading',
    ].join('\n');
    const warnings = parser.validate(md);
    const fenceWarnings = warnings.filter(w => w.includes('Unbalanced'));
    expect(fenceWarnings).toHaveLength(1);
    expect(fenceWarnings[0]).toContain('line 3');
  });

  it('correctly handles closing fence requiring sufficient length', () => {
    // ```` (4 backticks) cannot be closed by ``` (3 backticks)
    const md = [
      '# Title',
      '',
      '````typescript',
      'const x = 1;',
      '```',              // Too short — does NOT close the ```` fence
      '````',             // This closes it
    ].join('\n');
    const warnings = parser.validate(md);
    const fenceWarnings = warnings.filter(w => w.includes('Unbalanced'));
    expect(fenceWarnings).toHaveLength(0);
  });

  it('rejects when closing fence has trailing non-space text', () => {
    // A closing fence must not have trailing text (other than spaces)
    const md = [
      '# Title',
      '',
      '```typescript',
      'const x = 1;',
      '``` some text',    // Not a valid closing fence
      '',
      '## Heading',
    ].join('\n');
    const warnings = parser.validate(md);
    const fenceWarnings = warnings.filter(w => w.includes('Unbalanced'));
    expect(fenceWarnings).toHaveLength(1);
  });
});

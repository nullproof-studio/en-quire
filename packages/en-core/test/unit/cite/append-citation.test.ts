// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { buildCitationAppend } from '@nullproof-studio/en-core';

describe('buildCitationAppend — section absent', () => {
  it('appends a new ## Citations section at end of document', () => {
    const before = '# Profile\n\nBody paragraph.\n';
    const result = buildCitationAppend(before, '(1) https://forbes.com/x [hash:sha256:abc]', 'Citations');
    expect(result).toBe(
      '# Profile\n\nBody paragraph.\n\n## Citations\n\n(1) https://forbes.com/x [hash:sha256:abc]\n',
    );
  });

  it('handles documents without trailing newline', () => {
    const before = '# Profile\n\nBody paragraph.';
    const result = buildCitationAppend(before, '(1) https://x.test [hash:sha256:abc]', 'Citations');
    expect(result.endsWith('\n')).toBe(true);
    expect(result).toContain('## Citations');
    expect(result).toContain('(1) https://x.test [hash:sha256:abc]');
  });

  it('uses the configured heading text', () => {
    const before = '# Profile\n\nBody.\n';
    const result = buildCitationAppend(before, '(1) https://x.test [hash:sha256:abc]', 'References');
    expect(result).toContain('## References');
    expect(result).not.toContain('## Citations');
  });
});

describe('buildCitationAppend — section already exists', () => {
  it('appends to an existing ## Citations section', () => {
    const before = '# Profile\n\nBody.\n\n## Citations\n\n(1) https://a.test [hash:sha256:aa]\n';
    const result = buildCitationAppend(before, '(2) https://b.test [hash:sha256:bb]', 'Citations');
    expect(result).toContain('(1) https://a.test [hash:sha256:aa]');
    expect(result).toContain('(2) https://b.test [hash:sha256:bb]');
    // The new line should appear after the first one in document order
    expect(result.indexOf('(1)')).toBeLessThan(result.indexOf('(2)'));
  });

  it('matches heading case-insensitively', () => {
    const before = '# X\n\n## CITATIONS\n\n(1) https://a.test [hash:sha256:aa]\n';
    const result = buildCitationAppend(before, '(2) https://b.test [hash:sha256:bb]', 'Citations');
    expect(result).toContain('(2) https://b.test [hash:sha256:bb]');
    // It should not have created a duplicate section
    expect(result.match(/## CITATIONS/g)?.length).toBe(1);
    expect(result.match(/## Citations/g)).toBeNull();
  });

  it('does not stomp other sections that come after Citations', () => {
    const before =
      '# Profile\n\n## Citations\n\n(1) https://a.test [hash:sha256:aa]\n\n## Notes\n\nlater section\n';
    const result = buildCitationAppend(before, '(2) https://b.test [hash:sha256:bb]', 'Citations');
    expect(result).toContain('## Notes');
    expect(result).toContain('later section');
    expect(result.indexOf('(2)')).toBeLessThan(result.indexOf('## Notes'));
  });
});

describe('buildCitationAppend — content-free guarantee', () => {
  it('writes exactly the reference line into the document — no transformations', () => {
    const before = '# X\n';
    const malicious = '(1) https://attacker.test/<script>alert(1)</script> [hash:sha256:bad]';
    // The formatter would have rejected this URL upstream; we're testing that
    // buildCitationAppend itself does not modify or escape the line.
    const result = buildCitationAppend(before, malicious, 'Citations');
    expect(result).toContain(malicious);
  });

  it('does not introduce any external content into the output', () => {
    const before = '# X\n';
    const line = '(1) https://x.test [hash:sha256:abc]';
    const result = buildCitationAppend(before, line, 'Citations');
    // Output must equal input + heading + line + newline. Anything else means
    // we're letting fetched content leak in.
    expect(result.length).toBe(before.length + '\n## Citations\n\n'.length + line.length + 1);
  });
});

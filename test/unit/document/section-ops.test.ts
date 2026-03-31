// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMarkdown } from '../../../src/document/parser.js';
import { buildSectionTree } from '../../../src/document/section-tree.js';
import {
  readSection,
  replaceSection,
  insertSection,
  appendToSection,
  deleteSection,
  buildOutline,
  findReplace,
  generateToc,
} from '../../../src/document/section-ops.js';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/docs');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

function parse(md: string) {
  const ast = parseMarkdown(md);
  return buildSectionTree(ast, md);
}

describe('readSection', () => {
  it('reads a section with its content', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section One' });
    expect(result.heading).toBe('Section One');
    expect(result.content).toContain('## Section One');
    expect(result.content).toContain('Content of section one.');
  });

  it('includes children by default', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section Two' });
    expect(result.content).toContain('Subsection 2.1');
    expect(result.content).toContain('Subsection 2.2');
  });

  it('excludes children when requested', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section Two' }, false);
    expect(result.content).toContain('Content of section two.');
    expect(result.content).not.toContain('Subsection 2.1');
  });

  it('provides sibling context', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section Two' });
    expect(result.prev_sibling).toBe('Section One');
    expect(result.next_sibling).toBe('Section Three');
  });

  it('has no prev_sibling for first child', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section One' });
    expect(result.prev_sibling).toBeUndefined();
  });
});

describe('replaceSection', () => {
  it('replaces section body', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, 'New content.\n');
    expect(result).toContain('## A');
    expect(result).toContain('New content.');
    expect(result).not.toContain('Old content.');
    expect(result).toContain('Keep this.');
  });

  it('replaces heading when requested', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(
      md, tree,
      { type: 'text', text: 'A' },
      '## A Renamed\n\nNew content.\n',
      true,
    );
    expect(result).toContain('## A Renamed');
    expect(result).not.toContain('Old content.');
  });
});

describe('insertSection', () => {
  it('inserts before an anchor', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'B' }, 'before', 'Inserted', 'New content.');
    expect(result.indexOf('## Inserted')).toBeLessThan(result.indexOf('## B'));
  });

  it('inserts after an anchor', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'A' }, 'after', 'Inserted', 'New content.');
    expect(result.indexOf('## Inserted')).toBeGreaterThan(result.indexOf('## A'));
    expect(result.indexOf('## Inserted')).toBeLessThan(result.indexOf('## B'));
  });

  it('inserts as child with correct level', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'A' }, 'child_end', 'Sub', 'Sub content.');
    expect(result).toContain('### Sub');
  });
});

describe('replaceSection — trailing newline preservation', () => {
  it('ensures next section heading is not concatenated when content lacks trailing newline', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, 'Replaced content.');
    expect(result).toContain('Replaced content.\n\n## B');
    expect(result).not.toMatch(/Replaced content\.## B/);
  });

  it('does not add extra newlines when content already ends with \\n\\n', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, 'Replaced content.\n\n');
    expect(result).toContain('Replaced content.\n\n## B');
    expect(result).not.toContain('Replaced content.\n\n\n');
  });

  it('ensures trailing newlines with replaceHeading=true', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, '## A\n\nNew content.', true);
    expect(result).toContain('New content.\n\n## B');
  });

  it('ensures trailing newlines with replaceHeading as string', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, 'New content.', 'Renamed');
    expect(result).toContain('New content.\n\n## B');
  });
});

describe('insertSection — heading sanitisation', () => {
  it('strips leading # markers from heading parameter', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'A' }, 'after', '## New Section', 'Body.');
    expect(result).toContain('## New Section');
    expect(result).not.toContain('## ## New Section');
  });

  it('strips multiple # markers from heading', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'A' }, 'after', '### Deep Section', 'Body.', 3);
    expect(result).toContain('### Deep Section');
    expect(result).not.toContain('### ### Deep Section');
  });

  it('handles headings without # markers (normal case)', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'A' }, 'after', 'Clean Heading', 'Body.');
    expect(result).toContain('## Clean Heading');
  });
});

describe('replaceSection — heading preservation', () => {
  it('preserves heading when replaceHeading=true but content has no heading line', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(
      md, tree,
      { type: 'text', text: 'A' },
      'New body only.\n',
      true,
    );
    expect(result).toContain('## A');
    expect(result).toContain('New body only.');
    expect(result).not.toContain('Old content.');
  });

  it('replaces heading text when replaceHeading is a string', () => {
    const md = '# Doc\n\n## A\n\nContent.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(
      md, tree,
      { type: 'text', text: 'A' },
      'New body.\n',
      'Renamed Section',
    );
    expect(result).toContain('## Renamed Section');
    expect(result).toContain('New body.');
    expect(result).not.toContain('## A\n');
  });

  it('strips # markers when replaceHeading is a string with markers', () => {
    const md = '# Doc\n\n## A\n\nContent.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(
      md, tree,
      { type: 'text', text: 'A' },
      'New body.\n',
      '## Renamed Section',
    );
    expect(result).toContain('## Renamed Section');
    expect(result).not.toContain('## ## Renamed Section');
  });
});

describe('replaceSection — blank line between heading and body', () => {
  it('ensures blank line when content has no leading newline', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, 'New content.');
    expect(result).toContain('## A\n\nNew content.');
    expect(result).not.toMatch(/## A\nNew content\./);
  });

  it('normalises multiple leading newlines in content', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, '\n\n\nNew content.');
    expect(result).toContain('## A\n\nNew content.');
    expect(result).not.toContain('## A\n\n\n');
  });

  it('ensures blank line with replaceHeading as string', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, 'Body text.', 'Renamed');
    expect(result).toContain('## Renamed\n\nBody text.');
  });

  it('ensures blank line with replaceHeading=true and no heading in content', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, 'Body only.', true);
    expect(result).toContain('## A\n\nBody only.');
  });
});

describe('appendToSection', () => {
  it('appends content to section body', () => {
    const md = '# Doc\n\n## A\n\nExisting content.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = appendToSection(md, tree, { type: 'text', text: 'A' }, 'Appended line.');
    expect(result).toContain('Existing content.');
    expect(result).toContain('Appended line.');
    // Appended content should be before Section B
    expect(result.indexOf('Appended line.')).toBeLessThan(result.indexOf('## B'));
  });
});

describe('deleteSection', () => {
  it('removes a section and its children', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = deleteSection(md, tree, { type: 'text', text: 'Section Two' });
    expect(result).not.toContain('Section Two');
    expect(result).not.toContain('Subsection 2.1');
    expect(result).not.toContain('Subsection 2.2');
    expect(result).toContain('Section One');
    expect(result).toContain('Section Three');
  });
});

describe('buildOutline', () => {
  it('builds outline for full document', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const outline = buildOutline(md, tree);
    expect(outline.length).toBe(6);
    expect(outline[0].text).toBe('Simple Document');
    expect(outline[0].has_children).toBe(true);
    expect(outline[1].text).toBe('Section One');
    expect(outline[1].has_children).toBe(false);
  });

  it('respects maxDepth', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const outline = buildOutline(md, tree, undefined, 2);
    const texts = outline.map((e) => e.text);
    expect(texts).toContain('Simple Document');
    expect(texts).toContain('Section One');
    expect(texts).not.toContain('Subsection 2.1');
  });

  it('builds outline from a root section', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const outline = buildOutline(md, tree, { type: 'text', text: 'Section Two' });
    expect(outline[0].text).toBe('Section Two');
    expect(outline.length).toBe(3); // Section Two + 2 subsections
  });
});

describe('buildOutline — has_content', () => {
  it('reports has_content=true for sections with body text', () => {
    const md = '# Doc\n\n## A\n\nBody text here.\n\n## B\n\nMore body.\n';
    const tree = parse(md);
    const outline = buildOutline(md, tree);
    const sectionA = outline.find((e) => e.text === 'A');
    expect(sectionA?.has_content).toBe(true);
  });

  it('reports has_content=false for container-only sections', () => {
    const md = '# Doc\n\n## Container\n\n### Child A\n\nContent.\n\n### Child B\n\nContent.\n';
    const tree = parse(md);
    const outline = buildOutline(md, tree);
    const container = outline.find((e) => e.text === 'Container');
    expect(container?.has_content).toBe(false);
  });

  it('reports has_content=true for sections with body and children', () => {
    const md = '# Doc\n\n## Parent\n\nParent body text.\n\n### Child\n\nChild content.\n';
    const tree = parse(md);
    const outline = buildOutline(md, tree);
    const parent = outline.find((e) => e.text === 'Parent');
    expect(parent?.has_content).toBe(true);
    expect(parent?.has_children).toBe(true);
  });
});

describe('findReplace', () => {
  it('finds matches in preview mode', () => {
    const md = '# Doc\n\n## A\n\nHello world. Hello again.\n';
    const tree = parse(md);
    const { matches } = findReplace(md, tree, 'Hello', 'Hi', { preview: true });
    expect(matches.length).toBe(2);
    expect(matches[0].section_path).toContain('A');
  });

  it('replaces all matches', () => {
    const md = '# Doc\n\n## A\n\nHello world. Hello again.\n';
    const tree = parse(md);
    const { result, replacementCount } = findReplace(md, tree, 'Hello', 'Hi');
    expect(result).toContain('Hi world. Hi again.');
    expect(replacementCount).toBe(2);
  });

  it('respects expected_count safety check', () => {
    const md = '# Doc\n\nHello Hello Hello\n';
    const tree = parse(md);
    expect(() =>
      findReplace(md, tree, 'Hello', 'Hi', { expected_count: 2 }),
    ).toThrow('Expected 2 matches but found 3');
  });

  it('applies only selected matches', () => {
    const md = '# Doc\n\nA B A B A\n';
    const tree = parse(md);
    const { result, replacementCount, skippedCount } = findReplace(
      md, tree, 'A', 'X', { apply_matches: [0, 2] },
    );
    expect(result).toContain('X B A B X');
    expect(replacementCount).toBe(2);
    expect(skippedCount).toBe(1);
  });

  it('supports regex mode', () => {
    const md = '# Doc\n\nversion v1.2.3 and v4.5.6\n';
    const tree = parse(md);
    const { matches } = findReplace(md, tree, 'v\\d+\\.\\d+\\.\\d+', '', { regex: true, preview: true });
    expect(matches.length).toBe(2);
  });
});

describe('generateToc', () => {
  it('generates linked TOC', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const toc = generateToc(tree);
    expect(toc).toContain('- [Section One](#section-one)');
    expect(toc).toContain('  - [Subsection 2.1](#subsection-21)');
  });

  it('generates plain TOC', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const toc = generateToc(tree, 3, 'plain');
    expect(toc).toContain('- Section One');
    expect(toc).not.toContain('#');
  });

  it('respects maxDepth', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const toc = generateToc(tree, 1);
    expect(toc).toContain('Section One');
    expect(toc).not.toContain('Subsection');
  });
});

describe('insertSection — duplicate sibling guard', () => {
  it('throws when inserting a duplicate sibling heading', () => {
    const md = '# Doc\n\n## Existing\n\nContent.\n';
    const tree = parse(md);
    expect(() => insertSection(md, tree,
      { type: 'text', text: 'Existing' }, 'after',
      'Existing', 'New content.'
    )).toThrow(/already exists/);
  });

  it('allows inserting a heading that exists under a different parent', () => {
    const md = '# Doc\n\n## Part 1\n\n### Details\n\n## Part 2\n\nContent.\n';
    const tree = parse(md);
    // Inserting "Details" as a child of "Part 2" is fine — different parent
    expect(() => insertSection(md, tree,
      { type: 'text', text: 'Part 2' }, 'child_end',
      'Details', 'More details.'
    )).not.toThrow();
  });

  it('allows inserting a heading with a different name', () => {
    const md = '# Doc\n\n## A\n\nContent.\n';
    const tree = parse(md);
    expect(() => insertSection(md, tree,
      { type: 'text', text: 'A' }, 'after',
      'B', 'Content.'
    )).not.toThrow();
  });
});

describe('appendToSection — heading guard', () => {
  it('rejects content with a same-level heading', () => {
    const md = '# Doc\n\n## Tools\n\nExisting tools.\n';
    const tree = parse(md);
    expect(() => appendToSection(md, tree,
      { type: 'text', text: 'Tools' },
      '## Another Section\n\nContent.\n'
    )).toThrow(/heading/i);
  });

  it('rejects content with a higher-level heading', () => {
    const md = '# Doc\n\n## Tools\n\nExisting tools.\n';
    const tree = parse(md);
    expect(() => appendToSection(md, tree,
      { type: 'text', text: 'Tools' },
      '# Top Level\n\nContent.\n'
    )).toThrow(/heading/i);
  });

  it('allows plain body content without headings', () => {
    const md = '# Doc\n\n## Tools\n\nExisting tools.\n';
    const tree = parse(md);
    const result = appendToSection(md, tree,
      { type: 'text', text: 'Tools' },
      '- New tool item\n- Another item\n'
    );
    expect(result).toContain('New tool item');
    expect(result).toContain('Existing tools.');
  });

  it('allows content with lower-level (child) headings', () => {
    const md = '# Doc\n\n## Tools\n\nExisting tools.\n';
    const tree = parse(md);
    const result = appendToSection(md, tree,
      { type: 'text', text: 'Tools' },
      '### Sub-tool\n\nDetail.\n'
    );
    expect(result).toContain('### Sub-tool');
  });

  it('does not reject headings inside code blocks', () => {
    const md = '# Doc\n\n## Guide\n\nSome guide.\n';
    const tree = parse(md);
    const result = appendToSection(md, tree,
      { type: 'text', text: 'Guide' },
      '```markdown\n## Example Heading\n```\n'
    );
    expect(result).toContain('## Example Heading');
  });

});

describe('replaceSection — auto-strip duplicate heading from content (#27)', () => {
  it('strips leading heading from content when it matches the target section', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' },
      '## A\n\nNew content.\n');
    expect(result).toContain('## A');
    expect(result).toContain('New content.');
    // Should NOT have a duplicate heading
    expect(result).not.toMatch(/## A[\s\S]*## A/);
  });

  it('strips leading heading with different marker level', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    // Agent uses ### instead of ## but same text
    const result = replaceSection(md, tree, { type: 'text', text: 'A' },
      '### A\n\nNew content.\n');
    expect(result).toContain('## A');
    expect(result).toContain('New content.');
    expect(result).not.toMatch(/## A[\s\S]*### A/);
  });

  it('does not strip heading when text differs', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' },
      '### Different Heading\n\nNew content.\n');
    // Different heading text should be kept as body content
    expect(result).toContain('### Different Heading');
  });

  it('strips heading with leading newlines in content', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' },
      '\n\n## A\n\nNew content.\n');
    expect(result).toContain('## A');
    expect(result).toContain('New content.');
    expect(result).not.toMatch(/## A[\s\S]*## A/);
  });

  it('strips heading with trailing ATX closing markers', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' },
      '## A ##\n\nNew content.\n');
    expect(result).toContain('## A');
    expect(result).toContain('New content.');
    expect(result).not.toMatch(/## A[\s\S]*## A/);
  });

  it('strips heading with extra spaces after markers', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' },
      '##  A\n\nNew content.\n');
    expect(result).toContain('## A');
    expect(result).toContain('New content.');
    expect(result).not.toMatch(/## A[\s\S]*## A/);
  });

  it('strips heading at all six ATX levels', () => {
    // Test with a deeply nested h6 section
    const md = '# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F\n\nDeep content.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'F' },
      '###### F\n\nUpdated deep content.\n');
    expect(result).toContain('###### F');
    expect(result).toContain('Updated deep content.');
    const matches = result.match(/###### F/g);
    expect(matches?.length).toBe(1);
  });

  it('handles real-world agent content with heading and body', () => {
    const md = '# WTW\n\n## Operational Excellence & Capabilities\n\n### Digital Transformation Initiatives (2024-2026)\n\nOld data.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree,
      { type: 'text', text: 'Digital Transformation Initiatives (2024-2026)' },
      '### Digital Transformation Initiatives (2024-2026)\n\n**Strategic Investments:**\n- WIRL Platform Enhancement\n- Cloud Migration\n');
    expect(result).toContain('### Digital Transformation Initiatives (2024-2026)');
    expect(result).toContain('Strategic Investments');
    // No duplicate heading
    const matches = result.match(/Digital Transformation Initiatives \(2024-2026\)/g);
    expect(matches?.length).toBe(1);
  });
});

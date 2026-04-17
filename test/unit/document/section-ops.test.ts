// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  moveSection,
  buildOutline,
  findReplace,
  generateToc,
  insertText,
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

describe('buildOutline — word_count', () => {
  it('omits word_count when includeWordCount is not set', () => {
    const md = '# Doc\n\n## A\n\nBody text here.\n';
    const tree = parse(md);
    const outline = buildOutline(md, tree);
    expect(outline[0].word_count).toBeUndefined();
  });

  it('populates word_count when includeWordCount is true', () => {
    const md = '# Doc\n\n## A\n\nBody text here with five words.\n';
    const tree = parse(md);
    const outline = buildOutline(md, tree, undefined, undefined, undefined, true);
    const sectionA = outline.find((e) => e.text === 'A');
    // "A" heading + "Body text here with five words" = 7 words
    expect(sectionA?.word_count).toBe(7);
  });

  it('excludes fenced code blocks from word_count', () => {
    const md = [
      '# Doc',
      '',
      '## A',
      '',
      'Prose one two three.',
      '',
      '```js',
      'const lots = of.code().tokens();',
      '```',
      '',
      'After prose.',
    ].join('\n');
    const tree = parse(md);
    const outline = buildOutline(md, tree, undefined, undefined, undefined, true);
    const sectionA = outline.find((e) => e.text === 'A');
    // "A" + "Prose one two three" + "After prose" = 7 words
    expect(sectionA?.word_count).toBe(7);
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

describe('replaceSection — body-only replace duplicates child sections (#29)', () => {
  const fixtureName = 'financial-performance.md';
  let originalMd: string;

  beforeEach(() => {
    originalMd = loadFixture(fixtureName);
  });

  afterEach(() => {
    // Verify the fixture file is unchanged (replaceSection is pure — returns a new string)
    const current = loadFixture(fixtureName);
    expect(current).toBe(originalMd);
  });

  it('body-only replace with subsection headings should not duplicate existing children', () => {
    const tree = parse(originalMd);

    // This is what an agent does: reads the section, rewrites it with updated subsections
    const agentContent =
      '### Financial Summary\n' +
      '| Metric | 2023 | 2024 |\n' +
      '|--------|------|------|\n' +
      '| **Revenue** | ~$10M | $850M |\n\n' +
      '### Funding History\n' +
      '| Round | Date | Amount |\n' +
      '|-------|------|--------|\n' +
      '| Series A | Dec 2021 | $30M |\n\n' +
      '### Key Financial Observations\n' +
      '1. Unprecedented growth velocity.\n';

    const result = replaceSection(
      originalMd,
      tree,
      { type: 'text', text: 'Financial Performance' },
      agentContent,
    );

    // The original children should NOT survive alongside the new content
    const financialSummaryCount = (result.match(/### Financial Summary/g) || []).length;
    expect(financialSummaryCount).toBe(1);

    // Original child "Trend Analysis" should be gone — agent didn't include it
    expect(result).not.toContain('### Trend Analysis');

    // Original child "Peer Benchmarking" should be gone
    expect(result).not.toContain('### Peer Benchmarking');

    // Original child "So What" should be gone
    expect(result).not.toContain('### So What');

    // New content should be present
    expect(result).toContain('### Funding History');
    expect(result).toContain('### Key Financial Observations');

    // Sibling sections should be unaffected
    expect(result).toContain('## Executive Summary');
    expect(result).toContain('## Strategic Outlook');
  });

  it('body-only replace with no subsection headings should leave children intact', () => {
    const tree = parse(originalMd);

    // Agent sends plain body text — no subsection headings
    const result = replaceSection(
      originalMd,
      tree,
      { type: 'text', text: 'Financial Performance' },
      'Updated intro paragraph for the financial section.\n',
    );

    // Children should still be there since we only replaced the body
    expect(result).toContain('### Financial Summary');
    expect(result).toContain('### Trend Analysis');
    expect(result).toContain('### Peer Benchmarking');
    expect(result).toContain('### So What');
    expect(result).toContain('Updated intro paragraph');
  });

  it('partial child replacement: a,b,c → b,c,d removes a and appends d', () => {
    // Fixture has children: Financial Summary (a), Trend Analysis (b),
    // Peer Benchmarking (c), So What (d) — agent drops first, keeps middle two, adds new
    const tree = parse(originalMd);

    const agentContent =
      '### Trend Analysis\n' +
      'Updated trend analysis content.\n\n' +
      '### Peer Benchmarking\n' +
      'Updated benchmarking content.\n\n' +
      '### Risk Assessment\n' +
      'New risk section added by agent.\n';

    const result = replaceSection(
      originalMd,
      tree,
      { type: 'text', text: 'Financial Performance' },
      agentContent,
    );

    // Dropped child should be gone
    expect(result).not.toContain('### Financial Summary');
    // Kept children should appear exactly once with updated content
    expect((result.match(/### Trend Analysis/g) || []).length).toBe(1);
    expect(result).toContain('Updated trend analysis content.');
    expect((result.match(/### Peer Benchmarking/g) || []).length).toBe(1);
    expect(result).toContain('Updated benchmarking content.');
    // Original "So What" should be gone (agent omitted it)
    expect(result).not.toContain('### So What');
    // New child should be present
    expect(result).toContain('### Risk Assessment');
    expect(result).toContain('New risk section added by agent.');

    // Siblings unaffected
    expect(result).toContain('## Executive Summary');
    expect(result).toContain('## Strategic Outlook');
  });

  it('handles deeply nested children (3+ levels)', () => {
    const md =
      '# Report\n\n' +
      '## Analysis\n\n' +
      '### Overview\n\n' +
      'Intro text.\n\n' +
      '#### Subsection A\n\n' +
      'Detail A.\n\n' +
      '##### Deep Detail A1\n\n' +
      'Very deep content.\n\n' +
      '#### Subsection B\n\n' +
      'Detail B.\n\n' +
      '### Conclusion\n\n' +
      'Wrapping up.\n\n' +
      '## Appendix\n\n' +
      'References.\n';

    const tree = parse(md);

    const agentContent =
      '#### Subsection X\n\n' +
      'Replaced detail X.\n\n' +
      '##### Deep Detail X1\n\n' +
      'New deep content.\n\n' +
      '##### Deep Detail X2\n\n' +
      'Another deep section.\n\n' +
      '#### Subsection Y\n\n' +
      'Replaced detail Y.\n';

    const result = replaceSection(
      md,
      tree,
      { type: 'text', text: 'Overview' },
      agentContent,
    );

    // Original deep children should be gone
    expect(result).not.toContain('#### Subsection A');
    expect(result).not.toContain('##### Deep Detail A1');
    expect(result).not.toContain('#### Subsection B');

    // New deep children should be present
    expect(result).toContain('#### Subsection X');
    expect(result).toContain('##### Deep Detail X1');
    expect(result).toContain('##### Deep Detail X2');
    expect(result).toContain('#### Subsection Y');

    // Sibling "Conclusion" and parent-sibling "Appendix" unaffected
    expect(result).toContain('### Conclusion');
    expect(result).toContain('Wrapping up.');
    expect(result).toContain('## Appendix');
    expect(result).toContain('References.');
  });

  it('ignores child-level headings inside fenced code blocks', () => {
    const tree = parse(originalMd);

    // Content has a ### heading only inside a code block — not a real child heading
    const agentContent =
      'Here is an example:\n\n' +
      '```markdown\n' +
      '### Example Heading\n' +
      'This is just a code sample.\n' +
      '```\n';

    const result = replaceSection(
      originalMd,
      tree,
      { type: 'text', text: 'Financial Performance' },
      agentContent,
    );

    // Children should be preserved — the heading was inside a code block
    expect(result).toContain('### Financial Summary');
    expect(result).toContain('### Trend Analysis');
    expect(result).toContain('Here is an example:');
  });
});

describe('moveSection', () => {
  it('moves a sibling after the last sibling (A,B,C -> B,C,A)', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n\n## C\n\nContent C.\n';
    const tree = parse(md);
    const result = moveSection(md, tree, { type: 'text', text: 'A' }, { type: 'text', text: 'C' }, 'after');
    expect(result.indexOf('## B')).toBeLessThan(result.indexOf('## C'));
    expect(result.indexOf('## C')).toBeLessThan(result.indexOf('## A'));
    expect(result).toContain('Content A.');
    expect(result).toContain('Content B.');
    expect(result).toContain('Content C.');
  });

  it('moves a sibling before the first sibling (A,B,C -> C,A,B)', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n\n## C\n\nContent C.\n';
    const tree = parse(md);
    const result = moveSection(md, tree, { type: 'text', text: 'C' }, { type: 'text', text: 'A' }, 'before');
    expect(result.indexOf('## C')).toBeLessThan(result.indexOf('## A'));
    expect(result.indexOf('## A')).toBeLessThan(result.indexOf('## B'));
    expect(result).toContain('Content A.');
    expect(result).toContain('Content C.');
  });

  it('moves a section with children', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    // Move Section Two (has Subsection 2.1 and 2.2) after Section Three
    const result = moveSection(md, tree,
      { type: 'text', text: 'Section Two' },
      { type: 'text', text: 'Section Three' },
      'after',
    );
    expect(result.indexOf('## Section One')).toBeLessThan(result.indexOf('## Section Three'));
    expect(result.indexOf('## Section Three')).toBeLessThan(result.indexOf('## Section Two'));
    // Children follow the moved section
    expect(result.indexOf('## Section Two')).toBeLessThan(result.indexOf('### Subsection 2.1'));
    expect(result.indexOf('### Subsection 2.1')).toBeLessThan(result.indexOf('### Subsection 2.2'));
    // All content preserved
    expect(result).toContain('Content of section one.');
    expect(result).toContain('Content of section two.');
    expect(result).toContain('Final section content.');
  });

  it('adjusts level when moving to child_end (h2 becomes h3)', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = moveSection(md, tree, { type: 'text', text: 'B' }, { type: 'text', text: 'A' }, 'child_end');
    expect(result).toContain('### B');
    expect(result).not.toMatch(/^## B/m);
    expect(result).toContain('Content B.');
  });

  it('cascades level adjustment to nested children', () => {
    const md = '# Doc\n\n## Parent\n\n### Child\n\n#### Grandchild\n\nDeep content.\n\n## Target\n\nTarget content.\n';
    const tree = parse(md);
    // Move Parent (h2, with h3 Child and h4 Grandchild) to child_end of Target (h2)
    // Parent h2->h3, Child h3->h4, Grandchild h4->h5
    const result = moveSection(md, tree,
      { type: 'text', text: 'Parent' },
      { type: 'text', text: 'Target' },
      'child_end',
    );
    expect(result).toContain('### Parent');
    expect(result).toContain('#### Child');
    expect(result).toContain('##### Grandchild');
    expect(result).not.toMatch(/^## Parent/m);
    expect(result).not.toMatch(/^### Child/m);
    expect(result).toContain('Deep content.');
    expect(result).toContain('Target content.');
  });

  it('promotes child to top-level sibling (h3 -> h2)', () => {
    const md = '# Doc\n\n## A\n\n### Sub\n\nSub content.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = moveSection(md, tree,
      { type: 'text', text: 'Sub' },
      { type: 'text', text: 'B' },
      'after',
    );
    expect(result).toContain('## Sub');
    expect(result).not.toMatch(/### Sub/);
    expect(result).toContain('Sub content.');
    expect(result.indexOf('## B')).toBeLessThan(result.indexOf('## Sub'));
  });

  it('throws on duplicate sibling at destination', () => {
    const md = '# Doc\n\n## A\n\n### X\n\nContent.\n\n## B\n\n### X\n\nOther content.\n';
    const tree = parse(md);
    expect(() => moveSection(md, tree,
      { type: 'path', segments: ['A', 'X'] },
      { type: 'text', text: 'B' },
      'child_end',
    )).toThrow(/already exists/);
  });

  it('throws on self-move', () => {
    const md = '# Doc\n\n## A\n\nContent.\n\n## B\n\nContent.\n';
    const tree = parse(md);
    expect(() => moveSection(md, tree,
      { type: 'text', text: 'A' },
      { type: 'text', text: 'A' },
      'after',
    )).toThrow();
  });

  it('throws when moving into own descendant', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    expect(() => moveSection(md, tree,
      { type: 'text', text: 'Section Two' },
      { type: 'text', text: 'Subsection 2.1' },
      'child_end',
    )).toThrow();
  });

  it('throws when level adjustment would exceed h6', () => {
    const md = '# Doc\n\n## A\n\n### B\n\n#### C\n\n##### D\n\n###### E\n\nDeep.\n\n## Target\n\nContent.\n';
    const tree = parse(md);
    // Moving A (h2, with children down to h6) to child_end of Target (h2)
    // would make A->h3, B->h4, C->h5, D->h6, E->h7 (invalid)
    expect(() => moveSection(md, tree,
      { type: 'text', text: 'A' },
      { type: 'text', text: 'Target' },
      'child_end',
    )).toThrow();
  });
});

describe('insertText', () => {
  const md = [
    '# Doc',
    '',
    '## Section A',
    '',
    'First paragraph of section A.',
    '',
    'Second paragraph of section A.',
    '',
    '## Section B',
    '',
    'First paragraph of section B.',
    '',
    'Taken together, these observations matter.',
    '',
  ].join('\n');

  it('inserts after a unique anchor at the end of a paragraph', () => {
    const tree = parse(md);
    const result = insertText(md, tree, 'First paragraph of section A.', 'after', 'New paragraph inserted after.');
    expect(result.result).toContain('First paragraph of section A.\n\nNew paragraph inserted after.');
    // Original content after the insertion point is preserved
    expect(result.result).toContain('Second paragraph of section A.');
  });

  it('inserts before a unique anchor at the start of a paragraph', () => {
    const tree = parse(md);
    const result = insertText(md, tree, 'Taken together, these observations matter.', 'before', 'New preceding paragraph.');
    expect(result.result).toContain('New preceding paragraph.\n\nTaken together, these observations matter.');
  });

  it('reports the section path of the insertion point', () => {
    const tree = parse(md);
    const result = insertText(md, tree, 'First paragraph of section A.', 'after', 'Addendum.');
    expect(result.sectionPath).toContain('Section A');
  });

  it('reports the line number of the anchor', () => {
    const tree = parse(md);
    const result = insertText(md, tree, 'First paragraph of section A.', 'after', 'Addendum.');
    expect(result.line).toBeGreaterThan(0);
  });

  it('throws when the anchor is not found', () => {
    const tree = parse(md);
    expect(() => insertText(md, tree, 'does not exist in document', 'after', 'x')).toThrow(/not found/i);
  });

  it('throws when the anchor is ambiguous, listing each candidate', () => {
    const ambiguousMd = [
      '# Doc',
      '',
      '## Section A',
      '',
      'The quick brown fox.',
      '',
      '## Section B',
      '',
      'The quick brown fox.',
      '',
    ].join('\n');
    const tree = parse(ambiguousMd);
    let err: Error | undefined;
    try {
      insertText(ambiguousMd, tree, 'The quick brown fox.', 'after', 'x');
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/ambiguous|multiple|2 matches/i);
    // Error should include both section paths so the agent can disambiguate
    expect(err!.message).toContain('Section A');
    expect(err!.message).toContain('Section B');
  });

  it('normalises adjacent blank lines so insertion does not create triple newlines', () => {
    const tree = parse(md);
    const result = insertText(md, tree, 'First paragraph of section A.', 'after', 'Addendum.');
    expect(result.result).not.toMatch(/\n\n\n/);
  });

  it('preserves content outside the insertion point', () => {
    const tree = parse(md);
    const result = insertText(md, tree, 'First paragraph of section A.', 'after', 'Addendum.');
    expect(result.result).toContain('# Doc');
    expect(result.result).toContain('## Section B');
    expect(result.result).toContain('Taken together, these observations matter.');
  });

  it('handles an anchor that is a short phrase at a paragraph boundary', () => {
    const tree = parse(md);
    // "Taken together" is short but still unique in this doc
    const result = insertText(md, tree, 'Taken together', 'before', 'Short-anchor inserted paragraph.');
    expect(result.result).toContain('Short-anchor inserted paragraph.\n\nTaken together');
  });

  it('trims leading/trailing whitespace from content before splicing', () => {
    const tree = parse(md);
    const result = insertText(md, tree, 'First paragraph of section A.', 'after', '\n\n  Trimmed content.  \n\n');
    // Should not produce quadruple newlines or leading spaces in the result
    expect(result.result).toContain('First paragraph of section A.\n\nTrimmed content.\n\nSecond paragraph of section A.');
    expect(result.result).not.toMatch(/\n\n\n/);
  });
});

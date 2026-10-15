// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import '../../../src/parsers/markdown-parser.js';
import { ValidationError, AddressResolutionError } from '@nullproof-studio/en-core';
import { readTable, applyTableOps } from '../../../src/tables/table-ops.js';
import type { TableOp } from '../../../src/tables/table-ops.js';

/**
 * #155 — markdown table rows as records. Rows are keyed by header text,
 * selected SQL-style (`where`) or by position (`row`), and edited in
 * batches of insert / update / delete ops.
 */

const DOC = `# Specs

Intro text.

## Spec Index

Some prose before.

| ID | Title | Status |
|----|-------|--------|
| RFC-1 | Alpha | Draft |
| RFC-2 | Beta | Accepted |

Prose after.

### Notes

| Note |
|------|
| child table |

## Changelog

| Date | Change |
| --- | --- |
| 2026-10-01 | First |
`;

const ALIGNED = `# Doc

## Index

| ID    | Title | Status |
| :---- | ----- | -----: |
| RFC-1 | Alpha |  Draft |
`;

const apply = (content: string, section: string, ops: TableOp[], table?: number) =>
  applyTableOps(content, section, ops, table);

/** Run `fn`, expecting a ValidationError, and return its message. */
function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as Error).message;
  }
  throw new Error('expected a ValidationError');
}

describe('readTable', () => {
  it('returns rows as records keyed by header text, with markdown-source values', () => {
    const doc = '## S\n\n| **ID** | Code |\n|---|---|\n| A | `x` |\n';
    const t = readTable(doc, 'S');
    expect(t.columns).toEqual(['ID', 'Code']);
    expect(t.rows).toEqual([{ ID: 'A', Code: '`x`' }]);
    expect(t.row_numbers).toEqual([0]);
    expect(t.row_count).toBe(1);
    expect(t.table_index).toBe(0);
  });

  it('reports column alignment', () => {
    expect(readTable(ALIGNED, 'Index').align).toEqual(['left', null, 'right']);
  });

  it('pads short rows and ignores cells beyond the header, as GFM renders them', () => {
    const doc = '## S\n\n| A | B |\n|---|---|\n| 1 |\n| 2 | 3 | extra |\n';
    expect(readTable(doc, 'S').rows).toEqual([{ A: '1', B: '' }, { A: '2', B: '3' }]);
  });

  it('filters with where (markdown source or plain text) and projects columns', () => {
    const doc = '## S\n\n| ID | Title |\n|---|---|\n| 1 | **Bold** |\n| 2 | plain |\n| 3 | **Bold** |\n';
    const bySource = readTable(doc, 'S', { where: { Title: '**Bold**' }, columns: ['ID'] });
    expect(bySource.rows).toEqual([{ ID: '1' }, { ID: '3' }]);
    expect(bySource.row_numbers).toEqual([0, 2]);
    expect(bySource.row_count).toBe(3);
    expect(readTable(doc, 'S', { where: { Title: 'Bold' } }).row_numbers).toEqual([0, 2]);
  });

  it('matches escaped pipes by their rendered text', () => {
    const doc = '## S\n\n| K | V |\n|---|---|\n| k | a \\| b |\n';
    const t = readTable(doc, 'S', { where: { V: 'a | b' } });
    expect(t.rows).toEqual([{ K: 'k', V: 'a \\| b' }]);
  });

  it('selects by position, with negative positions counting from the end', () => {
    expect(readTable(DOC, 'Spec Index', { row: 1 }).rows[0].ID).toBe('RFC-2');
    expect(readTable(DOC, 'Spec Index', { row: -1 }).row_numbers).toEqual([1]);
    expect(errorOf(() => readTable(DOC, 'Spec Index', { row: 5 }))).toMatch(/out of range.*2 rows/);
  });

  it('rejects where and row together', () => {
    expect(errorOf(() => readTable(DOC, 'Spec Index', { row: 0, where: { ID: 'RFC-1' } })))
      .toMatch(/either where or row/i);
  });

  it('matches column names exactly, then case-insensitively; unknown names suggest the closest', () => {
    expect(readTable(DOC, 'Spec Index', { where: { status: 'Draft' } }).row_numbers).toEqual([0]);
    expect(errorOf(() => readTable(DOC, 'Spec Index', { columns: ['Stauts'] })))
      .toMatch(/Unknown column "Stauts".*Status/);
  });

  it('fails on duplicate header names', () => {
    const doc = '## S\n\n| A | A |\n|---|---|\n| 1 | 2 |\n';
    expect(errorOf(() => readTable(doc, 'S'))).toMatch(/Duplicate column "A"/);
  });

  it('counts only tables in the section\'s own body, not its subsections', () => {
    expect(readTable(DOC, 'Spec Index').columns).toEqual(['ID', 'Title', 'Status']);
    expect(readTable(DOC, 'Notes').columns).toEqual(['Note']);
  });

  it('requires table when a section has several, listing each header row', () => {
    const doc = '## S\n\n| A |\n|---|\n| 1 |\n\n| B | C |\n|---|---|\n| 2 | 3 |\n';
    const msg = errorOf(() => readTable(doc, 'S'));
    expect(msg).toMatch(/2 tables/);
    expect(msg).toContain('[0] A');
    expect(msg).toContain('[1] B | C');
    expect(readTable(doc, 'S', { table: 1 }).columns).toEqual(['B', 'C']);
    expect(errorOf(() => readTable(doc, 'S', { table: 2 }))).toMatch(/no table 2/i);
  });

  it('explains a section with no table, and tables nested in a blockquote', () => {
    expect(errorOf(() => readTable(DOC, 'Specs'))).toMatch(/No table in section "Specs".*doc_append_section/);
    const quoted = '## S\n\n> | A |\n> |---|\n> | 1 |\n';
    expect(errorOf(() => readTable(quoted, 'S'))).toMatch(/blockquote or list.*not supported/);
  });

  it('fails cleanly for an unknown section', () => {
    expect(() => readTable(DOC, 'Nope')).toThrow(AddressResolutionError);
  });
});

describe('insert', () => {
  it('appends a compact row and leaves every other byte unchanged', () => {
    const { content, affected } = apply(DOC, 'Spec Index', [
      { op: 'insert', rows: [{ ID: 'RFC-3', Title: 'Gamma', Status: 'Draft' }] },
    ]);
    expect(affected).toEqual([1]);
    expect(content).toBe(DOC.replace(
      '| RFC-2 | Beta | Accepted |\n',
      '| RFC-2 | Beta | Accepted |\n| RFC-3 | Gamma | Draft |\n',
    ));
  });

  it('writes empty cells for columns the record leaves out', () => {
    const { content } = apply(DOC, 'Spec Index', [{ op: 'insert', rows: [{ ID: 'RFC-3' }] }]);
    expect(content).toContain('| RFC-3 |  |  |\n');
  });

  it('inserts at the start, for newest-first logs', () => {
    const { content } = apply(DOC, 'Changelog', [
      { op: 'insert', position: 'start', rows: [{ Date: '2026-10-15', Change: 'Newest' }] },
    ]);
    expect(content).toContain('| --- | --- |\n| 2026-10-15 | Newest |\n| 2026-10-01 | First |\n');
  });

  it('inserts several rows in order', () => {
    const { content, affected } = apply(DOC, 'Changelog', [
      { op: 'insert', rows: [{ Date: 'd1', Change: 'one' }, { Date: 'd2', Change: 'two' }] },
    ]);
    expect(affected).toEqual([2]);
    expect(content).toContain('| 2026-10-01 | First |\n| d1 | one |\n| d2 | two |\n');
  });

  it('inserts before or after a row picked by where or by position', () => {
    const after = apply(DOC, 'Spec Index', [
      { op: 'insert', position: 'after', where: { ID: 'RFC-1' }, rows: [{ ID: 'RFC-1a' }] },
    ]).content;
    expect(after).toContain('| RFC-1 | Alpha | Draft |\n| RFC-1a |  |  |\n| RFC-2 |');
    const before = apply(DOC, 'Spec Index', [
      { op: 'insert', position: 'before', row: 0, rows: [{ ID: 'RFC-0' }] },
    ]).content;
    expect(before).toContain('|--------|\n| RFC-0 |  |  |\n| RFC-1 |');
  });

  it('requires exactly one anchor row for before/after, and none for start/end', () => {
    expect(errorOf(() => apply(DOC, 'Spec Index', [
      { op: 'insert', position: 'after', where: { Status: 'Nope' }, rows: [{ ID: 'x' }] },
    ]))).toMatch(/ops\[0\] \(insert\).*no row matches/i);
    expect(errorOf(() => apply(DOC, 'Spec Index', [
      { op: 'insert', position: 'after', rows: [{ ID: 'x' }] },
    ]))).toMatch(/needs a row to insert next to/i);
    expect(errorOf(() => apply(DOC, 'Spec Index', [
      { op: 'insert', position: 'end', where: { ID: 'RFC-1' }, rows: [{ ID: 'x' }] },
    ]))).toMatch(/only used with position "before" or "after"/);
  });

  it('escapes pipes in values, without double-escaping ones already escaped', () => {
    const { content } = apply(DOC, 'Changelog', [
      { op: 'insert', rows: [{ Date: 'a | b', Change: 'x \\| y' }] },
    ]);
    expect(content).toContain('| a \\| b | x \\| y |\n');
    expect(readTable(content, 'Changelog', { row: -1 }).rows[0]).toEqual({ Date: 'a \\| b', Change: 'x \\| y' });
  });

  it('rejects newlines in values, pointing at <br>', () => {
    expect(errorOf(() => apply(DOC, 'Changelog', [
      { op: 'insert', rows: [{ Date: 'd', Change: 'two\nlines' }] },
    ]))).toMatch(/Change.*newline.*<br>/);
  });

  it('accepts numbers, booleans and null as cell values', () => {
    const { content } = apply(DOC, 'Spec Index', [
      { op: 'insert', rows: [{ ID: 7, Title: true, Status: null }] },
    ]);
    expect(content).toContain('| 7 | true |  |\n');
  });

  it('rejects unknown columns and never adds one', () => {
    expect(errorOf(() => apply(DOC, 'Spec Index', [
      { op: 'insert', rows: [{ ID: 'x', Owner: 'me' }] },
    ]))).toMatch(/Unknown column "Owner".*ID, Title, Status/);
  });

  it('inserts into a table with only a header row', () => {
    const doc = '## S\n\n| A | B |\n|---|---|\n\nAfter.\n';
    expect(apply(doc, 'S', [{ op: 'insert', rows: [{ A: '1', B: '2' }] }]).content)
      .toBe('## S\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nAfter.\n');
  });

  it('keeps a table\'s pipe style when it has no outer pipes', () => {
    const doc = '## S\n\nA | B\n--- | ---\n1 | 2\n';
    expect(apply(doc, 'S', [{ op: 'insert', rows: [{ A: '3', B: '4' }] }]).content)
      .toBe('## S\n\nA | B\n--- | ---\n1 | 2\n3 | 4\n');
  });

  it('adds an outer pipe when a row without them would start with an empty cell', () => {
    const doc = '## S\n\nA | B\n--- | ---\n1 | 2\n';
    const { content } = apply(doc, 'S', [{ op: 'insert', rows: [{ B: '4' }] }]);
    expect(readTable(content, 'S', { row: -1 }).rows[0]).toEqual({ A: '', B: '4' });
  });

  it('keeps a table\'s indentation', () => {
    const doc = '## S\n\n  | A | B |\n  |---|---|\n  | 1 | 2 |\n';
    expect(apply(doc, 'S', [{ op: 'insert', rows: [{ A: '3', B: '4' }] }]).content)
      .toBe('## S\n\n  | A | B |\n  |---|---|\n  | 1 | 2 |\n  | 3 | 4 |\n');
  });

  it('works on the last table in a file with no trailing newline', () => {
    const doc = '## S\n\n| A |\n|---|\n| 1 |';
    expect(apply(doc, 'S', [{ op: 'insert', rows: [{ A: '2' }] }]).content).toBe('## S\n\n| A |\n|---|\n| 1 |\n| 2 |');
  });
});

describe('aligned tables', () => {
  it('realigns the whole table, Prettier-style, when a wider value arrives', () => {
    const { content } = apply(ALIGNED, 'Index', [
      { op: 'insert', rows: [{ ID: 'RFC-10', Title: 'Gamma', Status: 'Accepted' }] },
    ]);
    expect(content).toBe(`# Doc

## Index

| ID     | Title |   Status |
| :----- | ----- | -------: |
| RFC-1  | Alpha |    Draft |
| RFC-10 | Gamma | Accepted |
`);
  });

  it('leaves existing lines untouched when the new value fits', () => {
    const { content } = apply(ALIGNED, 'Index', [
      { op: 'insert', rows: [{ ID: 'RFC-2', Title: 'Beta', Status: 'Done' }] },
    ]);
    expect(content).toBe(`${ALIGNED}| RFC-2 | Beta  |   Done |\n`);
  });

  it('keeps a dash-filled delimiter (|-----|) dash-filled when realigning', () => {
    const doc = '## S\n\n| ID    | Title |\n|-------|-------|\n| RFC-1 | Alpha |\n';
    const { content } = apply(doc, 'S', [{ op: 'insert', rows: [{ ID: 'RFC-100', Title: 'Beta' }] }]);
    expect(content).toBe('## S\n\n| ID      | Title |\n|---------|-------|\n| RFC-1   | Alpha |\n| RFC-100 | Beta  |\n');
  });

  it('centres centre-aligned columns', () => {
    const doc = '## S\n\n| Name | Mark |\n| ---- | :--: |\n| ab   |  x   |\n';
    const { content } = apply(doc, 'S', [{ op: 'insert', rows: [{ Name: 'abc', Mark: 'yes' }] }]);
    expect(content).toBe('## S\n\n| Name | Mark |\n| ---- | :--: |\n| ab   |  x   |\n| abc  | yes  |\n');
  });
});

describe('update', () => {
  it('changes the cells named in set for the one matching row', () => {
    const { content, affected } = apply(DOC, 'Spec Index', [
      { op: 'update', where: { ID: 'RFC-1' }, set: { Status: 'Accepted' } },
    ]);
    expect(affected).toEqual([1]);
    expect(content).toBe(DOC.replace('| RFC-1 | Alpha | Draft |', '| RFC-1 | Alpha | Accepted |'));
  });

  it('requires exactly one match by default, with hints for recovery', () => {
    const none = errorOf(() => apply(DOC, 'Spec Index', [
      { op: 'update', where: { ID: 'RFC-9' }, set: { Status: 'x' } },
    ]));
    expect(none).toMatch(/ops\[0\] \(update\).*no row matches.*ID.*RFC-1/is);
    const doc = DOC.replace('| RFC-2 | Beta | Accepted |', '| RFC-2 | Beta | Draft |');
    const many = errorOf(() => apply(doc, 'Spec Index', [
      { op: 'update', where: { Status: 'Draft' }, set: { Status: 'x' } },
    ]));
    expect(many).toMatch(/2 rows match.*expected 1.*expected_count/i);
  });

  it('updates several rows when expected_count says so, and checks the count', () => {
    const doc = DOC.replace('| RFC-2 | Beta | Accepted |', '| RFC-2 | Beta | Draft |');
    const { content, affected } = apply(doc, 'Spec Index', [
      { op: 'update', where: { Status: 'Draft' }, set: { Status: 'Final' }, expected_count: 2 },
    ]);
    expect(affected).toEqual([2]);
    expect(readTable(content, 'Spec Index', { where: { Status: 'Final' } }).row_count).toBe(2);
    expect(errorOf(() => apply(doc, 'Spec Index', [
      { op: 'update', where: { Status: 'Draft' }, set: { Status: 'x' }, expected_count: 3 },
    ]))).toMatch(/2 rows match.*expected 3/);
  });

  it('updates by position', () => {
    const { content } = apply(DOC, 'Spec Index', [{ op: 'update', row: -1, set: { Title: 'Bravo' } }]);
    expect(content).toContain('| RFC-2 | Bravo | Accepted |');
  });

  it('pads a short row and drops cells beyond the header when it rewrites one', () => {
    const doc = '## S\n\n| A | B | C |\n|---|---|---|\n| 1 |\n| 2 | x | y | z |\n';
    const { content } = apply(doc, 'S', [
      { op: 'update', row: 0, set: { C: 'c' } },
      { op: 'update', row: 1, set: { A: '3' } },
    ]);
    expect(content).toBe('## S\n\n| A | B | C |\n|---|---|---|\n| 1 |  | c |\n| 3 | x | y |\n');
  });

  it('requires a row selector and something to set', () => {
    expect(errorOf(() => apply(DOC, 'Spec Index', [{ op: 'update', set: { Status: 'x' } } as TableOp])))
      .toMatch(/needs where or row/);
    expect(errorOf(() => apply(DOC, 'Spec Index', [{ op: 'update', row: 0, set: {} }])))
      .toMatch(/set is empty/);
  });
});

describe('delete', () => {
  it('removes the matching row', () => {
    const { content, affected } = apply(DOC, 'Spec Index', [{ op: 'delete', where: { ID: 'RFC-1' } }]);
    expect(affected).toEqual([1]);
    expect(content).toBe(DOC.replace('| RFC-1 | Alpha | Draft |\n', ''));
  });

  it('removes several rows only when expected_count matches', () => {
    const doc = DOC.replace('| RFC-2 | Beta | Accepted |', '| RFC-2 | Beta | Draft |');
    expect(errorOf(() => apply(doc, 'Spec Index', [{ op: 'delete', where: { Status: 'Draft' } }])))
      .toMatch(/2 rows match/);
    const { content } = apply(doc, 'Spec Index', [{ op: 'delete', where: { Status: 'Draft' }, expected_count: 2 }]);
    expect(readTable(content, 'Spec Index').row_count).toBe(0);
  });

  it('removes by position', () => {
    const { content } = apply(DOC, 'Spec Index', [{ op: 'delete', row: 0 }]);
    expect(readTable(content, 'Spec Index').rows.map((r) => r.ID)).toEqual(['RFC-2']);
  });
});

describe('batches', () => {
  it('applies ops in order: later ops see earlier results', () => {
    const { content, affected } = apply(DOC, 'Spec Index', [
      { op: 'insert', rows: [{ ID: '**RFC-3**', Title: 'Gamma', Status: 'Draft' }] },
      { op: 'update', where: { ID: 'RFC-3' }, set: { Status: 'Accepted' } },
      { op: 'delete', where: { ID: 'RFC-1' } },
    ]);
    expect(affected).toEqual([1, 1, 1]);
    expect(readTable(content, 'Spec Index').rows).toEqual([
      { ID: 'RFC-2', Title: 'Beta', Status: 'Accepted' },
      { ID: '**RFC-3**', Title: 'Gamma', Status: 'Accepted' },
    ]);
  });

  it('resolves positions against the table as each op finds it', () => {
    const { content } = apply(DOC, 'Spec Index', [{ op: 'delete', row: 0 }, { op: 'delete', row: 0 }]);
    expect(readTable(content, 'Spec Index').row_count).toBe(0);
  });

  it('is all or nothing, and names the failing op', () => {
    const msg = errorOf(() => apply(DOC, 'Spec Index', [
      { op: 'insert', rows: [{ ID: 'RFC-3' }] },
      { op: 'update', where: { ID: 'RFC-404' }, set: { Status: 'x' } },
    ]));
    expect(msg).toMatch(/^ops\[1\] \(update\)/);
  });

  it('leaves other tables and sections untouched', () => {
    const { content } = apply(DOC, 'Spec Index', [{ op: 'delete', row: 0 }]);
    expect(content).toContain('| Note |\n|------|\n| child table |\n');
    expect(content).toContain('| 2026-10-01 | First |\n');
    expect(content.startsWith('# Specs\n\nIntro text.\n\n## Spec Index\n\nSome prose before.\n\n')).toBe(true);
    expect(content).toContain('\nProse after.\n');
  });

  it('edits the table picked by index', () => {
    const doc = '## S\n\n| A |\n|---|\n| 1 |\n\n| B |\n|---|\n| 2 |\n';
    const { content, table_index } = apply(doc, 'S', [{ op: 'insert', rows: [{ B: '3' }] }], 1);
    expect(table_index).toBe(1);
    expect(content).toBe('## S\n\n| A |\n|---|\n| 1 |\n\n| B |\n|---|\n| 2 |\n| 3 |\n');
  });
});

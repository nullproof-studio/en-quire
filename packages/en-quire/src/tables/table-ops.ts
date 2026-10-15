// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Root, Table, Nodes } from 'mdast';
import {
  parserRegistry, resolveSingleSection, flattenTree, toString, rankByLevenshtein, ValidationError,
} from '@nullproof-studio/en-core';
import type { SectionNode } from '@nullproof-studio/en-core';
import { parseMarkdown } from '../parsers/parser.js';
import { readGfmTable, renderGfmTable, plainText } from './gfm-table.js';
import type { GfmTable, TableRow, Align } from './gfm-table.js';

/**
 * Table rows as records (#155). Rows are keyed by header text and picked
 * SQL-style — `where` (equality on a cell's markdown source or plain text,
 * ANDed across columns) or `row` (zero-based position, negative from the end)
 * — then changed by a batch of insert / update / delete ops applied in order,
 * all or nothing.
 */

export type CellValue = string | number | boolean | null;
export type RowRecord = Record<string, CellValue>;

interface Selector {
  where?: RowRecord;
  row?: number;
}

export type TableOp =
  | ({ op: 'insert'; rows: RowRecord[]; position?: 'start' | 'end' | 'before' | 'after' } & Selector)
  | ({ op: 'update'; set: RowRecord; expected_count?: number } & Selector)
  | ({ op: 'delete'; expected_count?: number } & Selector);

const MARKDOWN = parserRegistry.getParser.bind(parserRegistry, 'table.md');

// --- locating tables -------------------------------------------------------

interface SectionTables {
  label: string;
  tables: Table[];
  /** Tables inside blockquotes or lists — not editable yet. */
  nested: number;
}

function walkTables(node: Nodes, visit: (table: Table, topLevel: boolean) => void, depth = 0): void {
  if (node.type === 'table') {
    visit(node, depth === 1);
    return;
  }
  if ('children' in node) for (const child of node.children) walkTables(child as Nodes, visit, depth + 1);
}

function tablesIn(ast: Root, from: number, to: number): { tables: Table[]; nested: number } {
  const tables: Table[] = [];
  let nested = 0;
  walkTables(ast, (table, topLevel) => {
    const start = table.position!.start.offset!;
    if (start < from || start >= to) return;
    if (topLevel) tables.push(table);
    else nested++;
  });
  return { tables, nested };
}

function sectionTables(content: string, ast: Root, section: string): SectionTables {
  const parser = MARKDOWN();
  const node = resolveSingleSection(parser.parse(content), parser.parseAddress(section));
  return { label: node.heading.text, ...tablesIn(ast, node.bodyStartOffset, node.bodyEndOffset) };
}

const headerOf = (table: Table) => table.children[0].children.map((cell) => toString(cell).trim());

function pickTable(found: SectionTables, index: number | undefined): { table: Table; index: number } {
  const { label, tables, nested } = found;
  const listing = () => tables.map((t, i) => `[${i}] ${headerOf(t).join(' | ')}`).join('; ');
  if (tables.length === 0) {
    throw new ValidationError(nested > 0
      ? `No table in section "${label}" that can be edited: its ${nested === 1 ? 'table is' : `${nested} tables are`} inside a blockquote or list, which is not supported yet.`
      : `No table in section "${label}". To add one, write it with doc_append_section.`);
  }
  if (index === undefined) {
    if (tables.length > 1) {
      throw new ValidationError(`Section "${label}" has ${tables.length} tables — pass table (0–${tables.length - 1}) to pick one: ${listing()}.`);
    }
    return { table: tables[0], index: 0 };
  }
  if (!Number.isInteger(index) || index < 0 || index >= tables.length) {
    throw new ValidationError(`Section "${label}" has no table ${index} — it has ${tables.length}: ${listing()}.`);
  }
  return { table: tables[index], index };
}

function locate(content: string, section: string, table: number | undefined) {
  const ast = parseMarkdown(content);
  const picked = pickTable(sectionTables(content, ast, section), table);
  return { model: readGfmTable(picked.table, content), index: picked.index };
}

// --- columns, values, rows -------------------------------------------------

function columnResolver(t: GfmTable): (name: string) => number {
  const names = t.header.plain;
  const duplicate = (name: string) => new ValidationError(
    `Duplicate column "${name}" — a table with repeated header names can't be addressed by column; rename one header first.`,
  );
  return (name: string) => {
    for (const same of [(n: string) => n === name, (n: string) => n.toLowerCase() === name.toLowerCase()]) {
      const hits = names.flatMap((n, i) => (same(n) ? [i] : []));
      if (hits.length > 1) throw duplicate(names[hits[0]]);
      if (hits.length === 1) return hits[0];
    }
    const near = rankByLevenshtein(name, names, 3);
    throw new ValidationError(
      `Unknown column "${name}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} Columns are: ${names.join(', ')}.`,
    );
  };
}

function assertUniqueColumns(t: GfmTable): void {
  const seen = new Set<string>();
  for (const name of t.header.plain) {
    if (seen.has(name)) columnResolver(t)(name); // throws the duplicate error
    seen.add(name);
  }
}

/** Plain text of one cell's markdown, parsed inline (a bare "1." is not a list). */
function cellPlain(markdown: string): string {
  return markdown ? plainText(`x ${markdown}`).slice(2) : '';
}

function cellSource(column: string, value: CellValue | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[\r\n]/.test(text)) {
    throw new ValidationError(`Value for "${column}" contains a newline — table cells are one line; use <br> for a line break.`);
  }
  return text.trim().replace(/(?<!\\)\|/g, '\\|');
}

const asText = (value: CellValue | undefined) => (value === null || value === undefined ? '' : String(value)).trim();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function selectRows(t: GfmTable, col: (name: string) => number, sel: Selector): number[] | null {
  if (sel.where !== undefined && sel.row !== undefined) {
    throw new ValidationError('Use either where or row to pick rows, not both.');
  }
  if (sel.row !== undefined) {
    const n = t.rows.length;
    const i = sel.row < 0 ? n + sel.row : sel.row;
    if (!Number.isInteger(sel.row) || i < 0 || i >= n) {
      throw new ValidationError(`row ${sel.row} is out of range — the table has ${plural(n, 'row')}${n ? ` (0–${n - 1}, or -1 for the last)` : ''}.`);
    }
    return [i];
  }
  if (sel.where !== undefined) {
    const conditions = Object.entries(sel.where).map(([name, value]) => [col(name), asText(value)] as const);
    return t.rows.flatMap((r, i) => (conditions.every(([c, want]) =>
      (r.cells[c] ?? '') === want || (r.plain[c] ?? '') === want) ? [i] : []));
  }
  return null;
}

function describe(sel: Selector): string {
  return sel.row !== undefined ? `row ${sel.row}` : JSON.stringify(sel.where);
}

/** For a where that matched nothing: the nearest values in its first column. */
function noMatch(t: GfmTable, col: (name: string) => number, sel: Selector): ValidationError {
  const [name, value] = Object.entries(sel.where ?? {})[0] ?? [];
  let hint = t.rows.length === 0 ? ' The table has no rows.' : '';
  if (name !== undefined && t.rows.length > 0) {
    const values = [...new Set(t.rows.map((r) => r.cells[col(name)] ?? '').filter(Boolean))];
    const near = rankByLevenshtein(asText(value), values, 5);
    if (near.length) hint = ` Closest ${name} values: ${near.join(', ')}.`;
  }
  return new ValidationError(`no row matches ${describe(sel)}.${hint}`);
}

function expectRows(
  t: GfmTable, col: (name: string) => number, sel: Selector, matched: number[], expected: number,
): void {
  if (matched.length === 0) throw noMatch(t, col, sel);
  if (matched.length !== expected) {
    throw new ValidationError(
      `${plural(matched.length, 'row')} ${matched.length === 1 ? 'matches' : 'match'} ${describe(sel)}, expected ${expected}. `
      + `Narrow the where, or pass expected_count: ${matched.length} to change all of them.`,
    );
  }
}

function newRow(t: GfmTable, col: (name: string) => number, record: RowRecord): TableRow {
  const cells = t.header.cells.map(() => '');
  for (const [name, value] of Object.entries(record)) cells[col(name)] = cellSource(name, value);
  return { cells, plain: cells.map(cellPlain), line: null };
}

// --- ops -------------------------------------------------------------------

function applyOp(t: GfmTable, op: TableOp): number {
  const col = columnResolver(t);
  const width = t.header.cells.length;

  if (op.op === 'insert') {
    if (!Array.isArray(op.rows) || op.rows.length === 0) {
      throw new ValidationError('rows is empty — pass at least one record to insert.');
    }
    const position = op.position ?? 'end';
    const sel = selectRows(t, col, op);
    let at: number;
    if (position === 'start' || position === 'end') {
      if (sel !== null) throw new ValidationError('where/row is only used with position "before" or "after".');
      at = position === 'start' ? 0 : t.rows.length;
    } else {
      if (sel === null) throw new ValidationError(`position "${position}" needs a row to insert next to — pass where or row.`);
      if (sel.length === 0) throw noMatch(t, col, op);
      if (sel.length > 1) {
        throw new ValidationError(`${sel.length} rows match ${describe(op)} — inserting ${position} a row needs exactly one.`);
      }
      at = position === 'before' ? sel[0] : sel[0] + 1;
    }
    const rows = op.rows.map((record) => newRow(t, col, record));
    t.rows.splice(at, 0, ...rows);
    return rows.length;
  }

  if (op.op === 'update') {
    const changes = Object.entries(op.set ?? {});
    if (changes.length === 0) throw new ValidationError('set is empty — name at least one column to change.');
    const targets = changes.map(([name, value]) => [col(name), cellSource(name, value)] as const);
    const sel = selectRows(t, col, op);
    if (sel === null) throw new ValidationError('update needs where or row to pick the rows to change.');
    expectRows(t, col, op, sel, op.expected_count ?? 1);
    for (const i of sel) {
      const row = t.rows[i];
      const cells = Array.from({ length: width }, (_, c) => row.cells[c] ?? '');
      const plain = Array.from({ length: width }, (_, c) => row.plain[c] ?? '');
      for (const [c, source] of targets) {
        cells[c] = source;
        plain[c] = cellPlain(source);
      }
      t.rows[i] = { cells, plain, line: null };
    }
    return sel.length;
  }

  if (op.op === 'delete') {
    const sel = selectRows(t, col, op);
    if (sel === null) throw new ValidationError('delete needs where or row to pick the rows to delete.');
    expectRows(t, col, op, sel, op.expected_count ?? 1);
    for (const i of [...sel].sort((a, b) => b - a)) t.rows.splice(i, 1);
    return sel.length;
  }

  throw new ValidationError(`Unknown op "${(op as { op: string }).op}" — use insert, update or delete.`);
}

// --- entry points ----------------------------------------------------------

export interface TableReadResult {
  table_index: number;
  columns: string[];
  align: Align[];
  rows: Record<string, string>[];
  row_numbers: number[];
  row_count: number;
}

/** Read one table in a section as records, optionally filtered and projected. */
export function readTable(
  content: string,
  section: string,
  opts: { table?: number; where?: RowRecord; row?: number; columns?: string[] } = {},
): TableReadResult {
  const { model: t, index } = locate(content, section, opts.table);
  assertUniqueColumns(t);
  const col = columnResolver(t);
  const rowNumbers = selectRows(t, col, opts) ?? t.rows.map((_, i) => i);
  const columns = opts.columns ? opts.columns.map(col) : t.header.plain.map((_, i) => i);
  return {
    table_index: index,
    columns: t.header.plain,
    align: t.align,
    rows: rowNumbers.map((i) => Object.fromEntries(columns.map((c) => [t.header.plain[c], t.rows[i].cells[c] ?? '']))),
    row_numbers: rowNumbers,
    row_count: t.rows.length,
  };
}

/** Apply a batch of row ops to one table in a section; all or nothing. */
export function applyTableOps(
  content: string,
  section: string,
  ops: TableOp[],
  table?: number,
): { content: string; table_index: number; affected: number[] } {
  const { model: t, index } = locate(content, section, table);
  const affected = ops.map((op, i) => {
    try {
      return applyOp(t, op);
    } catch (err) {
      if (err instanceof ValidationError) throw new ValidationError(`ops[${i}] (${op.op}): ${err.message}`);
      throw err;
    }
  });
  return {
    content: content.slice(0, t.start) + renderGfmTable(t) + content.slice(t.end),
    table_index: index,
    affected,
  };
}

export interface TableSummary {
  index: number;
  columns: string[];
  rows: number;
}

/** Each section's editable tables, keyed by the section's heading line — for doc_outline. */
export function tablesBySection(content: string, tree: SectionNode[]): Map<number, TableSummary[]> {
  const ast = parseMarkdown(content);
  const out = new Map<number, TableSummary[]>();
  for (const node of flattenTree(tree)) {
    const { tables } = tablesIn(ast, node.bodyStartOffset, node.bodyEndOffset);
    if (tables.length === 0) continue;
    out.set(node.heading.position.start.line, tables.map((t, index) => ({
      index, columns: headerOf(t), rows: t.children.length - 1,
    })));
  }
  return out;
}

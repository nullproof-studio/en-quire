// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Table } from 'mdast';
import { toString, ValidationError } from '@nullproof-studio/en-core';
import { parseMarkdown } from '../parsers/parser.js';

/**
 * A GFM table as editable lines (#155). The mdast node locates the table and
 * supplies alignment and each cell's plain text; the lines themselves are
 * split here, so a row nobody edits is re-emitted byte for byte.
 */

export type Align = 'left' | 'right' | 'center' | null;

export interface TableRow {
  /** Cell markdown source, trimmed, `\|` kept as written. */
  cells: string[];
  /** Cell plain text (formatting stripped, `\|` unescaped) — what `where` also matches. */
  plain: string[];
  /** The original line, or null once the row has been edited or inserted. */
  line: string | null;
}

export interface GfmTable {
  /** Offset of the first line's start, and of the last line's end (exclusive, before its newline). */
  start: number;
  end: number;
  header: TableRow;
  delimiter: string;
  align: Align[];
  rows: TableRow[];
  style: {
    indent: string;
    outerPipes: boolean;
    /** Column-aligned: pipes line up and some cell carries alignment padding. */
    aligned: boolean;
    /** Delimiter cells written `| --- |` (Prettier) rather than `|-----|`. */
    spacedDelimiter: boolean;
  };
}

interface SplitLine {
  segments: string[];
  pipes: number[];
  outer: boolean;
}

/**
 * Split a table line on unescaped pipes. GFM requires `\|` for a literal pipe
 * even inside code spans, so backslash escapes are the only thing to honour.
 */
function splitLine(line: string): SplitLine {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
      continue;
    }
    if (line[i] === '|') pipes.push(i);
  }
  const start = line.length - line.trimStart().length;
  const end = line.trimEnd().length;
  const lead = pipes[0] === start;
  const trail = pipes.length > (lead ? 1 : 0) && pipes[pipes.length - 1] === end - 1;
  const inner = pipes.filter((p, i) => !(lead && i === 0) && !(trail && i === pipes.length - 1));
  const bounds = [lead ? start : start - 1, ...inner, trail ? end - 1 : end];
  const segments: string[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) segments.push(line.slice(bounds[k] + 1, bounds[k + 1]));
  return { segments, pipes, outer: lead };
}

const width = (s: string) => [...s].length;

export function plainText(markdown: string): string {
  return toString(parseMarkdown(markdown)).trim();
}

/** Build the editable model of one top-level mdast table. */
export function readGfmTable(node: Table, content: string): GfmTable {
  const nodeStart = node.position!.start.offset!;
  const start = content.lastIndexOf('\n', nodeStart - 1) + 1;
  const end = node.position!.end.offset!;
  const lines = content.slice(start, end).split('\n');
  if (lines.length !== node.children.length + 1) {
    throw new ValidationError('This table\'s layout could not be read as one row per line; edit it with doc_find_replace.');
  }

  const split = lines.map(splitLine);
  const toRow = (lineIndex: number, rowIndex: number): TableRow => ({
    cells: split[lineIndex].segments.map((s) => s.trim()),
    plain: node.children[rowIndex].children.map((cell) => toString(cell).trim()),
    line: lines[lineIndex],
  });

  const pipeKey = (s: SplitLine) => s.pipes.join(',');
  const pipesLineUp = split.every((s) => pipeKey(s) === pipeKey(split[0]));
  const padded = split.some((s, i) => i !== 1 && s.segments.some((seg) => /^ {2,}| {2,}$/.test(seg)));

  return {
    start,
    end,
    header: toRow(0, 0),
    delimiter: lines[1],
    align: node.children[0].children.map((_, c) => node.align?.[c] ?? null),
    rows: lines.slice(2).map((_, i) => toRow(i + 2, i + 1)),
    style: {
      indent: lines[0].slice(0, lines[0].length - lines[0].trimStart().length),
      outerPipes: split[0].outer,
      aligned: pipesLineUp && padded,
      spacedDelimiter: split[1].segments.every((seg) => /^ .* $/.test(seg)),
    },
  };
}

function joinCells(cells: string[], outerPipes: boolean, indent: string): string {
  // Without outer pipes, a leading empty cell would read as an outer pipe.
  const outer = outerPipes || cells[0] === '';
  const inner = cells.join(' | ');
  return outer ? `${indent}| ${inner} |` : `${indent}${inner}`;
}

function compactRow(t: GfmTable, row: TableRow): string {
  return joinCells(row.cells, t.style.outerPipes, t.style.indent);
}

function pad(text: string, w: number, align: Align): string {
  const gap = Math.max(0, w - width(text));
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

function delimiterCell(w: number, align: Align): string {
  const left = align === 'left' || align === 'center' ? ':' : '-';
  const right = align === 'right' || align === 'center' ? ':' : '-';
  return left + '-'.repeat(Math.max(1, w - 2)) + right;
}

/** Realign every line, Prettier-style: pad each column to its widest cell. */
function realigned(t: GfmTable): string[] {
  const n = t.header.cells.length;
  const widths = Array.from({ length: n }, (_, c) => Math.max(
    3,
    width(t.header.cells[c]),
    ...t.rows.map((r) => width(r.cells[c] ?? '')),
  ));
  const render = (cells: string[]) => {
    const body = widths.map((w, c) => pad(cells[c] ?? '', w, t.align[c]));
    const extra = cells.slice(n); // beyond the header: kept, not rendered by GFM
    return joinCells([...body, ...extra], t.style.outerPipes, t.style.indent);
  };
  const delimiter = t.style.spacedDelimiter
    ? joinCells(widths.map((w, c) => delimiterCell(w, t.align[c])), t.style.outerPipes, t.style.indent)
    : t.style.indent + (t.style.outerPipes ? '|' : '')
      + widths.map((w, c) => delimiterCell(w + 2, t.align[c])).join('|')
      + (t.style.outerPipes ? '|' : '');
  return [render(t.header.cells), delimiter, ...t.rows.map((r) => render(r.cells))];
}

/** Render the table back to text: realigned if it was aligned, else untouched rows verbatim. */
export function renderGfmTable(t: GfmTable): string {
  if (t.style.aligned) return realigned(t).join('\n');
  const header = t.header.line ?? compactRow(t, t.header);
  return [header, t.delimiter, ...t.rows.map((r) => r.line ?? compactRow(t, r))].join('\n');
}

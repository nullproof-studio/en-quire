// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { extname } from 'node:path';
import { ValidationError } from '@nullproof-studio/en-core';

/** Zod pieces shared by doc_table_read and doc_table_write (#155). */

/** Parse a JSON string some MCP clients send in place of an array or object. */
export function jsonish<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value; // let the schema report the type mismatch
    }
  }, schema);
}

/**
 * An integer, also accepted as a numeric string ("3", "-1"). Unlike
 * z.coerce.number(), null and "" are rejected — never read as 0, which
 * would silently select the first row or table.
 */
export function intish() {
  return z.union([z.number().int(), z.string().trim().regex(/^-?\d+$/).transform(Number)]);
}

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const rowRecord = z.record(z.string(), cellValue);

export const whereField = jsonish(rowRecord).optional().describe(
  'Pick rows by cell value, like SQL WHERE: {"ID": "RFC-113"} — equality on the cell\'s markdown source or its plain text, ANDed across columns. Use either where or row.',
);
export const rowField = intish().optional().describe(
  'Pick one row by position instead: zero-based over the body rows (header not counted); -1 is the last row. Positions shift as earlier ops insert or delete.',
);
export const tableField = intish().optional().describe(
  'Which table in the section, zero-based. Omit when the section has one table.',
);
export const sectionField = z.string().describe(
  'Section whose body holds the table — heading text, "Parent > Child" path, or "^id". Tables in subsections are not counted.',
);

export function assertMarkdown(file: string): void {
  const ext = extname(file).toLowerCase();
  if (ext !== '.md' && ext !== '.mdx') {
    throw new ValidationError(`Table tools are markdown only (got ${ext || 'no extension'}). For YAML use doc_set_value; JSONL records are addressed with doc_read_section.`);
  }
}

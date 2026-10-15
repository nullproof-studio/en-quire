// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { requirePermission, resolveWriteMode, loadDocument, executeWrite, computeEtag } from '@nullproof-studio/en-core';
import { applyTableOps } from '../../tables/table-ops.js';
import type { TableOp } from '../../tables/table-ops.js';
import {
  jsonish, intish, rowRecord, whereField, rowField, tableField, sectionField, assertMarkdown,
} from '../../tables/table-schema.js';

const expectedCount = intish().optional().describe(
  'Rows the where/row must match (default 1). Set it to change several rows on purpose.',
);

// Strict objects: a misnamed field (e.g. "anchor") is an error, not silently ignored.
const InsertOp = z.strictObject({
  op: z.literal('insert'),
  rows: jsonish(z.array(rowRecord).min(1)).describe(
    'Records keyed by column header, e.g. [{"ID": "RFC-114", "Status": "Draft"}]. Missing columns are left empty; unknown columns are an error.',
  ),
  position: z.enum(['start', 'end', 'before', 'after']).optional().describe(
    '"end" (default) or "start" of the table, or "before" / "after" the one row picked by where or row.',
  ),
  where: whereField,
  row: rowField,
});

const UpdateOp = z.strictObject({
  op: z.literal('update'),
  set: jsonish(rowRecord).describe('Cells to change, like SQL SET: {"Status": "Accepted"}.'),
  where: whereField,
  row: rowField,
  expected_count: expectedCount,
});

const DeleteOp = z.strictObject({
  op: z.literal('delete'),
  where: whereField,
  row: rowField,
  expected_count: expectedCount,
});

export const DocTableWriteSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md"). Markdown only.'),
  section: sectionField,
  table: tableField,
  ops: jsonish(z.array(z.discriminatedUnion('op', [InsertOp, UpdateOp, DeleteOp])).min(1).max(200)).describe(
    'Row operations, applied in order to one parse of the table — later ops see earlier results. All or nothing: if any op fails, nothing is written and the error names the op. One write, one commit, one etag.',
  ),
  if_match: z.string().optional().describe('ETag from a prior read (doc_table_read, doc_outline, …). Required when require_read_before_write is enabled.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocTableWrite(
  args: z.infer<typeof DocTableWriteSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);
  // Checked up front too, so a no-op batch can't report success to a caller who couldn't write.
  resolveWriteMode(ctx.caller, args.file, args.mode);
  assertMarkdown(args.file);

  const { content, encoding } = loadDocument(ctx, args.file);
  const { content: newContent, table_index, affected } = applyTableOps(
    content, args.section, args.ops as TableOp[], args.table,
  );

  if (newContent === content) {
    return {
      success: true,
      file: args.file,
      section: args.section,
      table: table_index,
      affected,
      warning: 'No changes: the ops leave the table exactly as it was, so nothing was written.',
      etag: computeEtag(content),
    };
  }

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Edit table rows',
    target: `${args.section} (table ${table_index})`,
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, newContent, encoding);

  return { ...result, section: args.section, table: table_index, affected };
}

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { readDocument, requirePermission, resolveFilePath, computeEtag } from '@nullproof-studio/en-core';
import { readTable } from '../../tables/table-ops.js';
import {
  jsonish, whereField, rowField, tableField, sectionField, assertMarkdown,
} from '../../tables/table-schema.js';

export const DocTableReadSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md"). Markdown only.'),
  section: sectionField,
  table: tableField,
  where: whereField,
  row: rowField,
  columns: jsonish(z.array(z.string())).optional().describe(
    'Columns to return, like a SQL SELECT list (e.g. ["ID", "Status"]). Omit for all.',
  ),
});

export async function handleDocTableRead(
  args: z.infer<typeof DocTableReadSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);
  assertMarkdown(args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const { table_index, ...result } = readTable(content, args.section, {
    table: args.table, where: args.where, row: args.row, columns: args.columns,
  });

  return { table: table_index, ...result, etag: computeEtag(content) };
}

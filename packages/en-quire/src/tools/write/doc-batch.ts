// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { extname } from 'node:path';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  requirePermission, resolveWriteMode, loadDocument, executeWrite, computeEtag,
  replaceSection, insertSection, appendToSection, deleteSection, moveSection, renameSection,
  EnquireError, ValidationError, booleanish,
} from '@nullproof-studio/en-core';
import { jsonish } from '../../tables/table-schema.js';

const section = z.string().describe(
  'Section address — heading text, path ("Parent > Child") or stable "^id" anchor. Resolved against the document as earlier ops left it.',
);
const position = z.enum(['before', 'after', 'child_start', 'child_end']);

// Strict objects: a misnamed field is an error, not silently ignored.
const ReplaceOp = z.strictObject({
  op: z.literal('replace'),
  section,
  content: z.string().describe('Replacement body, without the heading line (unless replace_heading is true).'),
  replace_heading: booleanish().optional(),
});
const InsertOp = z.strictObject({
  op: z.literal('insert'),
  anchor: section,
  position,
  heading: z.string().describe('Plain heading text, no # markers.'),
  content: z.string(),
  level: z.number().int().min(1).max(6).optional(),
});
const AppendOp = z.strictObject({ op: z.literal('append'), section, content: z.string() });
const DeleteOp = z.strictObject({ op: z.literal('delete'), section });
const MoveOp = z.strictObject({ op: z.literal('move'), section, anchor: section, position });
const RenameOp = z.strictObject({
  op: z.literal('rename'),
  section,
  new_heading: z.string().describe('New heading text, plain, one line, no # markers.'),
});

const BatchOp = z.discriminatedUnion('op', [ReplaceOp, InsertOp, AppendOp, DeleteOp, MoveOp, RenameOp]);
export type BatchOp = z.infer<typeof BatchOp>;

export const DocBatchSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md"). Markdown only.'),
  ops: jsonish(z.array(BatchOp).min(1).max(100)).describe(
    'Section operations, applied in order — each sees the document as earlier ops left it, so you can insert a section and then fill it, or rename a heading and then address it by its new name. ' +
    'Ops: {"op":"replace","section","content"}, {"op":"insert","anchor","position","heading","content"}, {"op":"append","section","content"}, ' +
    '{"op":"delete","section"}, {"op":"move","section","anchor","position"}, {"op":"rename","section","new_heading"}. ' +
    'All or nothing: if any op fails, nothing is written and the error names the op as ops[i]. One write, one commit, one etag.',
  ),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the whole batch.'),
});

export async function handleDocBatch(
  args: z.infer<typeof DocBatchSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);
  // Checked up front too, so a no-op batch can't report success to a caller who couldn't write.
  resolveWriteMode(ctx.caller, args.file, args.mode);

  const ext = extname(args.file).toLowerCase();
  if (ext !== '.md' && ext !== '.mdx') {
    throw new ValidationError(
      `doc_batch supports markdown only (got ${ext || 'no extension'}). ` +
      'For YAML use doc_replace_section / doc_set_value; for JSONL records are addressed by index.',
    );
  }

  const { content, encoding, parser } = loadDocument(ctx, args.file);
  let current = content;
  const warnings: string[] = [];
  const applied: Array<{ index: number; op: string; section: string }> = [];

  (args.ops as BatchOp[]).forEach((op, i) => {
    try {
      // Reparse each time: earlier ops move offsets, rename headings and create sections.
      const tree = parser.parse(current);
      const ops = parser.ops;
      switch (op.op) {
        case 'replace':
          current = replaceSection(current, tree, parser.parseAddress(op.section), op.content, op.replace_heading === true, ops);
          break;
        case 'insert': {
          const w: string[] = [];
          current = insertSection(current, tree, parser.parseAddress(op.anchor), op.position, op.heading, op.content, ops, op.level, w);
          warnings.push(...w.map((m) => `ops[${i}] (insert): ${m}`));
          break;
        }
        case 'append':
          current = appendToSection(current, tree, parser.parseAddress(op.section), op.content, ops);
          break;
        case 'delete':
          current = deleteSection(current, tree, parser.parseAddress(op.section));
          break;
        case 'move':
          current = moveSection(current, tree, parser.parseAddress(op.section), parser.parseAddress(op.anchor), op.position, ops);
          break;
        case 'rename':
          current = renameSection(current, tree, parser.parseAddress(op.section), op.new_heading, ops);
          break;
      }
      applied.push({ index: i, op: op.op, section: op.op === 'insert' ? op.heading : op.section });
    } catch (err) {
      // Keep the original error class (and its hints); just say which op failed.
      if (err instanceof EnquireError) err.message = `ops[${i}] (${op.op}): ${err.message}`;
      throw err;
    }
  });

  if (current === content) {
    return {
      success: true,
      file: args.file,
      applied,
      warning: 'No changes: the ops leave the document exactly as it was, so nothing was written.',
      etag: computeEtag(content),
    };
  }

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Batch edit',
    target: `${args.ops.length} op${args.ops.length === 1 ? '' : 's'}`,
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, current, encoding);

  return { ...result, applied, ...(warnings.length > 0 && { warnings }) };
}

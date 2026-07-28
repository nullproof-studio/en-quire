// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { extname } from 'node:path';
import type { ToolContext } from '@nullproof-studio/en-core';
import { renameSection } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { loadDocument, executeWrite } from '@nullproof-studio/en-core';
import { ValidationError } from '@nullproof-studio/en-core';

export const DocRenameSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md"). Markdown only.'),
  section: z.string().describe('Section address — heading text (e.g. "Problem Statement"), path (e.g. "Parent > Child"), or a stable "^id" anchor (e.g. "^store-map").'),
  new_heading: z.string().describe('The new heading text, plain and on one line, without "#" markers (e.g. "Motivation", not "## Motivation"). The heading level is preserved. Append an explicit "^id" anchor only if you intend to change it — the existing anchor is carried across automatically.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocRenameSection(
  args: z.infer<typeof DocRenameSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  // Markdown only. A YAML key rename rewrites `key: value` (and any anchors or
  // aliases referring to it), and a JSONL "heading" is a synthetic record
  // index — neither is a heading-line edit, so neither is safe here.
  const ext = extname(args.file).toLowerCase();
  if (ext !== '.md' && ext !== '.mdx') {
    throw new ValidationError(
      `Section rename is not supported for ${ext || 'this'} files — it renames a markdown heading line. `
      + 'For YAML, rename a key by rewriting its parent mapping with doc_replace_section, or set a value with doc_set_value. '
      + 'For JSONL, records are addressed by index and have no heading to rename.',
    );
  }

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);
  const address = parser.parseAddress(args.section);
  const newContent = renameSection(content, tree, address, args.new_heading, parser.ops);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Rename section',
    target: `${args.section} → ${args.new_heading}`,
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, newContent, encoding);

  return { ...result, section: args.section, new_heading: args.new_heading };
}

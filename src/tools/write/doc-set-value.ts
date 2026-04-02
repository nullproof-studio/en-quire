// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { setValue } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocSetValueSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.yaml").'),
  path: z.string().describe('Address of the value to set. For YAML: dot-separated key path (e.g. "services.api.port"). For markdown: section address (e.g. "Configuration"). Target must be a leaf/scalar node — use doc_replace_section for container nodes with children.'),
  value: z.string().describe('New scalar value. For YAML, the original quote style (\', ", or unquoted) is preserved automatically.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocSetValue(
  args: z.infer<typeof DocSetValueSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);
  const address = parser.parseAddress(args.path);
  const newContent = setValue(content, tree, address, args.value);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Set value',
    target: args.path,
    mode: args.mode,
    message: args.message,
  }, content, newContent, encoding);

  return { ...result, path: args.path };
}

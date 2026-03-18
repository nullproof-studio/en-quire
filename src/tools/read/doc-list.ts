// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext } from '../context.js';
import { listMarkdownFiles, readDocument } from '../../shared/file-utils.js';
import { parseMarkdown } from '../../document/parser.js';
import { buildSectionTree } from '../../document/section-tree.js';
import { requirePermission } from '../../rbac/permissions.js';

export const DocListSchema = z.object({
  scope: z.string().optional(),
  include_outline: z.boolean().default(false),
});

export async function handleDocList(
  args: z.infer<typeof DocListSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.scope ?? '**');

  const files = listMarkdownFiles(ctx.documentRoot, args.scope);

  const fileList = files.map((file) => {
    const absolutePath = join(ctx.documentRoot, file);
    const stat = statSync(absolutePath);

    const entry: {
      path: string;
      size: number;
      modified: string;
      outline?: Array<{ level: number; text: string }>;
    } = {
      path: file,
      size: stat.size,
      modified: stat.mtime.toISOString(),
    };

    if (args.include_outline) {
      try {
        const { content } = readDocument(ctx.documentRoot, file);
        const ast = parseMarkdown(content);
        const tree = buildSectionTree(ast, content);
        const flatOutline = (function flatten(nodes: typeof tree): Array<{ level: number; text: string }> {
          const result: Array<{ level: number; text: string }> = [];
          for (const node of nodes) {
            result.push({ level: node.heading.level, text: node.heading.text });
            result.push(...flatten(node.children));
          }
          return result;
        })(tree);
        entry.outline = flatOutline;
      } catch {
        // Skip outline on error
      }
    }

    return entry;
  });

  return { files: fileList };
}

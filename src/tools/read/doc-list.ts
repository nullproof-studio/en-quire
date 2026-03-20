// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext } from '../context.js';
import { listDocumentFiles, readDocument } from '../../shared/file-utils.js';
import { parserRegistry } from '../../document/parser-registry.js';
import { requirePermission } from '../../rbac/permissions.js';
import { resolveScope } from '../../config/roots.js';

export const DocListSchema = z.object({
  scope: z.string().optional(),
  include_outline: z.boolean().default(false),
});

export async function handleDocList(
  args: z.infer<typeof DocListSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.scope ?? '**');

  const { rootName, scopeWithinRoot } = resolveScope(ctx.config.document_roots, args.scope);

  // Determine which roots to list
  const rootsToList = rootName
    ? { [rootName]: ctx.config.document_roots[rootName] }
    : ctx.config.document_roots;

  const fileList: Array<{
    path: string;
    root: string;
    size: number;
    modified: string;
    outline?: Array<{ level: number; text: string }>;
  }> = [];

  for (const [name, root] of Object.entries(rootsToList)) {
    const files = listDocumentFiles(root.path, scopeWithinRoot);

    for (const file of files) {
      const absolutePath = join(root.path, file);
      let stat;
      try {
        stat = statSync(absolutePath);
      } catch {
        continue;
      }

      const prefixedPath = `${name}/${file}`;

      const entry: typeof fileList[number] = {
        path: prefixedPath,
        root: name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      };

      if (args.include_outline) {
        try {
          const { content } = readDocument(root.path, file);
          const parser = parserRegistry.getParser(file);
          const tree = parser.parse(content);
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

      fileList.push(entry);
    }
  }

  return { files: fileList };
}

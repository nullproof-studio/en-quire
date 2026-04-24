// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  listDocumentFiles,
  requirePermission,
  resolveScope,
} from '@nullproof-studio/en-core';

/** File extensions en-scribe considers "plain text" — mirrors PlaintextParser.extensions. */
const TEXT_EXTENSIONS = ['.txt', '.text', '.log'];

export const TextListSchema = z.object({
  scope: z.string().optional().describe('Limit results to a root or path prefix (e.g. "root-name" or "root-name/subfolder"). Omit to list all plain-text files across all roots.'),
});

export async function handleTextList(
  args: z.infer<typeof TextListSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.scope ?? '**');

  const { rootName, scopeWithinRoot } = resolveScope(ctx.config.document_roots, args.scope);

  const rootsToList = rootName
    ? { [rootName]: ctx.config.document_roots[rootName] }
    : ctx.config.document_roots;

  const fileList: Array<{ path: string; root: string; size: number; modified: string }> = [];

  for (const [name, root] of Object.entries(rootsToList)) {
    const files = listDocumentFiles(root.path, scopeWithinRoot, TEXT_EXTENSIONS);
    for (const file of files) {
      const absolutePath = join(root.path, file);
      let stat;
      try {
        stat = statSync(absolutePath);
      } catch {
        continue;
      }
      fileList.push({
        path: `${name}/${file}`,
        root: name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }

  return { files: fileList, total: fileList.length };
}

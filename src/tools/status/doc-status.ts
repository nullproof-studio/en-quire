// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { listMarkdownFiles } from '../../shared/file-utils.js';
import { getIndexedCount, getIndexedFiles } from '../../search/indexer.js';
import { requirePermission } from '../../rbac/permissions.js';

export const DocStatusSchema = z.object({
  scope: z.string().optional(),
});

export async function handleDocStatus(
  args: z.infer<typeof DocStatusSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.scope ?? '**');

  const allFiles = listMarkdownFiles(ctx.documentRoot, args.scope);
  const indexed = getIndexedCount(ctx.db);

  // Get modified files from git
  let modified: string[] = [];
  let pendingProposals = 0;

  if (ctx.git?.available) {
    try {
      modified = await ctx.git.getModifiedFiles();
    } catch {
      // Non-fatal
    }

    try {
      const branches = await ctx.git.listBranches('propose/');
      pendingProposals = branches.length;
    } catch {
      // Non-fatal
    }
  }

  // Find unindexed files
  const indexedFileSet = new Set(getIndexedFiles(ctx.db));
  const unindexed = allFiles.filter((f) => !indexedFileSet.has(f));

  return {
    modified,
    pending_proposals: pendingProposals,
    indexed,
    unindexed,
    git_active: ctx.git?.available ?? false,
  };
}

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { listMarkdownFiles } from '../../shared/file-utils.js';
import { getIndexedCount, getIndexedFiles } from '../../search/indexer.js';
import { requirePermission } from '../../rbac/permissions.js';
import { resolveScope } from '../../config/roots.js';

export const DocStatusSchema = z.object({
  scope: z.string().optional(),
});

export async function handleDocStatus(
  args: z.infer<typeof DocStatusSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.scope ?? '**');

  const { rootName, scopeWithinRoot } = resolveScope(ctx.config.document_roots, args.scope);

  // Determine which roots to check
  const rootsToCheck = rootName
    ? { [rootName]: ctx.config.document_roots[rootName] }
    : ctx.config.document_roots;

  // Collect all files across roots with prefixed paths
  const allFiles: string[] = [];
  for (const [name, root] of Object.entries(rootsToCheck)) {
    const files = listMarkdownFiles(root.path, scopeWithinRoot);
    for (const file of files) {
      allFiles.push(`${name}/${file}`);
    }
  }

  const indexed = getIndexedCount(ctx.db);

  // Get modified files and proposals per root
  let modified: string[] = [];
  let pendingProposals = 0;

  for (const [name, rootCtx] of Object.entries(ctx.roots)) {
    if (rootName && name !== rootName) continue;
    const git = rootCtx.git;
    if (!git?.available) continue;

    try {
      const rootModified = await git.getModifiedFiles();
      modified.push(...rootModified.map((f) => `${name}/${f}`));
    } catch {
      // Non-fatal
    }

    try {
      const branches = await git.listBranches('propose/');
      pendingProposals += branches.length;
    } catch {
      // Non-fatal
    }
  }

  // Find unindexed files
  const indexedFileSet = new Set(getIndexedFiles(ctx.db));
  const unindexed = allFiles.filter((f) => !indexedFileSet.has(f));

  // Build per-root status
  const rootStatus = Object.entries(ctx.roots).map(([name, rootCtx]) => ({
    name,
    description: ctx.config.document_roots[name]?.description,
    git_active: rootCtx.git?.available ?? false,
  }));

  return {
    roots: rootStatus,
    modified,
    pending_proposals: pendingProposals,
    indexed,
    unindexed,
  };
}

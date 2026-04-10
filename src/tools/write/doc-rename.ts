// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { renameSync, existsSync } from 'node:fs';
import type { ToolContext } from '../context.js';
import { safePath } from '../../shared/file-utils.js';
import { removeFromIndex } from '../../search/indexer.js';
import { buildCommitMessage, buildProposalBranch } from '../../git/commit-message.js';
import { requirePermission, resolveWriteMode } from '../../rbac/permissions.js';
import { NotFoundError, ValidationError, GitRequiredError } from '../../shared/errors.js';
import { resolveFilePath } from '../../config/roots.js';

export const DocRenameSchema = z.object({
  source: z.string().describe('Current document path (e.g. "root/old-name.md"). Must exist.'),
  destination: z.string().describe('New document path (e.g. "root/new-name.md"). Must not already exist. Must be in the same root — cross-root rename is not supported.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocRename(
  args: z.infer<typeof DocRenameSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.source);

  const srcResolved = resolveFilePath(ctx.config.document_roots, args.source);
  const destResolved = resolveFilePath(ctx.config.document_roots, args.destination);

  // Cross-root rename not supported (different git repos / governance)
  if (srcResolved.rootName !== destResolved.rootName) {
    throw new ValidationError(
      `Cannot rename across roots ("${srcResolved.rootName}" → "${destResolved.rootName}"). Use doc_read + doc_create + doc_delete instead.`,
    );
  }

  const rootCtx = ctx.roots[srcResolved.rootName];
  const git = rootCtx?.git;
  const mode = resolveWriteMode(ctx.caller, args.source, args.mode);

  if (mode === 'propose' && !git?.available) {
    throw new GitRequiredError('Proposal workflows');
  }

  const sourcePath = safePath(srcResolved.root.path, srcResolved.relativePath);
  const destPath = safePath(destResolved.root.path, destResolved.relativePath);

  if (!existsSync(sourcePath)) {
    throw new NotFoundError('file', args.source);
  }
  if (existsSync(destPath)) {
    throw new ValidationError(`Destination already exists: ${args.destination}`);
  }

  let branch: string | undefined;
  const originalBranch = git?.available ? await git.getCurrentBranch() : undefined;

  try {
    if (mode === 'propose' && git?.available) {
      branch = buildProposalBranch(ctx.caller.id, args.source);
      await git.createBranch(branch);
    }

    renameSync(sourcePath, destPath);

    let commit: string | undefined;
    if (git?.available) {
      const commitMsg = buildCommitMessage({
        operation: 'Rename document',
        target: `${args.source} → ${args.destination}`,
        file: args.destination,
        caller: ctx.caller.id,
        mode,
        userMessage: args.message,
      });
      commit = await git.commitFiles(
        [srcResolved.relativePath, destResolved.relativePath],
        commitMsg,
      );
    }

    // Update search index (remove old prefixed path)
    removeFromIndex(ctx.db, srcResolved.prefixedPath);

    return { success: true, source: args.source, destination: args.destination, mode, branch, commit };
  } finally {
    if (mode === 'propose' && originalBranch && git?.available) {
      await git.switchBranch(originalBranch);
    }
  }
}

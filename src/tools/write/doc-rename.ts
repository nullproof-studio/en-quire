// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { renameSync, existsSync } from 'node:fs';
import type { ToolContext } from '../context.js';
import { safePath } from '../../shared/file-utils.js';
import { removeFromIndex } from '../../search/indexer.js';
import { buildCommitMessage, buildProposalBranch } from '../../git/commit-message.js';
import { requirePermission, resolveWriteMode } from '../../rbac/permissions.js';
import { NotFoundError, ValidationError, GitRequiredError } from '../../shared/errors.js';

export const DocRenameSchema = z.object({
  source: z.string(),
  destination: z.string(),
  mode: z.enum(['write', 'propose']).optional(),
  message: z.string().optional(),
});

export async function handleDocRename(
  args: z.infer<typeof DocRenameSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.source);
  const mode = resolveWriteMode(ctx.caller, args.source, args.mode);

  if (mode === 'propose' && !ctx.git?.available) {
    throw new GitRequiredError('Proposal workflows');
  }

  const sourcePath = safePath(ctx.documentRoot, args.source);
  const destPath = safePath(ctx.documentRoot, args.destination);

  if (!existsSync(sourcePath)) {
    throw new NotFoundError('file', args.source);
  }
  if (existsSync(destPath)) {
    throw new ValidationError(`Destination already exists: ${args.destination}`);
  }

  let branch: string | undefined;
  const originalBranch = ctx.git?.available ? await ctx.git.getCurrentBranch() : undefined;

  try {
    if (mode === 'propose' && ctx.git?.available) {
      branch = buildProposalBranch(ctx.caller.id, args.source);
      await ctx.git.createBranch(branch);
    }

    renameSync(sourcePath, destPath);

    let commit: string | undefined;
    if (ctx.git?.available) {
      const commitMsg = buildCommitMessage({
        operation: 'Rename document',
        target: `${args.source} → ${args.destination}`,
        file: args.destination,
        caller: ctx.caller.id,
        mode,
        userMessage: args.message,
      });
      commit = await ctx.git.commitFiles([args.source, args.destination], commitMsg);
    }

    // Update search index
    removeFromIndex(ctx.db, args.source);

    return { success: true, source: args.source, destination: args.destination, mode, branch, commit };
  } finally {
    if (mode === 'propose' && originalBranch && ctx.git?.available) {
      await ctx.git.switchBranch(originalBranch);
    }
  }
}

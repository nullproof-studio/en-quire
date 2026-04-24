// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { renameSync, existsSync } from 'node:fs';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  safePath,
  readDocument,
  computeEtag,
  validateEtag,
  removeFromIndex,
  buildCommitMessage,
  buildProposalBranch,
  requirePermission,
  resolveWriteMode,
  NotFoundError,
  ValidationError,
  GitRequiredError,
  resolveFilePath,
} from '@nullproof-studio/en-core';

export const TextRenameSchema = z.object({
  source: z.string().describe('Current file path (e.g. "root/old.txt"). Must exist.'),
  destination: z.string().describe('New file path (e.g. "root/new.txt"). Must not already exist. Must be in the same root.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleTextRename(
  args: z.infer<typeof TextRenameSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.source);

  const srcResolved = resolveFilePath(ctx.config.document_roots, args.source);
  const destResolved = resolveFilePath(ctx.config.document_roots, args.destination);

  if (srcResolved.rootName !== destResolved.rootName) {
    throw new ValidationError(
      `Cannot rename across roots ("${srcResolved.rootName}" → "${destResolved.rootName}"). Use text_read + text_create + text_delete instead.`,
    );
  }

  const rootCtx = ctx.roots[srcResolved.rootName];
  const git = rootCtx?.git;
  const mode = resolveWriteMode(ctx.caller, args.source, args.mode);

  // A rename moves the file to a new path, so the caller must have the
  // resolved mode's permission on the DESTINATION as well — not just the
  // source. Without this, a caller with write on "public/**" could smuggle
  // a file into "protected/**" by renaming across scopes.
  requirePermission(ctx.caller, mode, args.destination);

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

  const { content } = readDocument(srcResolved.root.path, srcResolved.relativePath);
  const sourceEtag = computeEtag(content);
  validateEtag(args.if_match, sourceEtag, args.source, ctx.config.require_read_before_write);

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
        operation: 'Rename text file',
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

    removeFromIndex(ctx.db, srcResolved.prefixedPath);

    return {
      success: true,
      source: args.source,
      destination: args.destination,
      mode,
      branch,
      commit,
      etag: sourceEtag,
    };
  } finally {
    if (mode === 'propose' && originalBranch && git?.available) {
      await git.switchBranch(originalBranch);
    }
  }
}

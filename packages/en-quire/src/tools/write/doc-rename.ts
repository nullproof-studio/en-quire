// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { renameSync, existsSync } from 'node:fs';
import type { ToolContext } from '@nullproof-studio/en-core';
import { safePath, readDocument } from '@nullproof-studio/en-core';
import { computeEtag, validateEtag } from '@nullproof-studio/en-core';
import { removeFromIndex } from '@nullproof-studio/en-core';
import { buildCommitMessage, buildProposalBranch } from '@nullproof-studio/en-core';
import { requirePermission, resolveWriteMode } from '@nullproof-studio/en-core';
import { NotFoundError, ValidationError, GitRequiredError } from '@nullproof-studio/en-core';
import { resolveFilePath } from '@nullproof-studio/en-core';

export const DocRenameSchema = z.object({
  source: z.string().describe('Current document path (e.g. "root/old-name.md"). Must exist.'),
  destination: z.string().describe('New document path (e.g. "root/new-name.md"). Must not already exist. Must be in the same root — cross-root rename is not supported.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
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

  // ETag validation — validate against source file content before rename
  const { content: sourceContent } = readDocument(srcResolved.root.path, srcResolved.relativePath);
  const sourceEtag = computeEtag(sourceContent);
  validateEtag(args.if_match, sourceEtag, args.source, ctx.config.require_read_before_write);

  let branch: string | undefined;
  const originalBranch = git?.available ? await git.getCurrentBranch() : undefined;
  const renameWarnings: string[] = [];

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

      if (mode === 'propose' && branch) {
        const pushResult = await git.pushProposalBranch(branch);
        if (pushResult.warning) {
          renameWarnings.push(pushResult.warning);
        }
      }
    }

    // Update search index (remove old prefixed path)
    removeFromIndex(ctx.db, srcResolved.prefixedPath);

    return {
      success: true,
      source: args.source,
      destination: args.destination,
      mode,
      branch,
      commit,
      etag: sourceEtag,
      ...(renameWarnings.length > 0 && { warnings: renameWarnings }),
    };
  } finally {
    if (mode === 'propose' && originalBranch && git?.available) {
      await git.switchBranch(originalBranch);
    }
  }
}

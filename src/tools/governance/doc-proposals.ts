// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { GitRequiredError } from '@nullproof-studio/en-core';
import type { GitOperations } from '@nullproof-studio/en-core';

/**
 * Find a git-enabled root. If rootName is provided, use that specific root.
 * Otherwise return the first git-enabled root.
 */
function findGitRoot(ctx: ToolContext, rootName?: string): { name: string; git: GitOperations } {
  if (rootName) {
    const rootCtx = ctx.roots[rootName];
    if (!rootCtx?.git?.available) {
      throw new GitRequiredError(`Proposals (root "${rootName}" has no git)`);
    }
    return { name: rootName, git: rootCtx.git };
  }

  for (const [name, rootCtx] of Object.entries(ctx.roots)) {
    if (rootCtx.git?.available) {
      return { name, git: rootCtx.git };
    }
  }

  throw new GitRequiredError('Proposals (no git-enabled roots)');
}

/**
 * Collect proposals across all git-enabled roots.
 */
async function collectProposals(ctx: ToolContext) {
  const allProposals: Array<{
    branch: string;
    caller: string;
    file: string;
    root: string;
    section: string;
    operation: string;
    message: string;
    created: string;
    diff_summary: string;
  }> = [];

  for (const [name, rootCtx] of Object.entries(ctx.roots)) {
    if (!rootCtx.git?.available) continue;

    const branches = await rootCtx.git.listBranches('propose/');
    for (const branch of branches) {
      const parts = branch.replace('propose/', '').split('/');
      const caller = parts[0];
      const timestamp = parts[parts.length - 1];
      const fileParts = parts.slice(1, -1);
      const file = `${name}/${fileParts.join('/')}.md`;

      allProposals.push({
        branch,
        caller,
        file,
        root: name,
        section: '',
        operation: '',
        message: '',
        created: timestamp,
        diff_summary: '',
      });
    }
  }

  return allProposals;
}

// --- doc_proposals_list ---

export const DocProposalsListSchema = z.object({
  scope: z.string().optional(),
  caller: z.string().optional(),
});

export async function handleDocProposalsList(
  args: z.infer<typeof DocProposalsListSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.scope ?? '**');

  const proposals = await collectProposals(ctx);

  const filtered = proposals
    .filter((p) => {
      if (args.caller) {
        return p.caller === args.caller;
      }
      return true;
    })
    .filter((p) => {
      if (args.scope) {
        return p.file.startsWith(args.scope.replace(/\*+/g, ''));
      }
      return true;
    });

  return { proposals: filtered };
}

// --- doc_proposal_diff ---

export const DocProposalDiffSchema = z.object({
  branch: z.string(),
  root: z.string().optional().describe('Root name where the proposal lives. Required if multiple git-enabled roots.'),
});

export async function handleDocProposalDiff(
  args: z.infer<typeof DocProposalDiffSchema>,
  ctx: ToolContext,
) {
  const { git } = findGitRoot(ctx, args.root);

  // Parse caller and file from branch name
  const parts = args.branch.replace('propose/', '').split('/');
  const caller = parts[0];
  const fileParts = parts.slice(1, -1);
  const file = fileParts.join('/') + '.md';

  requirePermission(ctx.caller, 'read', file);

  const diff = await git.getDiff(args.branch);

  return { diff, file, caller, message: '' };
}

// --- doc_proposal_approve ---

export const DocProposalApproveSchema = z.object({
  branch: z.string(),
  message: z.string().optional(),
  root: z.string().optional(),
});

export async function handleDocProposalApprove(
  args: z.infer<typeof DocProposalApproveSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'approve', '**');

  const { git } = findGitRoot(ctx, args.root);

  const parts = args.branch.replace('propose/', '').split('/');
  const fileParts = parts.slice(1, -1);
  const file = fileParts.join('/') + '.md';

  const mergeMessage = args.message ?? `[en-quire] Approve proposal: ${args.branch}`;
  await git.mergeBranch(args.branch, mergeMessage);
  await git.deleteBranch(args.branch);

  return {
    success: true,
    merge_commit: '',
    file,
    branch: args.branch,
  };
}

// --- doc_proposal_reject ---

export const DocProposalRejectSchema = z.object({
  branch: z.string(),
  reason: z.string().optional(),
  root: z.string().optional(),
});

export async function handleDocProposalReject(
  args: z.infer<typeof DocProposalRejectSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'approve', '**');

  const { git } = findGitRoot(ctx, args.root);

  await git.deleteBranch(args.branch);

  return { success: true, branch: args.branch };
}

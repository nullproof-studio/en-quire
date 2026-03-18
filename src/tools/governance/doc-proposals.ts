// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { requirePermission } from '../../rbac/permissions.js';
import { GitRequiredError } from '../../shared/errors.js';

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

  if (!ctx.git?.available) {
    throw new GitRequiredError('Listing proposals');
  }

  const branches = await ctx.git.listBranches('propose/');

  const proposals = branches
    .filter((b) => {
      if (args.caller) {
        return b.startsWith(`propose/${args.caller}/`);
      }
      return true;
    })
    .map((branch) => {
      // Parse branch name: propose/{caller}/{path}/{timestamp}
      const parts = branch.replace('propose/', '').split('/');
      const caller = parts[0];
      const timestamp = parts[parts.length - 1];
      const fileParts = parts.slice(1, -1);
      const file = fileParts.join('/') + '.md';

      return {
        branch,
        caller,
        file,
        section: '', // Would need to parse the commit to get this
        operation: '',
        message: '',
        created: timestamp,
        diff_summary: '',
      };
    })
    .filter((p) => {
      if (args.scope) {
        return p.file.startsWith(args.scope.replace(/\*+/g, ''));
      }
      return true;
    });

  return { proposals };
}

// --- doc_proposal_diff ---

export const DocProposalDiffSchema = z.object({
  branch: z.string(),
});

export async function handleDocProposalDiff(
  args: z.infer<typeof DocProposalDiffSchema>,
  ctx: ToolContext,
) {
  if (!ctx.git?.available) {
    throw new GitRequiredError('Viewing proposal diff');
  }

  // Parse caller and file from branch name
  const parts = args.branch.replace('propose/', '').split('/');
  const caller = parts[0];
  const fileParts = parts.slice(1, -1);
  const file = fileParts.join('/') + '.md';

  requirePermission(ctx.caller, 'read', file);

  const diff = await ctx.git.getDiff(args.branch);

  return { diff, file, caller, message: '' };
}

// --- doc_proposal_approve ---

export const DocProposalApproveSchema = z.object({
  branch: z.string(),
  message: z.string().optional(),
});

export async function handleDocProposalApprove(
  args: z.infer<typeof DocProposalApproveSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'approve', '**');

  if (!ctx.git?.available) {
    throw new GitRequiredError('Approving proposals');
  }

  // Parse file from branch name
  const parts = args.branch.replace('propose/', '').split('/');
  const fileParts = parts.slice(1, -1);
  const file = fileParts.join('/') + '.md';

  const mergeMessage = args.message ?? `[en-quire] Approve proposal: ${args.branch}`;
  await ctx.git.mergeBranch(args.branch, mergeMessage);
  await ctx.git.deleteBranch(args.branch);

  return {
    success: true,
    merge_commit: '', // Would need to capture from merge result
    file,
    branch: args.branch,
  };
}

// --- doc_proposal_reject ---

export const DocProposalRejectSchema = z.object({
  branch: z.string(),
  reason: z.string().optional(),
});

export async function handleDocProposalReject(
  args: z.infer<typeof DocProposalRejectSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'approve', '**');

  if (!ctx.git?.available) {
    throw new GitRequiredError('Rejecting proposals');
  }

  await ctx.git.deleteBranch(args.branch);

  return { success: true, branch: args.branch };
}

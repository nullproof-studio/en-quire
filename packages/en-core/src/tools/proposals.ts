// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { requirePermission } from '../rbac/permissions.js';
import { GitRequiredError, ValidationError } from '../shared/errors.js';
import { getProductName } from '../shared/logger.js';
import { parseProposalBranch } from '../git/commit-message.js';
import type { GitOperations } from '../git/operations.js';

/**
 * Format-agnostic proposal governance handlers.
 *
 * Shared by en-quire (registered as doc_proposals_*) and en-scribe
 * (registered as text_proposals_*). Branch names encode paths with
 * literal `/` separators so the branch → file round-trip is lossless
 * regardless of the binary that created the proposal.
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
      const { caller, file, timestamp } = parseProposalBranch(branch, name);
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

// --- proposals_list ---

export const ProposalsListSchema = z.object({
  scope: z.string().optional(),
  caller: z.string().optional(),
});

export async function handleProposalsList(
  args: z.infer<typeof ProposalsListSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.scope ?? '**');

  const proposals = await collectProposals(ctx);

  const filtered = proposals
    .filter((p) => (args.caller ? p.caller === args.caller : true))
    .filter((p) => (args.scope ? p.file.startsWith(args.scope.replace(/\*+/g, '')) : true));

  return { proposals: filtered };
}

// --- proposal_diff ---

export const ProposalDiffSchema = z.object({
  branch: z.string(),
  root: z.string().optional().describe('Root name where the proposal lives. Required if multiple git-enabled roots.'),
});

export async function handleProposalDiff(
  args: z.infer<typeof ProposalDiffSchema>,
  ctx: ToolContext,
) {
  const { name: root, git } = findGitRoot(ctx, args.root);

  const { caller, file } = parseProposalBranch(args.branch, root);

  requirePermission(ctx.caller, 'read', file);

  const diff = await git.getDiff(args.branch);

  return { diff, file, caller, message: '' };
}

// --- proposal_approve ---

export const ProposalApproveSchema = z.object({
  branch: z.string(),
  message: z.string().optional(),
  root: z.string().optional(),
});

export async function handleProposalApprove(
  args: z.infer<typeof ProposalApproveSchema>,
  ctx: ToolContext,
) {
  // Resolve the root + target file BEFORE the permission check so the
  // check can be scoped to the specific file, not a global '**'. A caller
  // with approve on skills/** must not be able to approve a proposal
  // targeting sops/** just because they have 'approve' somewhere.
  const { name: root, git } = findGitRoot(ctx, args.root);
  const { file } = parseProposalBranch(args.branch, root);

  requirePermission(ctx.caller, 'approve', file);

  const mergeMessage = args.message ?? `[${getProductName()}] Approve proposal: ${args.branch}`;
  const { merge_commit } = await git.approveProposal(args.branch, mergeMessage);

  return {
    success: true,
    merge_commit,
    file,
    branch: args.branch,
  };
}

// --- proposal_reject ---

export const ProposalRejectSchema = z.object({
  branch: z.string(),
  reason: z.string().optional(),
  root: z.string().optional(),
});

export async function handleProposalReject(
  args: z.infer<typeof ProposalRejectSchema>,
  ctx: ToolContext,
) {
  // Branch validation must happen BEFORE any git state is touched —
  // otherwise a caller with global 'approve' could pass any local branch
  // name (e.g. 'main', 'feature/whatever') and delete it. The prefix check
  // plus the structural check below keep this function to `propose/*`
  // branches only.
  if (!args.branch.startsWith('propose/')) {
    throw new ValidationError(
      `Can only reject proposal branches (propose/...). Got: ${args.branch}`,
    );
  }
  // Minimum structure: propose/{caller}/{...file}/{timestamp}
  if (args.branch.split('/').length < 4) {
    throw new ValidationError(
      `Malformed proposal branch: ${args.branch}`,
    );
  }

  const { name: root, git } = findGitRoot(ctx, args.root);
  const { file } = parseProposalBranch(args.branch, root);

  requirePermission(ctx.caller, 'approve', file);

  await git.deleteBranch(args.branch);

  return { success: true, branch: args.branch };
}

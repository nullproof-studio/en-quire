// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  ProposalsListSchema,
  handleProposalsList,
  ProposalDiffSchema,
  handleProposalDiff,
  ProposalApproveSchema,
  handleProposalApprove,
  ProposalRejectSchema,
  handleProposalReject,
} from '@nullproof-studio/en-core';
import type { z } from 'zod';

export const DocProposalsListSchema = ProposalsListSchema;
export async function handleDocProposalsList(
  args: z.infer<typeof ProposalsListSchema>,
  ctx: ToolContext,
) {
  return handleProposalsList(args, ctx);
}

export const DocProposalDiffSchema = ProposalDiffSchema;
export async function handleDocProposalDiff(
  args: z.infer<typeof ProposalDiffSchema>,
  ctx: ToolContext,
) {
  return handleProposalDiff(args, ctx);
}

export const DocProposalApproveSchema = ProposalApproveSchema;
export async function handleDocProposalApprove(
  args: z.infer<typeof ProposalApproveSchema>,
  ctx: ToolContext,
) {
  return handleProposalApprove(args, ctx);
}

export const DocProposalRejectSchema = ProposalRejectSchema;
export async function handleDocProposalReject(
  args: z.infer<typeof ProposalRejectSchema>,
  ctx: ToolContext,
) {
  return handleProposalReject(args, ctx);
}

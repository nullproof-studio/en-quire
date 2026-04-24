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

export const TextProposalsListSchema = ProposalsListSchema;
export async function handleTextProposalsList(
  args: z.infer<typeof ProposalsListSchema>,
  ctx: ToolContext,
) {
  return handleProposalsList(args, ctx);
}

export const TextProposalDiffSchema = ProposalDiffSchema;
export async function handleTextProposalDiff(
  args: z.infer<typeof ProposalDiffSchema>,
  ctx: ToolContext,
) {
  return handleProposalDiff(args, ctx);
}

export const TextProposalApproveSchema = ProposalApproveSchema;
export async function handleTextProposalApprove(
  args: z.infer<typeof ProposalApproveSchema>,
  ctx: ToolContext,
) {
  return handleProposalApprove(args, ctx);
}

export const TextProposalRejectSchema = ProposalRejectSchema;
export async function handleTextProposalReject(
  args: z.infer<typeof ProposalRejectSchema>,
  ctx: ToolContext,
) {
  return handleProposalReject(args, ctx);
}

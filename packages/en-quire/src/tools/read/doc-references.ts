// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  ReferencesSchema,
  ReferencedBySchema,
  handleReferences,
  handleReferencedBy,
} from '@nullproof-studio/en-core';
import type { z } from 'zod';

export const DocReferencesSchema = ReferencesSchema;
export async function handleDocReferences(
  args: z.infer<typeof ReferencesSchema>,
  ctx: ToolContext,
) {
  return handleReferences(args, ctx);
}

export const DocReferencedBySchema = ReferencedBySchema;
export async function handleDocReferencedBy(
  args: z.infer<typeof ReferencedBySchema>,
  ctx: ToolContext,
) {
  return handleReferencedBy(args, ctx);
}

// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from '@nullproof-studio/en-core';
import { StatusSchema, handleStatus } from '@nullproof-studio/en-core';
import type { z } from 'zod';

export const TextStatusSchema = StatusSchema;

export async function handleTextStatus(
  args: z.infer<typeof StatusSchema>,
  ctx: ToolContext,
) {
  return handleStatus(args, ctx);
}

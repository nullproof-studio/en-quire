// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from '@nullproof-studio/en-core';
import { HistorySchema, handleHistory } from '@nullproof-studio/en-core';
import type { z } from 'zod';

export const DocHistorySchema = HistorySchema;

export async function handleDocHistory(
  args: z.infer<typeof HistorySchema>,
  ctx: ToolContext,
) {
  return handleHistory(args, ctx);
}

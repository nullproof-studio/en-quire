// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from '@nullproof-studio/en-core';
import { ContextBundleSchema, handleContextBundle } from '@nullproof-studio/en-core';
import type { z } from 'zod';

export const DocContextBundleSchema = ContextBundleSchema;

export async function handleDocContextBundle(
  args: z.infer<typeof ContextBundleSchema>,
  ctx: ToolContext,
) {
  return handleContextBundle(args, ctx);
}

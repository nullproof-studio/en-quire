// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from '@nullproof-studio/en-core';
import { AuditLogQuerySchema, handleAuditLog } from '@nullproof-studio/en-core';
import type { z } from 'zod';

export const DocAuditLogSchema = AuditLogQuerySchema;

export async function handleDocAuditLog(
  args: z.infer<typeof AuditLogQuerySchema>,
  ctx: ToolContext,
) {
  return handleAuditLog(args, ctx);
}
